//! 操作时间线（v0.6.2）
//!
//! 记录模型在一次会话里的**全部操作**：用户说了什么、模型答了什么、
//! 调用了哪些工具（参数与结果）、什么时候被拒、上下文什么时候被压缩。
//!
//! ## 为什么要有它
//!
//! 对话流是「结果视图」：它只呈现最终留下的文字与动作卡片，
//! 过程信息（谁调了什么、为什么调、耗时多久）被压扁了。
//! 当模型表现不对劲时，用户需要看到的是**过程**，而不是结论。
//!
//! ## 对话级隔离
//!
//! 每条记录都带 `session_id`。查某会话只取它的行——这是「对话级隔离」
//! 的实现方式，不需要额外的过滤逻辑。
//!
//! ## 存储边界
//!
//! 落库由 `db` 模块负责，本模块只定义**记录形状**与**纯函数**
//! （分组、统计、导出）。runner 通过回调写入，与 `persist_todos` 同一套思路：
//! agent 层不碰数据库。

use std::collections::BTreeMap;

/// 时间线条目的类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    /// 用户消息
    User,
    /// 模型回复
    Assistant,
    /// 工具调用
    Tool,
    /// 权限拒绝
    Denied,
    /// 上下文压缩
    Context,
    /// 任务清单变化
    Todo,
    /// 错误
    Error,
    /// 提示（如「已停止生成」）
    Notice,
}

impl EntryKind {
    /// 面向用户的标签。
    pub fn label(&self) -> &'static str {
        match self {
            EntryKind::User => "用户",
            EntryKind::Assistant => "助手",
            EntryKind::Tool => "工具",
            EntryKind::Denied => "拒绝",
            EntryKind::Context => "上下文",
            EntryKind::Todo => "清单",
            EntryKind::Error => "错误",
            EntryKind::Notice => "提示",
        }
    }
}

/// 一条时间线记录。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TimelineEntry {
    /// 会话 id —— 对话级隔离的键
    pub session_id: String,
    /// 会话内序号（升序）
    pub seq: i64,
    /// 毫秒时间戳
    pub ts_ms: i64,
    /// 第几轮（工具轮次）
    pub turn: i64,
    /// 类型
    pub kind: EntryKind,
    /// 一行摘要
    pub title: String,
    /// 详情（工具参数、结果全文等），可空
    pub detail: Option<String>,
    /// 是否成功（工具与拒绝类有意义）
    pub ok: bool,
    /// 耗时（毫秒），仅工具类有
    pub duration_ms: Option<i64>,
}

impl TimelineEntry {
    /// 新建一条记录（seq 由调用方分配）。
    pub fn new(
        session_id: &str,
        seq: i64,
        ts_ms: i64,
        turn: i64,
        kind: EntryKind,
        title: impl Into<String>,
    ) -> Self {
        Self {
            session_id: session_id.to_string(),
            seq,
            ts_ms,
            turn,
            kind,
            title: title.into(),
            detail: None,
            ok: true,
            duration_ms: None,
        }
    }

    /// 附上详情。
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    /// 标记为失败。
    pub fn failed(mut self) -> Self {
        self.ok = false;
        self
    }

    /// 附上耗时。
    pub fn with_duration(mut self, ms: i64) -> Self {
        self.duration_ms = Some(ms);
        self
    }
}

/// 按轮次分组的时间线。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct TurnGroup {
    /// 轮次号
    pub turn: i64,
    /// 该轮的第一条记录时间
    pub ts_ms: i64,
    /// 该轮的记录
    pub entries: Vec<TimelineEntry>,
}

/// 按轮次分组。同一轮内的记录保持原有顺序。
///
/// 轮次号为 0 的记录（用户消息通常在第一轮之前）单独成组——
/// 它们不属于任何一轮工具调用。
pub fn group_by_turn(entries: &[TimelineEntry]) -> Vec<TurnGroup> {
    let mut map: BTreeMap<i64, Vec<TimelineEntry>> = BTreeMap::new();
    for e in entries {
        map.entry(e.turn).or_default().push(e.clone());
    }
    map.into_iter()
        .map(|(turn, mut items)| {
            items.sort_by_key(|e| e.seq);
            let ts_ms = items.first().map(|e| e.ts_ms).unwrap_or(0);
            TurnGroup {
                turn,
                ts_ms,
                entries: items,
            }
        })
        .collect()
}

/// 时间线的统计概览。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub struct TimelineStats {
    /// 轮次数
    pub turns: usize,
    /// 工具调用数
    pub tools: usize,
    /// 错误数
    pub errors: usize,
    /// 被拒次数
    pub denied: usize,
    /// 工具总耗时（毫秒）
    pub tool_ms: i64,
}

/// 统计概览。
pub fn stats(entries: &[TimelineEntry]) -> TimelineStats {
    let mut s = TimelineStats::default();
    let mut turns: std::collections::BTreeSet<i64> = Default::default();
    for e in entries {
        turns.insert(e.turn);
        match e.kind {
            EntryKind::Tool => {
                s.tools += 1;
                s.tool_ms += e.duration_ms.unwrap_or(0);
            }
            EntryKind::Error => s.errors += 1,
            EntryKind::Denied => s.denied += 1,
            _ => {}
        }
    }
    s.turns = turns.len();
    s
}

/// 按关键词过滤（标题或详情包含）。
///
/// 大小写不敏感。空关键词返回全部——调用方不必特判。
pub fn filter(entries: &[TimelineEntry], query: &str) -> Vec<TimelineEntry> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return entries.to_vec();
    }
    entries
        .iter()
        .filter(|e| {
            e.title.to_lowercase().contains(&q)
                || e.detail
                    .as_ref()
                    .map(|d| d.to_lowercase().contains(&q))
                    .unwrap_or(false)
        })
        .cloned()
        .collect()
}

/// 导出为 Markdown。
///
/// 用户可复制到别处留存——「透明」不只是界面上的一个视图，
/// 也意味着数据能被用户带走。
pub fn to_markdown(session_title: &str, entries: &[TimelineEntry]) -> String {
    let mut out = String::new();
    out.push_str(&format!("# 操作时间线 · {session_title}\n\n"));

    let s = stats(entries);
    out.push_str(&format!(
        "{} 轮 · {} 次工具调用 · {} 次错误 · {} 次拒绝 · 工具耗时 {:.1}s\n\n",
        s.turns,
        s.tools,
        s.errors,
        s.denied,
        s.tool_ms as f64 / 1000.0
    ));

    for group in group_by_turn(entries) {
        let head = if group.turn == 0 {
            "对话开始".to_string()
        } else {
            format!("第 {} 轮", group.turn)
        };
        out.push_str(&format!("\n## {head}\n\n"));
        for e in &group.entries {
            let mark = if e.ok { "" } else { "（失败）" };
            let dur = e
                .duration_ms
                .map(|ms| format!(" · {ms}ms"))
                .unwrap_or_default();
            out.push_str(&format!(
                "- **{}** {}{}{} — {}\n",
                e.kind.label(),
                e.title,
                mark,
                dur,
                fmt_time(e.ts_ms)
            ));
            if let Some(detail) = &e.detail {
                // 详情缩进一级，避免与列表项混淆
                for line in detail.lines() {
                    out.push_str(&format!("  > {line}\n"));
                }
            }
        }
    }
    out
}

/// 毫秒时间戳 → `HH:MM:SS`（UTC）。
///
/// 用 UTC 而不是本地时间：时间线是**记录**，跨时区查看时绝对时间
/// 更可比。本地时间由前端按浏览器时区渲染。
fn fmt_time(ts_ms: i64) -> String {
    let secs = ts_ms.div_euclid(1000);
    let tod = secs.rem_euclid(86_400);
    format!(
        "{:02}:{:02}:{:02}",
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(seq: i64, turn: i64, kind: EntryKind, title: &str) -> TimelineEntry {
        TimelineEntry::new("s1", seq, 1_700_000_000_000 + seq, turn, kind, title)
    }

    #[test]
    fn groups_by_turn_in_order() {
        let entries = vec![
            entry(1, 0, EntryKind::User, "你好"),
            entry(2, 1, EntryKind::Assistant, "我来看看"),
            entry(3, 1, EntryKind::Tool, "Read a.rs"),
            entry(4, 2, EntryKind::Tool, "Read b.rs"),
        ];
        let groups = group_by_turn(&entries);
        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0].turn, 0);
        assert_eq!(groups[0].entries.len(), 1);
        assert_eq!(groups[1].entries.len(), 2);
        assert_eq!(groups[2].entries.len(), 1);
    }

    /// 组内按 seq 排序——写入顺序可能与轮次顺序不同。
    #[test]
    fn group_entries_sorted_by_seq() {
        let entries = vec![
            entry(3, 1, EntryKind::Tool, "c"),
            entry(1, 1, EntryKind::Tool, "a"),
            entry(2, 1, EntryKind::Tool, "b"),
        ];
        let groups = group_by_turn(&entries);
        let titles: Vec<&str> = groups[0]
            .entries
            .iter()
            .map(|e| e.title.as_str())
            .collect();
        assert_eq!(titles, vec!["a", "b", "c"]);
    }

    #[test]
    fn stats_counts_kinds() {
        let entries = vec![
            entry(1, 0, EntryKind::User, "x"),
            entry(2, 1, EntryKind::Tool, "t1").with_duration(100),
            entry(3, 1, EntryKind::Tool, "t2").with_duration(250),
            entry(4, 2, EntryKind::Error, "boom"),
            entry(5, 2, EntryKind::Denied, "nope"),
        ];
        let s = stats(&entries);
        assert_eq!(s.turns, 3);
        assert_eq!(s.tools, 2);
        assert_eq!(s.errors, 1);
        assert_eq!(s.denied, 1);
        assert_eq!(s.tool_ms, 350);
    }

    #[test]
    fn filter_matches_title_and_detail() {
        let entries = vec![
            entry(1, 1, EntryKind::Tool, "Read main.rs"),
            entry(2, 1, EntryKind::Tool, "Write out.txt")
                .with_detail("内容里有 needle"),
            entry(3, 1, EntryKind::Assistant, "好的"),
        ];
        assert_eq!(filter(&entries, "main").len(), 1);
        assert_eq!(filter(&entries, "needle").len(), 1);
        assert_eq!(filter(&entries, "READ").len(), 1); // 大小写不敏感
        assert_eq!(filter(&entries, "").len(), 3);
        assert_eq!(filter(&entries, "zzz").len(), 0);
    }

    /// 导出要包含关键信息：类型、标题、耗时、详情。
    #[test]
    fn markdown_contains_key_info() {
        let entries = vec![
            entry(1, 0, EntryKind::User, "改一下这个"),
            entry(2, 1, EntryKind::Tool, "Read main.rs")
                .with_detail("line 1\nline 2")
                .with_duration(42),
            entry(3, 1, EntryKind::Error, "炸了").failed(),
        ];
        let md = to_markdown("测试会话", &entries);
        assert!(md.contains("操作时间线 · 测试会话"));
        assert!(md.contains("第 1 轮"));
        assert!(md.contains("Read main.rs"));
        assert!(md.contains("42ms"));
        assert!(md.contains("> line 1"));
        assert!(md.contains("炸了"));
        assert!(md.contains("失败"));
    }

    #[test]
    fn markdown_has_no_empty_detail_block() {
        let entries = vec![entry(1, 1, EntryKind::Tool, "Read a.rs")];
        let md = to_markdown("t", &entries);
        assert!(!md.contains("> \n"), "无详情时不该有空引用行: {md}");
    }
}
