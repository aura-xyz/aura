//! Skill 系统（v0.6.0）
//!
//! 技能是一份带 YAML Frontmatter 的 `SKILL.md`，让模型在合适的场景下
//! 按既定指引行事，而不必每次在提示词里重复描述。核心是**渐进式披露**：
//!
//! - **L1 索引**：每轮重建 System Prompt 时注入全部技能的 `name` +
//!   `description`（一两行一个），模型据此判断「有没有对口的技能」。
//! - **L2 正文**：模型调用 `load_skill` 工具后，该技能 `SKILL.md` 的正文
//!   才进入上下文。未加载的技能不占 Token。
//!
//! # 存放位置与覆盖优先级（v0.6.0 定论，勿改）
//!
//! 实体文件全部落盘，SQLite 不存文件内容（v0.6.1 的 `skills` 表只记
//! `path` / `source` / `enabled`，方便高级用户直接改磁盘文件）：
//!
//! | 来源 | 位置 | 说明 |
//! |---|---|---|
//! | Workspace | 工作区根 `.agents/skills/` | 随 Git 共享，团队协作 |
//! | Local | `app_data_dir()/skills/local/` | 用户自建 |
//! | Market | `app_data_dir()/skills/market/` | 市场下载（v0.6.2 接入） |
//! | Builtin | 安装目录 `resources/builtin-skills/` | 随 App 发版，**只读** |
//!
//! 同名技能高优先级覆盖低优先级：**Workspace > Local > Market > Builtin**。
//!
//! # 权限：技能只能收窄，不能放大
//!
//! Frontmatter 的 `allowed-tools` 是**白名单**：技能激活期间，工具调用
//! 必须同时满足 `mode.allows()` 与技能声明（求交集）。Skill 永远无法
//! 绕过 `mode.rs::allows` 的硬闸门——Chat/Plan 模式下即使加载了声明
//! `write_file` 的技能，写入调用照样被拦截。
//!
//! 激活是**按轮次（run）**的：`load_skill` 成功后登记，本轮结束
//! （`<answer>` / 取消 / 出错）即失效。这样技能无法在后续对话里
//! 静默收紧权限，模型需要时重新加载即可。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 技能来源。枚举序即覆盖优先级（后者胜出）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillSource {
    /// 安装目录内置，随 App 发版更新，只读
    Builtin,
    /// 市场下载（v0.6.2 接入）
    Market,
    /// 用户自建（应用数据目录）
    Local,
    /// 工作区内，随 Git 共享
    Workspace,
}

impl SkillSource {
    /// 稳定英文标识，用于持久化与日志。
    pub fn as_str(self) -> &'static str {
        match self {
            SkillSource::Builtin => "builtin",
            SkillSource::Market => "market",
            SkillSource::Local => "local",
            SkillSource::Workspace => "workspace",
        }
    }

    /// 中文名，用于回执文案。
    pub fn zh(self) -> &'static str {
        match self {
            SkillSource::Builtin => "内置",
            SkillSource::Market => "市场",
            SkillSource::Local => "本地",
            SkillSource::Workspace => "工作区",
        }
    }

    /// 覆盖优先级，数值大者胜出。
    fn priority(self) -> u8 {
        match self {
            SkillSource::Builtin => 0,
            SkillSource::Market => 1,
            SkillSource::Local => 2,
            SkillSource::Workspace => 3,
        }
    }
}

/// 一个待扫描的技能根目录。
pub struct SkillRoot {
    pub dir: PathBuf,
    pub source: SkillSource,
}

/// 技能的完整清单（L2 加载后进入上下文的就是 `body`）。
#[derive(Debug, Clone)]
pub struct SkillManifest {
    /// 技能名，模型通过它调用 `load_skill`。小写字母/数字/`._-`，≤64 字符
    pub name: String,
    /// 一句话说明**何时该用**这个技能（L1 索引只展示它）
    pub description: String,
    pub version: String,
    /// 激活期间可用的工具白名单；**空 = 不收窄**（仍受模式权限约束）。
    /// 必须列出本技能需要的**全部**工具——未列出的在激活期间不可用。
    pub allowed_tools: Vec<String>,
    /// `SKILL.md` 正文（Frontmatter 之后的部分）
    pub body: String,
    pub source: SkillSource,
    /// 技能目录（`SKILL.md` 的父目录），附属脚本相对它定位
    pub dir: PathBuf,
}

/// L1 索引中单条 description 的展示上限。
const INDEX_DESC_MAX: usize = 120;

/// 全局技能根目录（Builtin + Market + Local），启动时登记一次。
///
/// 工作区根不进这里：它随会话变化，由每次扫描的调用方传入。
static GLOBAL_ROOTS: OnceLock<Vec<SkillRoot>> = OnceLock::new();

/// 登记全局技能根目录。重复调用以首次为准（`OnceLock` 语义）。
pub fn set_global_roots(roots: Vec<SkillRoot>) {
    let _ = GLOBAL_ROOTS.set(roots);
}

/// 扫描全部技能：全局根 + 当前工作区的 `.agents/skills/`。
///
/// 每轮调用一次（目录极小，开销相对一次 LLM 往返可忽略），
/// 保证会话中途新增的技能文件当轮即可见。
pub fn scan_with_globals(workspace: &Path) -> Vec<SkillManifest> {
    let empty: Vec<SkillRoot> = Vec::new();
    let roots = GLOBAL_ROOTS.get().unwrap_or(&empty);
    scan(roots, Some(workspace))
}

/// 市场技能根目录（`app_data_dir/skills/market`）。v0.6.1 安装器要用它；
/// 根目录在 lib.rs 启动时登记，未登记（如单测）时返回 None。
pub fn market_root() -> Option<PathBuf> {
    GLOBAL_ROOTS
        .get()?
        .iter()
        .find(|r| r.source == SkillSource::Market)
        .map(|r| r.dir.clone())
}

/// 去掉被禁用的技能（v0.6.1）。
///
/// 禁用状态存在库里，由调用方读好传进来；这里只做纯过滤，保持本模块
/// 不依赖数据库。命中后既不进 L1 索引、也不会被登记为激活技能——
/// 模型看不见的技能不该被调用。
pub fn without_disabled(skills: Vec<SkillManifest>, disabled: &[String]) -> Vec<SkillManifest> {
    if disabled.is_empty() {
        return skills;
    }
    skills
        .into_iter()
        .filter(|s| !disabled.iter().any(|d| d == &s.name))
        .collect()
}

/// 删除策略：只有市场与本地技能允许整目录删除。
///
/// 内置技能随应用发布（删了下次更新就回来），工作区技能属于用户的
/// Git 仓库（删了等于替他删项目文件）——两者只提供「禁用」或让用户自己清理。
pub fn deletable(source: SkillSource) -> Result<(), &'static str> {
    match source {
        SkillSource::Builtin => Err("内置技能随应用发布，不能删除；如不需要可以禁用"),
        SkillSource::Workspace => Err("工作区技能随项目共享，请在项目的 .agents/skills/ 里删除"),
        SkillSource::Local | SkillSource::Market => Ok(()),
    }
}

/// 扫描给定根目录与（可选的）工作区根，按优先级去重。
///
/// 优先级：Workspace > Local > Market > Builtin。解析失败、目录不存在、
/// 隐藏目录与符号链接一律跳过——单个坏技能不应影响其余技能。
pub fn scan(roots: &[SkillRoot], workspace: Option<&Path>) -> Vec<SkillManifest> {
    let mut candidates: Vec<SkillManifest> = Vec::new();
    for root in roots {
        collect_dir(&root.dir, root.source, &mut candidates);
    }
    if let Some(ws) = workspace {
        collect_dir(&ws.join(".agents/skills"), SkillSource::Workspace, &mut candidates);
    }

    // 同名去重：高优先级覆盖低优先级。roots 的传入顺序不影响结果。
    let mut chosen: Vec<SkillManifest> = Vec::new();
    for m in candidates {
        match chosen.iter_mut().find(|e| e.name == m.name) {
            Some(existing) if m.source.priority() > existing.source.priority() => *existing = m,
            Some(_) => {}
            None => chosen.push(m),
        }
    }
    chosen.sort_by(|a, b| a.name.cmp(&b.name));
    chosen
}

/// 收集一个根目录下的全部技能：每个子目录一份 `SKILL.md`。
fn collect_dir(root: &Path, source: SkillSource, out: &mut Vec<SkillManifest>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return; // 目录不存在是常态（用户还没建过技能），不视为错误
    };
    for entry in entries.flatten() {
        // 跳过隐藏目录与符号链接：与 search_workspace 的立场一致，
        // 避免 .git 等噪音，也避免符号链接把技能文件引到意外位置
        let Ok(ft) = entry.file_type() else { continue };
        if !ft.is_dir() {
            continue;
        }
        let dir_name = entry.file_name();
        let dir_name = dir_name.to_string_lossy();
        if dir_name.starts_with('.') {
            continue;
        }
        let skill_md = entry.path().join("SKILL.md");
        let Ok(content) = std::fs::read_to_string(&skill_md) else {
            continue; // 没有 SKILL.md 的目录不是技能
        };
        // 解析失败静默跳过：用户可能正在编辑，半成品不该让整个技能库不可用
        if let Ok(mut m) = parse_skill_md(&content) {
            m.source = source;
            m.dir = entry.path();
            out.push(m);
        }
    }
}

/// 解析 `SKILL.md`：YAML Frontmatter（`---` 包裹）+ Markdown 正文。
///
/// 支持的 Frontmatter 键：
///
/// | 键 | 必填 | 说明 |
/// |---|---|---|
/// | `name` | 是 | 技能名，`[a-z0-9._-]`，首字符字母或数字，≤64 |
/// | `description` | 是 | 何时该用这个技能（L1 索引只展示它） |
/// | `version` | 否 | 默认 `0.0.0` |
/// | `allowed-tools` | 否 | 工具白名单；空或不写 = 不收窄 |
///
/// 未知键忽略（前向兼容）。标量支持 `key: value` 与行内 `key: [a, b]`，
/// 列表支持块状 `- item`。这是本项目自定义的**受限子集**，不引三方
/// YAML 库——字段少而固定，手写解析器完全可覆盖，且免去一个依赖。
pub fn parse_skill_md(content: &str) -> Result<SkillManifest, String> {
    // Windows 编辑器常存 CRLF，统一按 LF 处理
    let content = content.replace("\r\n", "\n").replace('\r', "\n");
    let rest = content.trim_start_matches('\n');

    let Some(after_open) = rest.strip_prefix("---\n") else {
        return Err("缺少 Frontmatter：文件必须以 --- 开头的 YAML 头开始".into());
    };
    let Some(end) = after_open.find("\n---") else {
        return Err("Frontmatter 未闭合：缺少结束的 --- 行".into());
    };
    let (front, body) = after_open.split_at(end);
    let body = body
        .strip_prefix("\n---")
        .and_then(|s| s.strip_prefix('\n'))
        .unwrap_or("");

    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut version = "0.0.0".to_string();
    let mut allowed_tools: Vec<String> = Vec::new();
    // 当前正在收集的块状列表属于哪个键（仅 allowed-tools 有意义）
    let mut list_key: Option<&str> = None;

    for line in front.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(item) = line.strip_prefix("- ") {
            if list_key == Some("allowed-tools") {
                let item = unquote(item.trim());
                if !item.is_empty() {
                    allowed_tools.push(item);
                }
            }
            continue;
        }
        list_key = None;
        let Some((key, value)) = line.split_once(':') else {
            continue; // 非键值行忽略
        };
        let key = key.trim();
        let value = value.trim();
        match key {
            "name" => name = Some(unquote(value)),
            "description" => description = Some(unquote(value)),
            "version" => {
                if !value.is_empty() {
                    version = unquote(value);
                }
            }
            "allowed-tools" => {
                if value.starts_with('[') && value.ends_with(']') {
                    // 行内列表：[a, b, c]
                    for item in value[1..value.len() - 1].split(',') {
                        let item = unquote(item.trim());
                        if !item.is_empty() {
                            allowed_tools.push(item);
                        }
                    }
                } else if value.is_empty() {
                    // 块状列表：后续的 "- item" 行归此键
                    list_key = Some("allowed-tools");
                }
            }
            _ => {} // 未知键忽略
        }
    }

    let name = name.ok_or("Frontmatter 缺少必填字段 name")?;
    if name.is_empty() {
        return Err("name 不能为空".into());
    }
    if !valid_name(&name) {
        return Err(format!(
            "name `{name}` 非法：只允许小写字母/数字/._-，首字符须为字母或数字，长度 ≤64"
        ));
    }
    let description = description.ok_or("Frontmatter 缺少必填字段 description")?;
    if description.trim().is_empty() {
        return Err("description 不能为空".into());
    }

    Ok(SkillManifest {
        name,
        description: description.trim().to_string(),
        version,
        allowed_tools,
        body: body.trim().to_string(),
        source: SkillSource::Builtin, // 调用方按实际根目录覆写
        dir: PathBuf::new(),
    })
}

/// 去掉首尾配对的单引号或双引号。
fn unquote(s: &str) -> String {
    let s = s.trim();
    for q in ['"', '\''] {
        if s.len() >= 2 && s.starts_with(q) && s.ends_with(q) {
            return s[1..s.len() - 1].to_string();
        }
    }
    s.to_string()
}

/// 技能名合法性：`load_skill` 的参数直接用它查表，必须无可执行歧义。
fn valid_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    let first = name.chars().next().unwrap();
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

/// 生成 L1 索引段（注入 System Prompt）。
///
/// 空列表返回空串——调用方据此整段跳过，不影响无技能用户的 prompt。
pub fn render_index(skills: &[SkillManifest]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n# 技能（Skills）\n");
    s.push_str(
        "以下是当前可用的技能。某个技能的用途与当前任务匹配时，\
         必须先调用 load_skill 加载它的完整指引，再严格按指引执行；\
         没有匹配的技能时按常规流程处理，不要虚构技能。\n",
    );
    for sk in skills {
        s.push_str(&format!("- {}：{}\n", sk.name, one_line(&sk.description)));
    }
    s
}

/// 压成一行并截断，防止 description 里的换行破坏索引结构。
fn one_line(s: &str) -> String {
    let flat: String = s
        .chars()
        .map(|c| if c == '\n' { ' ' } else { c })
        .take(INDEX_DESC_MAX)
        .collect();
    let trimmed = flat.trim();
    if s.chars().count() > INDEX_DESC_MAX {
        format!("{trimmed}…")
    } else {
        trimmed.to_string()
    }
}

/// 激活技能对工具调用的裁定。
pub enum SkillVerdict {
    /// 放行
    Allow,
    /// 拦截（附原因，回传给模型）
    Deny(String),
}

/// 工具调用是否被**激活中的技能**允许。
///
/// 规则：
/// - `load_skill` 永远放行——否则激活一个技能后再也无法加载或切换技能；
/// - 无激活技能、或激活技能均未声明 `allowed-tools` 时不收窄；
/// - 否则取全部激活技能声明的**并集**，不在其中即拒。
///
/// 用并集而非交集：模型常需「先加载 A 做完调研，再加载 B 动手」，
/// 交集会让 A 继续挡着 B 需要的工具，而技能没有卸载机制。
pub fn gate_active_skill(name: &str, active: &[SkillManifest]) -> SkillVerdict {
    if name == "load_skill" {
        return SkillVerdict::Allow;
    }
    let declared: Vec<&str> = active
        .iter()
        .filter(|s| !s.allowed_tools.is_empty())
        .flat_map(|s| s.allowed_tools.iter().map(String::as_str))
        .collect();
    if declared.is_empty() {
        return SkillVerdict::Allow;
    }
    if declared.iter().any(|t| *t == name) {
        return SkillVerdict::Allow;
    }
    let names: Vec<&str> = active.iter().map(|s| s.name.as_str()).collect();
    SkillVerdict::Deny(format!(
        "当前激活的技能（{}）未声明工具 `{name}`，本阶段仅可用：{}。\
         请按该技能的指引完成任务，用 <answer> 收尾后即可恢复其他工具。",
        names.join("、"),
        declared.join("、")
    ))
}

/// `load_skill` 工具的实现体：扫描技能库并返回该技能的完整指引。
pub fn load_skill_body(workspace: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("缺少技能名称 name，可用技能见系统提示中的技能索引".into());
    }
    let skills = scan_with_globals(workspace);
    let Some(sk) = skills.iter().find(|s| s.name == name) else {
        let avail = if skills.is_empty() {
            "（当前没有任何可用技能）".to_string()
        } else {
            skills
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>()
                .join("、")
        };
        return Err(format!("技能 `{name}` 不存在，当前可用技能：{avail}"));
    };
    Ok(render_full(sk))
}

/// L2 正文回执：身份信息 + 工具范围 + `SKILL.md` 正文。
fn render_full(sk: &SkillManifest) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "已加载技能「{}」（版本 {}，来源：{}）。\n",
        sk.name,
        sk.version,
        sk.source.zh()
    ));
    s.push_str(&format!("技能目录：{}\n", sk.dir.display()));
    if sk.allowed_tools.is_empty() {
        s.push_str("本技能未限定工具范围，激活期间仍受当前模式权限约束。\n");
    } else {
        s.push_str(&format!(
            "本技能可用工具：{}（未列出的工具在激活期间不可用）。\n",
            sk.allowed_tools.join("、")
        ));
    }
    s.push_str("\n以下为该技能的完整指引，请严格遵循：\n\n");
    s.push_str(&sk.body);
    s.push('\n');
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个用例独立的临时目录，返回前确保父目录存在。
    fn tmp(case: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aura_skill_test_{}_{}", std::process::id(), case));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_skill(root: &Path, dir_name: &str, content: &str) {
        let d = root.join(dir_name);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("SKILL.md"), content).unwrap();
    }

    const FULL: &str = "---\nname: demo\ndescription: 演示技能\nversion: 1.2.3\nallowed-tools:\n  - read_file\n  - run_script\n---\n\n# 正文\n\n第一步。\n";

    // ---- 解析 ----

    #[test]
    fn parse_full_frontmatter() {
        let m = parse_skill_md(FULL).unwrap();
        assert_eq!(m.name, "demo");
        assert_eq!(m.description, "演示技能");
        assert_eq!(m.version, "1.2.3");
        assert_eq!(m.allowed_tools, vec!["read_file", "run_script"]);
        assert!(m.body.contains("第一步。"));
        assert!(!m.body.contains("name:"));
    }

    #[test]
    fn parse_inline_list_and_defaults() {
        let m = parse_skill_md("---\nname: x\ndescription: d\nallowed-tools: [read_file, write_file]\n---\nbody")
            .unwrap();
        assert_eq!(m.allowed_tools, vec!["read_file", "write_file"]);
        // version 缺省
        assert_eq!(m.version, "0.0.0");
        assert_eq!(m.body, "body");
    }

    #[test]
    fn parse_crlf_is_normalized() {
        let crlf = FULL.replace('\n', "\r\n");
        let m = parse_skill_md(&crlf).unwrap();
        assert_eq!(m.name, "demo");
        assert_eq!(m.allowed_tools, vec!["read_file", "run_script"]);
        assert!(!m.body.contains('\r'));
    }

    #[test]
    fn parse_ignores_unknown_keys_and_comments() {
        let m = parse_skill_md(
            "---\n# 注释\nname: x\ndescription: d\nauthor: someone\nunknown_key: 1\n---\nb",
        )
        .unwrap();
        assert_eq!(m.name, "x");
    }

    #[test]
    fn parse_requires_name_and_description() {
        assert!(parse_skill_md("---\ndescription: d\n---\nb").is_err());
        assert!(parse_skill_md("---\nname: x\n---\nb").is_err());
    }

    #[test]
    fn parse_rejects_malformed_names() {
        for bad in ["", "Demo", "a b", "../evil", "a/b", "-x", &"x".repeat(65)] {
            let src = format!("---\nname: {bad}\ndescription: d\n---\nb");
            assert!(
                parse_skill_md(&src).is_err(),
                "name `{bad}` 应被拒绝：查表直接用 name，不能含路径或大写"
            );
        }
    }

    #[test]
    fn parse_rejects_missing_or_unclosed_frontmatter() {
        assert!(parse_skill_md("# 没有头\n正文").is_err());
        assert!(parse_skill_md("---\nname: x\ndescription: d\n正文").is_err());
    }

    // ---- 扫描 ----

    #[test]
    fn scan_reads_skill_dirs() {
        let base = tmp("scan_reads");
        write_skill(&base, "a", FULL);
        write_skill(&base, "b", "---\nname: b\ndescription: 乙\n---\n乙正文");
        let found = scan(&[SkillRoot { dir: base.clone(), source: SkillSource::Local }], None);
        assert_eq!(found.len(), 2);
        // 名称取自 frontmatter 而非目录名；结果按名称排序，b 排在 demo 前
        assert_eq!(found[0].name, "b");
        assert_eq!(found[0].description, "乙");
        let demo = found.iter().find(|s| s.name == "demo").unwrap();
        assert_eq!(demo.source, SkillSource::Local);
        assert_eq!(demo.dir, base.join("a"), "dir 应指向 SKILL.md 所在目录");
    }

    #[test]
    fn scan_priority_workspace_over_local_over_market_over_builtin() {
        let base = tmp("scan_priority");
        let ws = base.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        for (src, marker) in [
            (SkillSource::Builtin, "builtin-body"),
            (SkillSource::Market, "market-body"),
            (SkillSource::Local, "local-body"),
            (SkillSource::Workspace, "ws-body"),
        ] {
            let root = match src {
                SkillSource::Workspace => ws.join(".agents/skills"),
                _ => base.join(src.as_str()),
            };
            write_skill(
                &root,
                "same",
                &format!("---\nname: same\ndescription: {marker}\n---\n{marker}"),
            );
        }
        let found = scan(
            &[
                SkillRoot { dir: base.join("builtin"), source: SkillSource::Builtin },
                SkillRoot { dir: base.join("market"), source: SkillSource::Market },
                SkillRoot { dir: base.join("local"), source: SkillSource::Local },
            ],
            Some(&ws),
        );
        assert_eq!(found.len(), 1, "同名技能应只保留最高优先级的一份");
        assert_eq!(found[0].source, SkillSource::Workspace);
        assert_eq!(found[0].description, "ws-body");
    }

    /// 逐个降级验证优先级：移除高优先级来源后，次高级应当胜出。
    #[test]
    fn scan_priority_falls_back_step_by_step() {
        let base = tmp("scan_priority_steps");
        let ws = base.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let roots_of = |src: SkillSource| match src {
            SkillSource::Workspace => ws.join(".agents/skills"),
            _ => base.join(src.as_str()),
        };
        for (src, marker) in [
            (SkillSource::Builtin, "builtin"),
            (SkillSource::Market, "market"),
            (SkillSource::Local, "local"),
        ] {
            write_skill(
                &roots_of(src),
                "same",
                &format!("---\nname: same\ndescription: {marker}\n---\n{marker}"),
            );
        }
        let globals = |dirs: &[SkillSource]| -> Vec<SkillRoot> {
            dirs.iter()
                .map(|s| SkillRoot { dir: roots_of(*s), source: *s })
                .collect()
        };
        // 只有 builtin + market：market 胜
        let f = scan(&globals(&[SkillSource::Builtin, SkillSource::Market]), None);
        assert_eq!(f[0].source, SkillSource::Market);
        // 加 local：local 胜
        let f = scan(
            &globals(&[SkillSource::Builtin, SkillSource::Market, SkillSource::Local]),
            None,
        );
        assert_eq!(f[0].source, SkillSource::Local);
        // 加工作区：workspace 胜
        write_skill(
            &roots_of(SkillSource::Workspace),
            "same",
            "---\nname: same\ndescription: ws\n---\nws",
        );
        let f = scan(
            &globals(&[SkillSource::Builtin, SkillSource::Market, SkillSource::Local]),
            Some(&ws),
        );
        assert_eq!(f[0].source, SkillSource::Workspace);
    }

    #[test]
    fn scan_skips_missing_dirs_and_broken_skills() {
        let base = tmp("scan_skips");
        write_skill(&base, "good", FULL);
        write_skill(&base, "broken", "没有 frontmatter");
        // 没有 SKILL.md 的目录不是技能
        std::fs::create_dir_all(base.join("not-a-skill")).unwrap();
        // 隐藏目录跳过
        write_skill(&base, ".hidden", FULL);
        let found = scan(&[SkillRoot { dir: base.clone(), source: SkillSource::Local }], None);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "demo");
        // 根目录本身不存在也不报错
        assert!(scan(&[SkillRoot { dir: base.join("nope"), source: SkillSource::Market }], None).is_empty());
    }

    #[test]
    fn scan_with_globals_uses_workspace_only_when_unset() {
        // 测试进程内 GLOBAL_ROOTS 未被 set，行为应等价于只扫工作区
        let base = tmp("scan_globals");
        let ws = base.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        write_skill(&ws.join(".agents/skills"), "w", "---\nname: w\ndescription: d\n---\nb");
        let found = scan_with_globals(&ws);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "w");
    }

    // ---- L1 索引 ----

    #[test]
    fn render_index_empty_when_no_skills() {
        assert!(render_index(&[]).is_empty());
    }

    #[test]
    fn render_index_lists_names_and_flattens_newlines() {
        let skills = vec![SkillManifest {
            name: "demo".into(),
            description: "第一行\n第二行".into(),
            version: "0.1.0".into(),
            allowed_tools: vec![],
            body: "b".into(),
            source: SkillSource::Builtin,
            dir: PathBuf::new(),
        }];
        let idx = render_index(&skills);
        assert!(idx.contains("# 技能"));
        assert!(idx.contains("- demo：第一行 第二行"));
        // 索引里不得出现换行折断的描述行
        assert!(!idx.contains("第一行\n"));
        assert!(idx.contains("load_skill"));
    }

    // ---- 激活闸门 ----

    fn manifest(name: &str, tools: &[&str]) -> SkillManifest {
        SkillManifest {
            name: name.into(),
            description: "d".into(),
            version: "0.1.0".into(),
            allowed_tools: tools.iter().map(|s| s.to_string()).collect(),
            body: "b".into(),
            source: SkillSource::Local,
            dir: PathBuf::new(),
        }
    }

    #[test]
    fn gate_allows_everything_without_active_skills() {
        assert!(matches!(gate_active_skill("write_file", &[]), SkillVerdict::Allow));
    }

    #[test]
    fn gate_empty_declaration_does_not_narrow() {
        let active = vec![manifest("loose", &[])];
        assert!(matches!(gate_active_skill("write_file", &active), SkillVerdict::Allow));
    }

    #[test]
    fn gate_denies_tools_outside_declaration() {
        let active = vec![manifest("reader", &["read_file", "search_workspace"])];
        match gate_active_skill("write_file", &active) {
            SkillVerdict::Deny(msg) => {
                assert!(msg.contains("reader"), "回执应点名技能：{msg}");
                assert!(msg.contains("write_file"));
                assert!(msg.contains("read_file"), "应列出可用工具：{msg}");
                assert!(msg.contains("<answer>"), "应告知如何恢复：{msg}");
            }
            SkillVerdict::Allow => panic!("未声明的写工具必须被拦"),
        }
        assert!(matches!(gate_active_skill("read_file", &active), SkillVerdict::Allow));
    }

    #[test]
    fn gate_load_skill_is_always_allowed() {
        // 否则激活一个技能后再也无法加载或切换其他技能
        let active = vec![manifest("reader", &["read_file"])];
        assert!(matches!(gate_active_skill("load_skill", &active), SkillVerdict::Allow));
    }

    #[test]
    fn gate_unions_declarations_of_multiple_active_skills() {
        // 模型先加载只读技能调研，再加载写技能动手：并集保证后者可用
        let active = vec![
            manifest("reader", &["read_file"]),
            manifest("writer", &["write_file"]),
        ];
        assert!(matches!(gate_active_skill("read_file", &active), SkillVerdict::Allow));
        assert!(matches!(gate_active_skill("write_file", &active), SkillVerdict::Allow));
        assert!(matches!(gate_active_skill("run_script", &active), SkillVerdict::Deny(_)));
    }

    // ---- load_skill 工具 ----

    /// 随安装包分发的内置演示技能必须始终可解析。
    ///
    /// 这条盯着真实文件而非测试字面量：改坏了 SKILL.md（手滑动 frontmatter、
    /// 引入非法 name）时，编译与其余测试都无感，只有它会在发版前拦下。
    #[test]
    fn shipped_builtin_demo_skill_parses() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/resources/builtin-skills/code-explainer/SKILL.md"
        );
        let content = std::fs::read_to_string(path).unwrap();
        let m = parse_skill_md(&content).unwrap();
        assert_eq!(m.name, "code-explainer");
        assert!(!m.description.is_empty());
        assert_eq!(m.version, "0.1.0");
        // 只读技能：声明里不得出现写/执行工具，否则激活期会自相矛盾
        for t in ["write_file", "string_replace", "replace_lines", "run_script"] {
            assert!(!m.allowed_tools.contains(&t.to_string()), "演示技能不应声明 {t}");
        }
        assert!(m.allowed_tools.contains(&"read_file".to_string()));
        assert!(m.body.contains("资深架构师"));
    }

    #[test]
    fn load_skill_body_returns_full_guide() {
        let base = tmp("load_body");
        let ws = base.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        write_skill(&ws.join(".agents/skills"), "demo", FULL);
        let body = load_skill_body(&ws, "demo").unwrap();
        assert!(body.contains("已加载技能「demo」"));
        assert!(body.contains("第一步。"));
        assert!(body.contains("read_file、run_script"), "应回示工具范围");
    }

    #[test]
    fn load_skill_body_unknown_name_lists_available() {
        let base = tmp("load_unknown");
        let ws = base.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        write_skill(&ws.join(".agents/skills"), "demo", FULL);
        let err = load_skill_body(&ws, "nope").unwrap_err();
        assert!(err.contains("不存在"));
        assert!(err.contains("demo"), "应列出可用技能帮助模型纠正：{err}");
        assert!(load_skill_body(&ws, "").is_err());
        assert!(load_skill_body(&ws, "  ").is_err());
    }

    // ---- v0.6.1：禁用过滤与删除策略 ----

    #[test]
    fn without_disabled_filters_by_exact_name() {
        let all = vec![
            manifest("alpha", &[]),
            manifest("beta", &[]),
            manifest("beta-extra", &[]),
        ];
        // 空名单 = 原样返回（不白跑一次过滤）
        assert_eq!(without_disabled(all.clone(), &[]).len(), 3);
        // 精确匹配：禁用 beta 不能连 beta-extra 一起干掉
        let kept = without_disabled(all.clone(), &["beta".to_string()]);
        let names: Vec<&str> = kept.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "beta-extra"]);
        // 大小写不同不算命中（name 规范本就要求小写，这里是防呆）
        assert_eq!(
            without_disabled(all.clone(), &["BETA".to_string()]).len(),
            3
        );
        // 名单里有不存在的名字也不影响
        assert_eq!(without_disabled(all, &["ghost".to_string()]).len(), 3);
    }

    #[test]
    fn deletable_only_allows_market_and_local() {
        assert!(deletable(SkillSource::Local).is_ok());
        assert!(deletable(SkillSource::Market).is_ok());
        // 内置：删了下次更新就回来，没有意义
        assert!(deletable(SkillSource::Builtin).unwrap_err().contains("内置"));
        // 工作区：属于用户的 Git 仓库，不能替人删项目文件
        assert!(deletable(SkillSource::Workspace).unwrap_err().contains("工作区"));
    }
}
