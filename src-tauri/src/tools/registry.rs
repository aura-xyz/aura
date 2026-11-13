//! 工具注册表（v0.3.0）
//!
//! 此前工具信息散落在五处：`execute` 的 match 分发、`tool_label` 的 match、
//! `runner.rs` 的 `is_known_tool` 白名单、Reject 错误提示文案、`prompt.rs` 的
//! 工具描述。新增工具需同步改五处，遗漏任一处都会出现「模型看得到工具却
//! 调不动」或「提示里的工具名是过时的」这类问题。
//!
//! 现在收敛为单一数据源：[`TOOLS`]。`execute`/`tool_label`/`is_known_tool`/
//! prompt 文案/错误提示全部由它派生，以后加工具只需追加一个元素。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;

use crate::mcp::McpToolDef;
use super::{display_path, exec, fs_ops, scope::AccessScope, search, write_ops, ToolOutput};

/// 工具能力分类。决定该工具是否注入 prompt，以及未来的模式隔离
/// （v0.4.x 的 Plan 模式只暴露 `Read`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolKind {
    /// 只读：不修改磁盘
    Read,
    /// 写入：创建或修改工作区内文件
    Write,
    /// 执行：在工作区运行命令
    Exec,
}

/// 工具来源（v0.8.1 C50）。
///
/// 为什么要记来源：rc.3 起 MCP 服务器会把自己的工具挂进同一张注册表，
/// 届时「这个工具是 Aura 自带的还是某个 MCP 服务器的」必须一眼可辨——
/// 提示词分组、审批分级、错误提示都要用得上。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolSource {
    /// Aura 内置工具
    Builtin,
    /// 来自某个 MCP 服务器
    Mcp {
        /// 服务器名（用于分组显示与审批归属）
        server: String,
    },
}

impl ToolSource {
    /// 分组标题（提示词里按来源分段用）。
    pub fn group_title(&self) -> String {
        match self {
            ToolSource::Builtin => "内置工具".to_string(),
            ToolSource::Mcp { server } => format!("MCP 工具（{server}）"),
        }
    }
}

/// 单个工具的完整描述与实现。
pub struct ToolSpec {
    /// 工具名（归一化后的小写下划线形式）
    pub name: &'static str,
    pub kind: ToolKind,
    /// 工具来源（v0.8.1 C50）
    pub source: ToolSource,
    /// MCP 工具的参数 schema（内置工具为 None）
    pub input_schema: Option<String>,
    /// System Prompt 中的说明
    pub desc: &'static str,
    /// System Prompt 中的参数示例
    pub example: &'static str,
    /// 执行体。返回的 `result` 会被回填进 `<tool_result>`
    ///
    /// 第一个参数是**访问域**而非单纯的工作区：v0.6.2 起模型还能访问
    /// 用户授权的额外目录（路径白名单），路径判定统一走
    /// [`AccessScope::allows`]。
    pub run: fn(&AccessScope, &Value) -> Result<ToolOutput, String>,
    /// 从参数生成 UI 动作文案（如 `Read src/main.rs`）
    pub label: fn(&Value) -> String,
    /// 同一目标连续调用超过该次数后拦截，防止死循环
    pub max_consecutive: u32,
}

const READ_LIMIT: u32 = 5;
const WRITE_LIMIT: u32 = 10;
const EXEC_LIMIT: u32 = 6;

/// 全部内置工具。新增工具在此追加即可，无需改动其他任何文件。
pub const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        name: "list_files",
        kind: ToolKind::Read,
        source: ToolSource::Builtin,
        input_schema: None,
        desc: "单层列举目录，不递归。返回该层的文件与子目录列表，子目录以 / 结尾。",
        example: "{\"path\": \"src/\"}（以 / 开头表示工作区根目录，如 /src/main.rs）",
        run: fs_ops::list_files,
        label: label_list_files,
        max_consecutive: READ_LIMIT,
    },
    ToolSpec {
        name: "read_file",
        kind: ToolKind::Read,
        source: ToolSource::Builtin,
        input_schema: None,
        desc: "读取文本文件的指定行区间，返回带行号的内容。",
        example: "{\"path\": \"src/main.rs\", \"start_line\": 1, \"end_line\": \"end\"}（end_line 也可为数字）",
        run: fs_ops::read_file,
        label: label_read_file,
        max_consecutive: READ_LIMIT,
    },
    ToolSpec {
        name: "search_workspace",
        kind: ToolKind::Read,
        source: ToolSource::Builtin,
        input_schema: None,
        desc: "在工作区全文检索，返回带文件路径和行号的片段。",
        example: "{\"query\": \"关键词\"}",
        run: search::search_workspace,
        label: label_search,
        max_consecutive: READ_LIMIT,
    },
    // v0.6.0：技能系统。加载某个 Skill 的完整指引正文（渐进式披露的 L2）。
    // 它是 Read 类：只读技能库，不触碰工作区，因此三档模式都放行——
    // 至于加载后的技能允许用什么工具，由 runner 按 mode ∩ allowed-tools
    // 的激活闸门决定，不在这里体现。
    ToolSpec {
        name: "load_skill",
        kind: ToolKind::Read,
        source: ToolSource::Builtin,
        input_schema: None,
        desc: "加载指定技能（Skill）的完整指引。技能清单见系统提示中的「技能」一节；\
               某个技能的用途与当前任务匹配时必须先加载它，再严格按指引执行。\n\
               技能目录里若还有参考文档、模板或脚本，用 `file` 参数按相对路径读取\
               （只能读该技能目录内的文件）。",
        example: "{\"name\": \"技能名\"}（读附属文件：{\"name\": \"技能名\", \"file\": \"reference.md\"}）",
        run: run_load_skill,
        label: label_load_skill,
        max_consecutive: READ_LIMIT,
    },
    ToolSpec {
        name: "write_file",
        kind: ToolKind::Write,
        source: ToolSource::Builtin,
        input_schema: None,
        desc: "创建新文件或**全量覆写**整个文件；父目录不存在会自动创建。\n\
               仅在「新建文件」或「整体重写」时使用，小范围改动请用 string_replace。",
        example: "{\"path\": \"src/main.rs\", \"content\": \"完整文件内容\"}",
        run: write_ops::write_file,
        label: label_write,
        max_consecutive: WRITE_LIMIT,
    },
    ToolSpec {
        name: "string_replace",
        kind: ToolKind::Write,
        source: ToolSource::Builtin,
        input_schema: None,
        desc: "把文件中一处**精确匹配**的字符串替换为新字符串，最省 Token 的改法。\n\
               old_string 必须唯一命中；出现多次时补充上下文，或加 \"replace_all\": true 全量替换。",
        example: "{\"path\": \"src/main.rs\", \"old_string\": \"原文本\", \"new_string\": \"新文本\"}",
        run: write_ops::string_replace,
        label: label_edit,
        max_consecutive: WRITE_LIMIT,
    },
    ToolSpec {
        name: "replace_lines",
        kind: ToolKind::Write,
        source: ToolSource::Builtin,
        input_schema: None,
        desc: "按行号区间整段替换，new_content 是该区间**替换后的完整文本**。\n\
               适用于成块重写（如重写一个函数）。改单行优先用 string_replace。",
        example: "{\"path\": \"src/main.rs\", \"start_line\": 10, \"end_line\": 20, \"new_content\": \"新的内容\"}",
        run: write_ops::replace_lines,
        label: label_lines,
        max_consecutive: WRITE_LIMIT,
    },
    ToolSpec {
        name: "run_script",
        kind: ToolKind::Exec,
        source: ToolSource::Builtin,
        input_schema: None,
        desc: "在工作区根目录执行一条命令（支持管道等复合命令），返回退出码与输出。\n\
               用于「改完代码后编译/测试」这类验证闭环；输出过长会自动截断。\n\
               危险命令（递归删除根目录、格式化磁盘等）会被拦截。",
        example: "{\"command\": \"cargo build\"}（可选 \"timeout_ms\": 120000）",
        run: exec::run_script,
        label: label_command,
        max_consecutive: EXEC_LIMIT,
    },
];

// ── MCP 动态工具表（rc.3 C61）────────────────────────────────
//
// 静态表 `TOOLS` 是同步函数指针，MCP 调用是异步 IO 且集合在运行期变化，
// 因此静态表与动态表并存：动态表把每个 MCP 工具**泄漏**为一个
// `&'static ToolSpec`（进程级），这样 `find` 仍返回同一种类型，
// `adapter`/三层闸门/提示词全部零改动。
//
// 泄漏说明：每次同步都会重建条目。工具集变化的频率很低（连接/断开/
// list_changed），一台桌面应用整个会话内泄漏的量可以忽略；换来的是调用方
// 类型不变、没有生命周期传染。

/// 动态工具的一条：spec + 原始名与归属服务器。
pub struct McpDynamic {
    pub spec: &'static ToolSpec,
    pub server_id: i64,
    pub server_name: String,
    pub original_name: String,
}

/// 供分发层读取的最小信息（`name` 是改写后的对外名）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpEntry {
    pub server_id: i64,
    pub server_name: String,
    pub original_name: String,
    /// 用户在配置里显式放宽过信任（M2-09）。仅影响审批档位，
    /// 绝不绕过规则表硬拒与工作区限定。
    pub trusted: bool,
}

fn mcp_table() -> &'static Mutex<HashMap<String, McpDynamic>> {
    static TABLE: OnceLock<Mutex<HashMap<String, McpDynamic>>> = OnceLock::new();
    TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 归一化工具名：小写字母/数字/下划线，其余折叠为 `_`。
fn normalize_name(raw: &str) -> String {
    let mut out = String::new();
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    out.trim_matches('_').to_string()
}

fn leak_str(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

/// MCP 工具的同步占位执行体：真正执行走 `async_tool::McpTool`。
fn mcp_placeholder_run(_: &AccessScope, _: &Value) -> Result<ToolOutput, String> {
    Err("MCP 工具应走异步分发".to_string())
}

fn label_mcp_tool(_args: &Value) -> String {
    "MCP 调用".to_string()
}

fn build_mcp_spec(
    external: &str,
    server: &str,
    def: &McpToolDef,
    trusted: bool,
) -> &'static ToolSpec {
    let desc = if def.description.trim().is_empty() {
        "（服务器未提供描述）".to_string()
    } else {
        def.description.clone()
    };
    let example = format!(
        "{{\"name\": \"{external}\", \"args\": {{…}}}}（MCP 工具，服务器：{server}）"
    );
    let schema: Option<String> = if def.input_schema.is_null() {
        None
    } else {
        Some(serde_json::to_string(&def.input_schema).unwrap_or_default())
    };
    Box::leak(Box::new(ToolSpec {
        name: leak_str(external.to_string()),
        // 默认从严：按 Exec，Chat/Plan 模式天然不可见。
        // M2-09：只有用户在本机配置里显式放宽（trust_level=trusted）才降为
        // Read。M2-07 已钉住 def.annotations 里的 readOnlyHint 一律不看——
        // 服务器自报的注解不可信，信任只能来自用户的显式确认。
        kind: if trusted { ToolKind::Read } else { ToolKind::Exec },
        source: ToolSource::Mcp {
            server: server.to_string(),
        },
        input_schema: schema,
        desc: leak_str(desc),
        example: leak_str(example),
        run: mcp_placeholder_run,
        label: label_mcp_tool,
        // 比内置 Exec 的 6 更严。
        max_consecutive: 3,
    }))
}

/// 解析对外工具名：不冲突则用归一化原名；冲突则改写为 `mcp_{server}_{name}`，
/// 仍冲突再追加序号，保证全局唯一。
///
/// 冲突优先级：内置表优先保留原名；MCP 内部先到先得。
fn pick_external_name(
    def_name: &str,
    server: &str,
    is_taken: &dyn Fn(&str) -> bool,
) -> String {
    let mut external = normalize_name(def_name);
    if external.is_empty() || is_taken(&external) {
        external = normalize_name(&format!("mcp_{server}_{def_name}"));
    }
    let mut suffix = 2;
    while external.is_empty() || is_taken(&external) {
        external = normalize_name(&format!("mcp_{server}_{def_name}_{suffix}"));
        suffix += 1;
    }
    external
}

/// 当前工作区是否落在服务器的可见集内（空集 = 全部可见）。
fn visible_in(workspaces: &[String], current: Option<&str>) -> bool {
    if workspaces.is_empty() {
        return true;
    }
    let Some(cur) = current else {
        // 没有具体工作区上下文时不过滤（设置页 / 全局查询）。
        return true;
    };
    let cur = cur.replace('\\', "/");
    workspaces.iter().any(|w| {
        let w = w.replace('\\', "/");
        let w = w.trim_end_matches('/');
        !w.is_empty() && (cur == w || cur.starts_with(&format!("{w}/")))
    })
}

/// 从连接管理器重建动态工具表。连接/断开/工具集变化后调用。
///
/// `current_workspace`：当前会话工作区。给了就按服务器的 `workspaces`
/// 做前缀过滤（空集 = 全部可见）；`None` 表示全局视角不过滤。
pub async fn sync_mcp_tools(current_workspace: Option<&str>) {
    let snapshot = crate::mcp::manager().snapshot().await;
    // 先汇总，再一次性替换，避免同步过程中出现半张表。
    let mut next: HashMap<String, McpDynamic> = HashMap::new();
    for (server_id, conn) in snapshot {
        if !visible_in(&conn.workspaces, current_workspace) {
            continue;
        }
        let server_name = conn.server_name.clone();
        for def in conn.tools().await {
            let is_taken = |name: &str| {
                TOOLS.iter().any(|t| t.name == name) || next.contains_key(name)
            };
            let external = pick_external_name(&def.name, &server_name, &is_taken);
            let spec = build_mcp_spec(
                &external,
                &server_name,
                &def,
                conn.policy.is_trusted(),
            );
            next.insert(
                external,
                McpDynamic {
                    spec,
                    server_id,
                    server_name: server_name.clone(),
                    original_name: def.name.clone(),
                },
            );
        }
    }
    if let Ok(mut table) = mcp_table().lock() {
        *table = next;
    }
}

/// 按名称查找工具：静态表优先，未命中查动态表。
pub fn find(name: &str) -> Option<&'static ToolSpec> {
    if let Some(t) = TOOLS.iter().find(|t| t.name == name) {
        return Some(t);
    }
    mcp_table()
        .lock()
        .ok()
        .and_then(|m| m.get(name).map(|e| e.spec))
}

/// 名称是否为已注册工具。
pub fn is_known(name: &str) -> bool {
    find(name).is_some()
}

/// 全部工具名，用于错误提示文案（静态 + 动态）。
pub fn names() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = TOOLS.iter().map(|t| t.name).collect();
    if let Ok(m) = mcp_table().lock() {
        for e in m.values() {
            out.push(e.spec.name);
        }
    }
    out
}

/// 指定分类的工具名，用于按能力过滤 prompt（静态 + 动态）。
pub fn names_by_kind(kind: ToolKind) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = TOOLS
        .iter()
        .filter(|t| t.kind == kind)
        .map(|t| t.name)
        .collect();
    if let Ok(m) = mcp_table().lock() {
        for e in m.values() {
            if e.spec.kind == kind {
                out.push(e.spec.name);
            }
        }
    }
    out
}

/// 连续调用上限；未注册的工具给一个保守默认值。
pub fn max_consecutive(name: &str) -> u32 {
    find(name).map(|t| t.max_consecutive).unwrap_or(READ_LIMIT)
}

/// 查一条动态工具（分发与文案用）。
pub fn mcp_entry(name: &str) -> Option<McpEntry> {
    mcp_table().lock().ok().and_then(|m| {
        m.get(name).map(|e| McpEntry {
            server_id: e.server_id,
            server_name: e.server_name.clone(),
            original_name: e.original_name.clone(),
            // kind 是从用户配置推导出来的，读它就等价于读信任等级，
            // 不必在动态表里再存一份布尔值造成两处不一致。
            trusted: e.spec.kind == ToolKind::Read,
        })
    })
}

/// 工具动作文案：MCP 工具用「服务器/原始工具名」，其余走各自 label。
pub fn label_for(name: &str, args: &Value) -> String {
    if let Some(e) = mcp_entry(name) {
        return format!("MCP {}/{}", e.server_name, e.original_name);
    }
    find(name)
        .map(|t| (t.label)(args))
        .unwrap_or_else(|| name.to_string())
}

/// 当前动态工具快照（测试与状态查询用）：(对外名, 服务器, 原始名)。
pub fn mcp_snapshot() -> Vec<(String, String, String)> {
    let mut out: Vec<(String, String, String)> = mcp_table()
        .lock()
        .map(|m| {
            m.values()
                .map(|e| {
                    (
                        e.spec.name.to_string(),
                        e.server_name.clone(),
                        e.original_name.clone(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

/// 测试专用：直接注入动态表（不依赖真实连接）。
#[cfg(test)]
pub fn set_mcp_dynamic_for_test(items: Vec<(String, String, String, i64, bool)>) {
    let mut map = HashMap::new();
    for (ext, server, original, sid, trusted) in items {
        let def = McpToolDef {
            name: original.clone(),
            description: "测试工具".to_string(),
            input_schema: Value::Null,
            annotations: None,
        };
        let spec = build_mcp_spec(&ext, &server, &def, trusted);
        map.insert(
            ext,
            McpDynamic {
                spec,
                server_id: sid,
                server_name: server,
                original_name: original,
            },
        );
    }
    if let Ok(mut t) = mcp_table().lock() {
        *t = map;
    }
}

/// 测试专用：清空动态表。
#[cfg(test)]
pub fn clear_mcp_dynamic_for_test() {
    if let Ok(mut t) = mcp_table().lock() {
        t.clear();
    }
}

/// 静态 + 动态工具的统一视图（静态在前，动态按服务器分组稳定排序）。
fn all_specs() -> Vec<&'static ToolSpec> {
    let mut out: Vec<&'static ToolSpec> = TOOLS.iter().collect();
    if let Ok(m) = mcp_table().lock() {
        let mut dyn_specs: Vec<&'static ToolSpec> = m.values().map(|e| e.spec).collect();
        dyn_specs.sort_by(|a, b| {
            a.source
                .group_title()
                .cmp(&b.source.group_title())
                .then_with(|| a.name.cmp(b.name))
        });
        out.extend(dyn_specs);
    }
    out
}

/// 生成 System Prompt 的「可用工具」段落，仅包含指定分类的工具。
///
/// **按来源分组**（v0.8.1 C50）：MCP 工具与内置工具分节列出，
/// 模型能看出某个工具要连哪台服务器；rc.3 挂载 MCP 工具时不用再改这里。
pub fn prompt_section(kinds: &[ToolKind]) -> String {
    let mut s = String::from(
        "\n# 可用工具\n\
         需要调用工具时，输出如下格式的 JSON（必须同时包含 name 与 args，JSON 必须合法）：\n\
         <tool>{\"name\": \"工具名\", \"args\": {参数}}</tool>\n\n",
    );
    let mut idx = 1usize;
    let mut current_group: Option<String> = None;
    for t in all_specs().into_iter().filter(|t| kinds.contains(&t.kind)) {
        let title = t.source.group_title();
        if current_group.as_deref() != Some(title.as_str()) {
            s.push_str(&format!("\n## {title}\n"));
            current_group = Some(title);
        }
        s.push_str(&format!("{}. {}：{}\n   {}\n", idx, t.name, t.desc, t.example));
        if let Some(schema) = &t.input_schema {
            s.push_str(&format!("   参数 schema：{schema}\n"));
        }
        idx += 1;
    }
    s
}

fn label_list_files(args: &Value) -> String {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("/")
        .trim();
    if path == "/" || path.is_empty() {
        "Read /".to_string()
    } else {
        format!("Read {}/", display_path(path))
    }
}

fn label_read_file(args: &Value) -> String {
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let start = args.get("start_line").and_then(|v| v.as_u64()).unwrap_or(1);
    let end = match args.get("end_line") {
        Some(Value::Number(n)) => n.to_string(),
        _ => "end".to_string(),
    };
    if start == 1 && end == "end" {
        format!("Read {}", display_path(path))
    } else {
        format!("Read {} L{} - L{}", display_path(path), start, end)
    }
}

fn label_search(args: &Value) -> String {
    let q = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
    format!("Search '{}'", q)
}

/// `Write src/main.rs`
fn label_write(args: &Value) -> String {
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    format!("Write {}", display_path(path))
}

/// `Edit src/main.rs`
fn label_edit(args: &Value) -> String {
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    format!("Edit {}", display_path(path))
}

/// `Exec 'cargo build'`（超长命令截断，避免撑爆动作卡片）
fn label_command(args: &Value) -> String {
    let cmd = args
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let first = cmd.lines().next().unwrap_or(cmd).trim();
    if first.chars().count() > 60 {
        let mut s: String = first.chars().take(60).collect();
        s.push('…');
        format!("Exec '{}'", s)
    } else {
        format!("Exec '{}'", first)
    }
}

/// `Edit src/main.rs L10 - L20`
fn label_lines(args: &Value) -> String {
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let start = args.get("start_line").and_then(|v| v.as_u64()).unwrap_or(1);
    let end = match args.get("end_line") {
        Some(v) if v.is_string() => "end".to_string(),
        Some(v) => v.as_u64().map(|n| n.to_string()).unwrap_or_else(|| "end".into()),
        None => "end".to_string(),
    };
    format!("Edit {} L{} - L{}", display_path(path), start, end)
}

/// `Load skill 'code-explainer'` / `Load skill 'pdf' › reference.md`
fn label_load_skill(args: &Value) -> String {
    let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
    let file = args.get("file").and_then(|v| v.as_str()).unwrap_or("").trim();
    if file.is_empty() {
        format!("Load skill '{}'", name)
    } else {
        format!("Load skill '{}' › {}", name, file)
    }
}

/// `load_skill` 的执行体。
///
/// 技能库的扫描与正文渲染在 `agent::skill`（那是 agent 层的概念，
/// prompt 注入与激活态都在那边）；这里只做工具层的适配。
/// `root` 是工作区根目录，用于发现 `.agents/skills/` 下的工作区技能。
///
/// 带 `file` 时读的是技能目录内的附属文件（参考文档 / 模板 / 脚本源码）——
/// 那条路径在应用数据目录，`read_file` 到不了，只能从这个口子进。
fn run_load_skill(scope: &AccessScope, args: &Value) -> Result<ToolOutput, String> {
    let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let file = args
        .get("file")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");

    if file.is_empty() {
        let body = crate::agent::skill::load_skill_body(&scope.workspace, name)?;
        return Ok(ToolOutput {
            label: label_load_skill(args),
            result: body,
        
            diff: None,});
    }

    let content = crate::agent::skill::read_skill_file(&scope.workspace, name, file)?;
    Ok(ToolOutput {
        label: label_load_skill(args),
        result: format!(
            "技能 `{}` 的附属文件 `{file}`（相对技能目录）：\n\n{content}",
            name.trim()
        ),
    
        diff: None,})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tool_name_is_unique_and_normalized() {
        let mut seen = std::collections::HashSet::new();
        for t in TOOLS {
            assert!(seen.insert(t.name), "工具名重复: {}", t.name);
            assert_eq!(t.name, t.name.to_lowercase(), "工具名必须小写");
            assert!(
                t.name.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "工具名只允许小写字母与下划线: {}",
                t.name
            );
        }
    }

    #[test]
    fn registry_drives_lookups() {
        assert!(is_known("read_file"));
        assert!(is_known("write_file"));
        assert!(!is_known("nonexistent"));
        assert_eq!(find("read_file").unwrap().kind, ToolKind::Read);
        assert_eq!(find("write_file").unwrap().kind, ToolKind::Write);
        assert_eq!(max_consecutive("read_file"), READ_LIMIT);
        assert_eq!(max_consecutive("write_file"), WRITE_LIMIT);
        assert_eq!(max_consecutive("unknown"), READ_LIMIT);
    }

    #[test]
    fn load_skill_label_shows_attached_file() {
        // 读附属文件与加载技能是两件事，动作卡片上要能一眼区分
        assert_eq!(
            label_load_skill(&serde_json::json!({ "name": "pdf" })),
            "Load skill 'pdf'"
        );
        assert_eq!(
            label_load_skill(&serde_json::json!({ "name": "pdf", "file": "reference.md" })),
            "Load skill 'pdf' › reference.md"
        );
    }

    #[test]
    fn names_matches_registry() {
        assert_eq!(
            names(),
            vec![
                "list_files",
                "read_file",
                "search_workspace",
                "load_skill",
                "write_file",
                "string_replace",
                "replace_lines",
                "run_script",
            ]
        );
    }

    /// load_skill 必须存在且为只读类：三档模式都放行它，
    /// 技能激活后的收窄由 runner 的激活闸门负责，不依赖工具分类。
    #[test]
    fn load_skill_is_registered_as_read() {
        assert!(is_known("load_skill"));
        assert_eq!(find("load_skill").unwrap().kind, ToolKind::Read);
        assert_eq!(max_consecutive("load_skill"), READ_LIMIT);
        assert_eq!(
            label_load_skill(&serde_json::json!({ "name": "code-explainer" })),
            "Load skill 'code-explainer'"
        );
    }

    #[test]
    fn exec_tool_is_registered_with_its_limit() {
        assert!(is_known("run_script"));
        assert_eq!(find("run_script").unwrap().kind, ToolKind::Exec);
        assert_eq!(max_consecutive("run_script"), EXEC_LIMIT);
        assert_eq!(label_command(&serde_json::json!({ "command": "cargo build" })), "Exec 'cargo build'");
    }

    #[test]
    fn prompt_section_lists_tools_with_examples() {
        let s = prompt_section(&[ToolKind::Read]);
        assert!(s.contains("1. list_files："));
        assert!(s.contains("2. read_file："));
        assert!(s.contains("3. search_workspace："));
        assert!(s.contains("{\"path\": \"src/main.rs\""));
        // 写类不应出现在只读 prompt 中
        assert!(!s.contains("write_file"));
        // 按分类过滤
        let write = prompt_section(&[ToolKind::Write]);
        assert!(write.contains("write_file"));
        assert!(write.contains("string_replace"));
        assert!(write.contains("replace_lines"));
        assert!(!write.contains("list_files"));
        // 临时性过滤：Exec 尚未注册，这里只验证机制可用
        let only_exec = prompt_section(&[ToolKind::Exec]);
        assert!(!only_exec.contains("read_file"));
    }

    #[test]
    fn labels_match_legacy_behaviour() {
        assert_eq!(
            label_list_files(&serde_json::json!({ "path": "/" })),
            "Read /"
        );
        assert_eq!(
            label_list_files(&serde_json::json!({ "path": "src" })),
            "Read src/"
        );
        assert_eq!(
            label_read_file(&serde_json::json!({ "path": "a.rs" })),
            "Read a.rs"
        );
        assert_eq!(
            label_read_file(&serde_json::json!({ "path": "a.rs", "start_line": 2, "end_line": 8 })),
            "Read a.rs L2 - L8"
        );
        assert_eq!(
            label_search(&serde_json::json!({ "query": "连接池" })),
            "Search '连接池'"
        );
    }

    // ── C61：MCP 动态工具 ───────────────────────────────────────

    #[test]
    fn normalize_name_folds_to_ascii_identifier() {
        assert_eq!(normalize_name("Read File!"), "read_file");
        assert_eq!(normalize_name("a/b:c"), "a_b_c");
    }

    #[test]
    fn pick_external_name_rewrites_on_conflict_and_dedupes() {
        let none = |_: &str| false;
        assert_eq!(pick_external_name("echo", "fs", &none), "echo");

        // 命中内置名 → 加 mcp_{server}_ 前缀
        let builtin = |n: &str| n == "read_file";
        assert_eq!(
            pick_external_name("read_file", "fs", &builtin),
            "mcp_fs_read_file"
        );

        // 前缀名也已被占用 → 追加序号
        let taken = |n: &str| n == "read_file" || n == "mcp_fs_read_file";
        assert_eq!(
            pick_external_name("read_file", "fs", &taken),
            "mcp_fs_read_file_2"
        );
    }

    #[test]
    fn mcp_spec_is_exec_and_conservative() {
        let def = crate::mcp::McpToolDef {
            name: "read_file".into(),
            description: String::new(),
            input_schema: serde_json::Value::Null,
            annotations: None,
        };
        let spec = build_mcp_spec("mcp_fs_read_file", "fs", &def, false);
        assert_eq!(spec.kind, ToolKind::Exec);
        assert_eq!(spec.max_consecutive, 3);
        assert!(spec.desc.contains("未提供描述"));
        match &spec.source {
            ToolSource::Mcp { server } => assert_eq!(server, "fs"),
            _ => panic!("MCP 工具来源必须是 Mcp"),
        }
    }

    /// M2-07 安全红线：服务器自称只读也不能让它绕过模式闸门。
    #[test]
    fn read_only_annotation_never_relaxes_kind() {
        let def = crate::mcp::McpToolDef {
            name: "harmless_reader".into(),
            description: "我保证只读".into(),
            input_schema: serde_json::Value::Null,
            annotations: Some(serde_json::json!({
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": false
            })),
        };
        let spec = build_mcp_spec("mcp_evil_harmless_reader", "evil", &def, false);
        assert_eq!(spec.kind, ToolKind::Exec);
        assert_eq!(spec.max_consecutive, 3);
        // 注解内容也没有被写进 prompt 可见的描述字段
        assert!(!spec.desc.contains("readOnlyHint"));
    }

    /// M2-09：只有用户显式放宽才降为 Read，mcp_entry 也要能读出这个状态。
    #[test]
    fn explicit_trust_downgrades_kind_and_is_visible_in_entry() {
        let def = crate::mcp::McpToolDef {
            name: "reader".into(),
            description: "只读".into(),
            input_schema: serde_json::Value::Null,
            annotations: None,
        };
        let spec = build_mcp_spec("mcp_fs_reader", "fs", &def, true);
        assert_eq!(spec.kind, ToolKind::Read);

        set_mcp_dynamic_for_test(vec![(
            "mcp_fs_reader".to_string(),
            "fs".to_string(),
            "reader".to_string(),
            9,
            true,
        )]);
        let entry = mcp_entry("mcp_fs_reader").expect("动态条目应可查");
        assert!(entry.trusted);
        assert_eq!(find("mcp_fs_reader").unwrap().kind, ToolKind::Read);
        // Read 类在 Chat/Plan 的 kinds 里，prompt 分组应能列出它
        let prompt = prompt_section(&[ToolKind::Read]);
        assert!(prompt.contains("mcp_fs_reader"), "{prompt}");
        clear_mcp_dynamic_for_test();
    }

    #[test]
    fn dynamic_tool_participates_in_queries_and_prompt() {
        set_mcp_dynamic_for_test(vec![(
            "echo".to_string(),
            "demo".to_string(),
            "echo".to_string(),
            7,
            false,
        )]);
        assert!(find("echo").is_some());
        assert!(is_known("echo"));
        assert!(names().contains(&"echo"));
        let entry = mcp_entry("echo").expect("动态条目应可查");
        assert_eq!(entry.server_name, "demo");
        assert_eq!(entry.original_name, "echo");
        assert_eq!(label_for("echo", &serde_json::json!({})), "MCP demo/echo");
        let prompt = prompt_section(&[ToolKind::Exec]);
        assert!(prompt.contains("echo"), "{prompt}");

        clear_mcp_dynamic_for_test();
        assert!(find("echo").is_none());
    }
}