//! 工具注册表（v0.3.0）
//!
//! 此前工具信息散落在五处：`execute` 的 match 分发、`tool_label` 的 match、
//! `runner.rs` 的 `is_known_tool` 白名单、Reject 错误提示文案、`prompt.rs` 的
//! 工具描述。新增工具需同步改五处，遗漏任一处都会出现「模型看得到工具却
//! 调不动」或「提示里的工具名是过时的」这类问题。
//!
//! 现在收敛为单一数据源：[`TOOLS`]。`execute`/`tool_label`/`is_known_tool`/
//! prompt 文案/错误提示全部由它派生，以后加工具只需追加一个元素。

use serde_json::Value;

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

/// 单个工具的完整描述与实现。
pub struct ToolSpec {
    /// 工具名（归一化后的小写下划线形式）
    pub name: &'static str,
    pub kind: ToolKind,
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
        desc: "单层列举目录，不递归。返回该层的文件与子目录列表，子目录以 / 结尾。",
        example: "{\"path\": \"src/\"}（以 / 开头表示工作区根目录，如 /src/main.rs）",
        run: fs_ops::list_files,
        label: label_list_files,
        max_consecutive: READ_LIMIT,
    },
    ToolSpec {
        name: "read_file",
        kind: ToolKind::Read,
        desc: "读取文本文件的指定行区间，返回带行号的内容。",
        example: "{\"path\": \"src/main.rs\", \"start_line\": 1, \"end_line\": \"end\"}（end_line 也可为数字）",
        run: fs_ops::read_file,
        label: label_read_file,
        max_consecutive: READ_LIMIT,
    },
    ToolSpec {
        name: "search_workspace",
        kind: ToolKind::Read,
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
        desc: "在工作区根目录执行一条命令（支持管道等复合命令），返回退出码与输出。\n\
               用于「改完代码后编译/测试」这类验证闭环；输出过长会自动截断。\n\
               危险命令（递归删除根目录、格式化磁盘等）会被拦截。",
        example: "{\"command\": \"cargo build\"}（可选 \"timeout_ms\": 120000）",
        run: exec::run_script,
        label: label_command,
        max_consecutive: EXEC_LIMIT,
    },
];

/// 按名称查找工具。
pub fn find(name: &str) -> Option<&'static ToolSpec> {
    TOOLS.iter().find(|t| t.name == name)
}

/// 名称是否为已注册工具。
pub fn is_known(name: &str) -> bool {
    find(name).is_some()
}

/// 全部工具名，用于错误提示文案（保证与实际注册列表同步）。
pub fn names() -> Vec<&'static str> {
    TOOLS.iter().map(|t| t.name).collect()
}

/// 指定分类的工具名，用于按能力过滤 prompt。
pub fn names_by_kind(kind: ToolKind) -> Vec<&'static str> {
    TOOLS.iter()
        .filter(|t| t.kind == kind)
        .map(|t| t.name)
        .collect()
}

/// 连续调用上限；未注册的工具给一个保守默认值。
pub fn max_consecutive(name: &str) -> u32 {
    find(name).map(|t| t.max_consecutive).unwrap_or(READ_LIMIT)
}

/// 生成 System Prompt 的「可用工具」段落，仅包含指定分类的工具。
pub fn prompt_section(kinds: &[ToolKind]) -> String {
    let mut s = String::from(
        "\n# 可用工具\n\
         需要调用工具时，输出如下格式的 JSON（必须同时包含 name 与 args，JSON 必须合法）：\n\
         <tool>{\"name\": \"工具名\", \"args\": {参数}}</tool>\n\n",
    );
    let mut idx = 1usize;
    for t in TOOLS.iter().filter(|t| kinds.contains(&t.kind)) {
        s.push_str(&format!("{}. {}：{}\n   {}\n", idx, t.name, t.desc, t.example));
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
}