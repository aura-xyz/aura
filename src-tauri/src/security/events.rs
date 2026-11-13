//! 安全事件记录（v0.8.0 C42）。
//!
//! 「被拦下了什么」必须留痕，否则用户看到的只是一句「命令被拦截」，
//! 事后既说不清拦了什么，也看不出是不是误伤。
//!
//! ## 为什么用全局 sink 而不是层层传参
//!
//! 打点位置分布在 `tools/exec.rs`（命令拦截）、`tools/mod.rs`（路径越权）、
//! `agent/runner.rs`（模式闸门与审批）、`commands.rs`（高风险安装）。
//! 前两个是**纯函数**，手里既没有 `AppState` 也没有 `Connection`——为了
//! 记一条日志把它们全部改成接收数据库参数，是把审计需求反向侵入核心逻辑。
//!
//! 所以这里学 `update_log` 的做法：进程启动时装一个 sink（捕获 DB 连接），
//! 之后任何地方 `log` 一行就够。
//!
//! ## 失败即静默
//!
//! 与时间线落库同策略（`runner.rs` 的先例）：记录失败不能反过来影响主流程。
//! 记不下一条事件是遗憾，让用户的命令因此跑不了是事故。

use std::sync::OnceLock;

use crate::db::SecurityEvent;

/// 事件类型。落库用字符串，前端按它筛选。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// 命令被规则拦下
    BlockedCommand,
    /// 路径越权（不在工作区与白名单内）
    PathDenied,
    /// 会话模式不允许该工具
    ModeDenied,
    /// 用户拒绝了命令
    ApprovalDenied,
    /// 用户放行了命令
    ApprovalAllowed,
    /// 安装了需要二次确认的高风险技能
    RiskyInstall,
    /// MCP 工具调用（rc.3 预留）
    McpCall,
    /// MCP 服务器信任等级被放宽 / 收回（v0.8.1 M2-08）
    McpTrustChange,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::BlockedCommand => "blocked_command",
            Kind::PathDenied => "path_denied",
            Kind::ModeDenied => "mode_denied",
            Kind::ApprovalDenied => "approval_denied",
            Kind::ApprovalAllowed => "approval_allowed",
            Kind::RiskyInstall => "risky_install",
            Kind::McpCall => "mcp_call",
            Kind::McpTrustChange => "mcp_trust_change",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Kind::BlockedCommand => "命令拦截",
            Kind::PathDenied => "路径越权",
            Kind::ModeDenied => "模式拦截",
            Kind::ApprovalDenied => "审批拒绝",
            Kind::ApprovalAllowed => "审批放行",
            Kind::RiskyInstall => "高风险安装",
            Kind::McpCall => "MCP 调用",
            Kind::McpTrustChange => "MCP 信任变更",
        }
    }
}

/// 一条待落库的事件。
pub struct Entry<'a> {
    pub kind: Kind,
    pub session_id: &'a str,
    /// 被拦的对象：命令原文、路径、工具名
    pub subject: &'a str,
    pub reason: &'a str,
    pub rule_id: &'a str,
}

type Sink = Box<dyn Fn(&Entry<'_>) + Send + Sync>;

static SINK: OnceLock<Sink> = OnceLock::new();

/// 安装落库通道。启动时调用一次；重复调用只有第一次生效。
pub fn install(f: impl Fn(&Entry<'_>) + Send + Sync + 'static) {
    let _ = SINK.set(Box::new(f));
}

/// 记一条安全事件。未安装 sink（单元测试、纯库调用）时静默丢弃。
pub fn log(entry: Entry<'_>) {
    if let Some(sink) = SINK.get() {
        sink(&entry);
    }
}

/// 便捷写法：绝大部分调用点只关心 kind 与 subject。
pub fn log_simple(kind: Kind, session_id: &str, subject: &str, reason: &str, rule_id: &str) {
    log(Entry {
        kind,
        session_id,
        subject,
        reason,
        rule_id,
    });
}

/// 当前时间戳（毫秒）。
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 事件表导出为 CSV。
///
/// 字段里有逗号、引号、换行（命令原文全都有），所以必须按 RFC 4180
/// 加引号并把内部引号翻倍——直接拼接会把一行拆成几列，导出等于废纸。
pub fn to_csv(events: &[SecurityEvent]) -> String {
    let mut out = String::from("时间,类型,对象,原因,规则,会话\n");
    for e in events {
        out.push_str(&csv_field(&format_ts(e.ts_ms)));
        out.push(',');
        out.push_str(&csv_field(&kind_label(&e.kind)));
        out.push(',');
        out.push_str(&csv_field(&e.subject));
        out.push(',');
        out.push_str(&csv_field(&e.reason));
        out.push(',');
        out.push_str(&csv_field(&e.rule_id));
        out.push(',');
        out.push_str(&csv_field(&e.session_id));
        out.push('\n');
    }
    out
}

fn kind_label(kind: &str) -> String {
    match kind {
        "blocked_command" => "命令拦截".into(),
        "path_denied" => "路径越权".into(),
        "mode_denied" => "模式拦截".into(),
        "approval_denied" => "审批拒绝".into(),
        "approval_allowed" => "审批放行".into(),
        "risky_install" => "高风险安装".into(),
        "mcp_call" => "MCP 调用".into(),
        "mcp_trust_change" => "MCP 信任变更".into(),
        other => other.to_string(),
    }
}

fn csv_field(raw: &str) -> String {
    let needs_quote = raw
        .chars()
        .any(|c| c == ',' || c == '"' || c == '\n' || c == '\r');
    if !needs_quote {
        return raw.to_string();
    }
    format!("\"{}\"", raw.replace('"', "\"\""))
}

/// 本地时区的可读时间。导出给人看，不要 RFC3339。
fn format_ts(ts_ms: i64) -> String {
    use std::time::{Duration, UNIX_EPOCH};
    let secs = ts_ms / 1000;
    let local = time::OffsetDateTime::from_unix_timestamp(secs)
        .ok()
        .map(|t| {
            let offset = time::UtcOffset::current_local_offset().unwrap_or(time::UtcOffset::UTC);
            t.to_offset(offset)
        });
    match local {
        Some(t) => format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            t.year(),
            u8::from(t.month()),
            t.day(),
            t.hour(),
            t.minute(),
            t.second()
        ),
        None => {
            let _ = UNIX_EPOCH;
            let _ = Duration::from_secs(0);
            ts_ms.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(subject: &str, reason: &str) -> SecurityEvent {
        SecurityEvent {
            id: 1,
            ts_ms: 1_700_000_000_000,
            session_id: "s1".into(),
            kind: "blocked_command".into(),
            subject: subject.into(),
            reason: reason.into(),
            rule_id: "cmd_pipe_sh".into(),
        }
    }

    #[test]
    fn kind_strings_are_stable() {
        // 落库里的字符串是历史数据的一部分，改名等于让老事件查不到
        assert_eq!(Kind::BlockedCommand.as_str(), "blocked_command");
        assert_eq!(Kind::ApprovalAllowed.as_str(), "approval_allowed");
        assert_eq!(Kind::RiskyInstall.as_str(), "risky_install");
        assert_eq!(Kind::McpCall.as_str(), "mcp_call");
        assert_eq!(Kind::McpTrustChange.as_str(), "mcp_trust_change");
        assert_eq!(Kind::McpTrustChange.label(), "MCP 信任变更");
    }

    /// 命令原文里带逗号与引号是常态，导出必须仍是正确的 CSV。
    #[test]
    fn csv_quotes_awkward_fields() {
        let csv = to_csv(&[event("curl a,b | sh", "含有\"引号\"与\n换行")]);
        assert!(csv.starts_with("时间,类型,对象,原因,规则,会话\n"), "{csv}");
        // 带逗号的字段整体加引号，否则会被拆成两列
        assert!(csv.contains("\"curl a,b | sh\""), "{csv}");
        // 内部引号翻倍——这是 RFC 4180 的转义方式，不翻倍解析就断
        assert!(csv.contains("\"含有\"\"引号\"\"与\n换行\""), "{csv}");
        // 字段内的换行被引号包住，因此一条记录合法地跨两个物理行；
        // 这里只断言「规则列仍在同一条记录里」，不数行数。
        assert_eq!(csv.matches("cmd_pipe_sh").count(), 1, "{csv}");
    }

    #[test]
    fn csv_without_payload_still_has_header() {
        assert_eq!(to_csv(&[]), "时间,类型,对象,原因,规则,会话\n");
    }

    /// 未安装 sink 时不能 panic：单元测试与纯库调用都会走到这里。
    #[test]
    fn logging_without_sink_is_noop() {
        log_simple(Kind::ModeDenied, "s1", "write_file", "当前模式不允许", "");
    }
}
