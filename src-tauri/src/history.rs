//! agent 历史的截断。
//!
//! v0.7.0 的「重新生成」与「编辑消息并重跑」都需要把会话回滚到某个位置。
//! 这里只做**纯计算**：给定一份 history，算出该保留多少条。落库与内存
//! 的双写由 `commands.rs` 的 `truncate_history` 负责。
//!
//! ## 为什么需要「真实用户消息」这个概念
//!
//! `history` 里 `role == "user"` 的条目有两种来源：
//!
//! - 用户真的发的那条消息（`runner.rs` 在 `run_turn` 开头 push）
//! - 工具执行结果回填（`<tool_result>…</tool_result>`，也用 user role，
//!   因为 OpenAI 协议要求 tool 结果挂在 user 侧）
//!
//! 前端界面上的「一条消息」与 history 里的「一条 entry」**不是一一对应**：
//! 一条 assistant 界面消息在 history 里可能是多条 assistant + 多条
//! tool_result 的组合。所以前端算不出 history 下标，只能表达
//! 「保留到第几条用户消息为止」这个语义，由后端翻译成下标。
//!
//! ## 判定「真实用户消息」的依据
//!
//! 靠 **content 不以 `<tool_result>` 开头**。这条不变量由代码保证：
//! 所有工具结果都由 `runner.rs::tool_result_tag` 或同源的
//! `format!("<tool_result>…")` 生成，见本模块的测试。

use serde_json::Value;

/// 工具结果条目的固定前缀。见 `runner.rs::tool_result_tag`。
///
/// 注意**不带结尾的 `>`**：带 name 属性的形式是
/// `<tool_result name="read_file">…`，不带属性的是 `<tool_result>…`。
/// 两种都要匹配，所以前缀只能取到 `<tool_result`。
pub const TOOL_RESULT_PREFIX: &str = "<tool_result";

/// 该 entry 是否是一条**用户真实发送**的消息（而非工具结果回填）。
pub fn is_real_user_message(entry: &Value) -> bool {
    if entry.get("role").and_then(|v| v.as_str()) != Some("user") {
        return false;
    }
    let content = entry.get("content").and_then(|v| v.as_str()).unwrap_or("");
    !content.starts_with(TOOL_RESULT_PREFIX)
}

/// history 中真实用户消息的条数。
pub fn count_user_messages(history: &[Value]) -> usize {
    history.iter().filter(|e| is_real_user_message(e)).count()
}

/// 截断结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Truncation {
    /// 截断后保留的 entry 数。
    pub keep_entries: usize,
    /// 截断后仍然存在的真实用户消息条数。
    pub keep_user_messages: usize,
}

/// 计算「保留到第 `keep_through_user` 条真实用户消息为止」的截断位置。
///
/// 语义（与 v0.7.0 计划书一致）：
///
/// - `keep_through_user = k` → 保留第 1..=k 条用户消息，以及第 k 条**之后**
///   紧跟的那条 assistant 之前的所有内容；第 k 条用户消息触发的回答被删掉。
///   用于「重新生成第 k 条回答」。
/// - `keep_through_user = k - 1` → 连第 k 条用户消息本身也删掉。
///   用于「编辑第 k 条用户消息并重跑」（新内容会作为新的第 k 条 push 进去）。
/// - `keep_through_user = 0` → 清空历史。
///
/// 越界（`keep_through_user` 超过实际用户消息数）**不报错**，而是截到末尾并
/// 返回实际值——调用方（前端）拿到的 `keep_user_messages` 会小于请求值，
/// 可以据此发现数据不一致，但不会因为一个计数错误把整次操作搞失败。
pub fn truncate_plan(history: &[Value], keep_through_user: usize) -> Truncation {
    if keep_through_user == 0 {
        return Truncation {
            keep_entries: 0,
            keep_user_messages: 0,
        };
    }

    let mut seen = 0usize;
    for (idx, entry) in history.iter().enumerate() {
        if is_real_user_message(entry) {
            seen += 1;
            if seen == keep_through_user {
                // 保留到这条用户消息（含），它之后的全部内容丢弃
                return Truncation {
                    keep_entries: idx + 1,
                    keep_user_messages: seen,
                };
            }
        }
    }

    // 请求的条数超过实际数量：保留全部
    Truncation {
        keep_entries: history.len(),
        keep_user_messages: seen,
    }
}

/// 按计划截断，返回新的 history（原地不动传入的切片）。
pub fn apply_truncation(history: &[Value], keep_through_user: usize) -> (Vec<Value>, Truncation) {
    let plan = truncate_plan(history, keep_through_user);
    let kept = history[..plan.keep_entries].to_vec();
    (kept, plan)
}

/// 侧作用检查：统计被截断段里的写/执行工具调用。
///
/// 用于「重新生成/编辑重跑」前预检：若用户即将丢弃的历史里包含
/// 写文件或执行命令，弹确认框让用户二次确认。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SideEffects {
    /// 写类工具调用次数（write_file/string_replace/replace_lines）。
    pub writes: usize,
    /// 执行类工具调用次数（run_script）。
    pub execs: usize,
    /// 受影响的目标路径（去重）。run_script 用命令首行。
    pub targets: Vec<String>,
}

/// 检查 history 中 `keep_through_user` 之后被截断部分的侧作用。
///
/// 逻辑：
/// 1. 复用 `truncate_plan` 得到 `keep_entries`
/// 2. 遍历 `history[keep_entries..]`，正则匹配 `<tool_result name="..." target="...">`
/// 3. 用 `registry::find(name)` 判定 `ToolKind`，累计 writes/execs，收集 target
/// 4. target 需反转义（`tool_result_tag` 里把 `"` 转为 `'`）
pub fn inspect_side_effects(history: &[Value], keep_through_user: usize) -> SideEffects {
    use crate::tools::registry::{find, ToolKind};

    let plan = truncate_plan(history, keep_through_user);
    let mut writes = 0usize;
    let mut execs = 0usize;
    let mut targets = Vec::new();

    for entry in &history[plan.keep_entries..] {
        let content = match entry.get("content").and_then(|v| v.as_str()) {
            Some(c) => c,
            None => continue,
        };

        // 匹配 <tool_result name="..." target="..."> 或 <tool_result name="...">
        let re = regex::Regex::new(r#"<tool_result\s+name="([^"]+)"(?:\s+target="([^"]*)")?"#).unwrap();
        for cap in re.captures_iter(content) {
            let name = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let target = cap.get(2).map(|m| m.as_str()).unwrap_or("");

            if let Some(spec) = find(name) {
                match spec.kind {
                    ToolKind::Write => {
                        writes += 1;
                        if !target.is_empty() {
                            let unescaped = target.replace('\'', "\"");
                            if !targets.contains(&unescaped) {
                                targets.push(unescaped);
                            }
                        }
                    }
                    ToolKind::Exec => {
                        execs += 1;
                        if !target.is_empty() {
                            let unescaped = target.replace('\'', "\"");
                            if !targets.contains(&unescaped) {
                                targets.push(unescaped);
                            }
                        }
                    }
                    ToolKind::Read => {}
                }
            }
        }
    }

    SideEffects { writes, execs, targets }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn user(content: &str) -> Value {
        json!({ "role": "user", "content": content })
    }

    fn assistant(content: &str) -> Value {
        json!({ "role": "assistant", "content": content })
    }

    fn tool_result(body: &str) -> Value {
        json!({ "role": "user", "content": format!("<tool_result name=\"read_file\">{}</tool_result>", body) })
    }

    /// 一条典型的多轮历史：
    /// u1 / a1 / tool / a1b / u2 / a2
    fn sample() -> Vec<Value> {
        vec![
            user("第一个问题"),
            assistant("第一个回答"),
            tool_result("文件内容"),
            assistant("读了文件后的回答"),
            user("第二个问题"),
            assistant("第二个回答"),
        ]
    }

    #[test]
    fn 真实用户消息与工具结果可区分() {
        let h = sample();
        assert!(is_real_user_message(&h[0]));
        assert!(!is_real_user_message(&h[1]));
        assert!(!is_real_user_message(&h[2]));
        assert!(is_real_user_message(&h[4]));
        assert_eq!(count_user_messages(&h), 2);
    }

    #[test]
    fn 工具结果前缀是不可变不变量() {
        // 任何由 tool_result_tag 生成的条目都必须以该前缀开头。
        // 这条不变量是 is_real_user_message 的正确性依据。
        let h = sample();
        for e in h.iter().filter(|e| e.get("role").and_then(|v| v.as_str()) == Some("user")) {
            let c = e.get("content").and_then(|v| v.as_str()).unwrap_or("");
            if !c.starts_with(TOOL_RESULT_PREFIX) {
                assert!(is_real_user_message(e));
            }
        }
    }

    /// 带 name 属性与不带属性的两种工具结果形式都要被识别。
    /// v0.7.0 初次实现时前缀写成了 `<tool_result>`（带 `>`），
    /// 漏掉了 `<tool_result name="…">` 这种形式，工具结果被当成了用户消息。
    #[test]
    fn 工具结果的两种形式都能识别() {
        let with_name = json!({ "role": "user", "content": "<tool_result name=\"read_file\">x</tool_result>" });
        let without_name = json!({ "role": "user", "content": "<tool_result>Error: boom</tool_result>" });
        assert!(!is_real_user_message(&with_name));
        assert!(!is_real_user_message(&without_name));
    }

    #[test]
    fn 截断到第0条即清空() {
        let (kept, plan) = apply_truncation(&sample(), 0);
        assert!(kept.is_empty());
        assert_eq!(plan.keep_entries, 0);
        assert_eq!(plan.keep_user_messages, 0);
    }

    #[test]
    fn 截断到第1条用户消息保留该问题删掉其后的回答() {
        let (kept, plan) = apply_truncation(&sample(), 1);
        assert_eq!(plan.keep_user_messages, 1);
        // 只剩 u1 —— 它的回答 a1 被删掉了，这正是「重新生成第 1 条回答」要的
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0]["content"], "第一个问题");
    }

    #[test]
    fn 重新生成保留问题但删掉回答() {
        // 「重新生成第 1 条回答」= 保留 u1，删掉 a1 及其后
        let (kept, _) = apply_truncation(&sample(), 1);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0]["content"], "第一个问题");
        // 截断点之后的内容确实没了
        assert!(!kept.iter().any(|e| e["content"] == "第一个回答"));
        assert!(!kept.iter().any(|e| e["content"] == "第二个问题"));
    }

    #[test]
    fn 编辑重跑连问题本身也删掉() {
        // 「编辑第 2 条用户消息」= 保留到第 1 条用户消息为止
        let (kept, plan) = apply_truncation(&sample(), 1);
        assert_eq!(plan.keep_user_messages, 1);
        assert!(!kept.iter().any(|e| e["content"] == "第二个问题"));
    }

    #[test]
    fn 截断到第2条用户消息保留到它为止() {
        let (kept, plan) = apply_truncation(&sample(), 2);
        assert_eq!(plan.keep_user_messages, 2);
        // 保留 u1/a1/tool/a1b/u2，删掉 a2（u2 触发的回答）
        assert_eq!(kept.len(), 5);
        assert!(kept.iter().any(|e| e["content"] == "第二个问题"));
        assert!(!kept.iter().any(|e| e["content"] == "第二个回答"));
    }

    #[test]
    fn 超出实际条数时截到末尾而不报错() {
        let (kept, plan) = apply_truncation(&sample(), 99);
        assert_eq!(kept.len(), 6);
        assert_eq!(plan.keep_user_messages, 2);
    }

    #[test]
    fn 空历史不会崩() {
        let (kept, plan) = apply_truncation(&[], 3);
        assert!(kept.is_empty());
        assert_eq!(plan.keep_entries, 0);
        assert_eq!(plan.keep_user_messages, 0);
    }

    #[test]
    fn 截断不修改传入的切片() {
        let h = sample();
        let before = h.clone();
        let _ = apply_truncation(&h, 1);
        assert_eq!(h, before);
    }

    #[test]
    fn 连续多次截断幂等() {
        let h = sample();
        let (once, _) = apply_truncation(&h, 1);
        let (twice, _) = apply_truncation(&once, 1);
        assert_eq!(once, twice);
    }

    #[cfg(test)]
    mod side_effects_tests {
        use super::*;
        use serde_json::json;

        fn user(content: &str) -> Value {
            json!({ "role": "user", "content": content })
        }

        fn assistant(content: &str) -> Value {
            json!({ "role": "assistant", "content": content })
        }

        fn tool_result(name: &str, target: &str, body: &str) -> Value {
            let target_attr = if target.is_empty() {
                String::new()
            } else {
                format!(r#" target="{}""#, target.replace('"', "'"))
            };
            json!({
                "role": "user",
                "content": format!("<tool_result name=\"{}\"{}>{}</tool_result>", name, target_attr, body)
            })
        }

        #[test]
        fn 副作用检查_只读工具不计入() {
            let h = vec![
                user("问题"),
                assistant("回答"),
                tool_result("read_file", "src/main.rs", "内容"),
                tool_result("search_workspace", "关键词", "片段"),
                user("第二个问题"),
                assistant("第二个回答"),
            ];
            let effects = inspect_side_effects(&h, 1);
            assert_eq!(effects.writes, 0);
            assert_eq!(effects.execs, 0);
            assert!(effects.targets.is_empty());
        }

        #[test]
        fn 副作用检查_写工具计入_writes() {
            let h = vec![
                user("问题"),
                assistant("回答"),
                tool_result("write_file", "src/main.rs", "ok"),
                tool_result("string_replace", "src/lib.rs", "ok"),
                tool_result("replace_lines", "src/utils.rs", "ok"),
                user("第二个问题"),
                assistant("第二个回答"),
            ];
            let effects = inspect_side_effects(&h, 1);
            assert_eq!(effects.writes, 3);
            assert_eq!(effects.execs, 0);
            assert_eq!(effects.targets.len(), 3);
            assert!(effects.targets.contains(&"src/main.rs".to_string()));
            assert!(effects.targets.contains(&"src/lib.rs".to_string()));
            assert!(effects.targets.contains(&"src/utils.rs".to_string()));
        }

        #[test]
        fn 副作用检查_执行工具计入_execs() {
            let h = vec![
                user("问题"),
                assistant("回答"),
                tool_result("run_script", "cargo build", "exit 0"),
                tool_result("run_script", "cargo test", "exit 0"),
                user("第二个问题"),
                assistant("第二个回答"),
            ];
            let effects = inspect_side_effects(&h, 1);
            assert_eq!(effects.writes, 0);
            assert_eq!(effects.execs, 2);
            assert_eq!(effects.targets.len(), 2);
            assert!(effects.targets.contains(&"cargo build".to_string()));
            assert!(effects.targets.contains(&"cargo test".to_string()));
        }

        #[test]
        fn 副作用检查_同文件多次写入去重() {
            let h = vec![
                user("问题"),
                assistant("回答"),
                tool_result("write_file", "src/main.rs", "ok"),
                tool_result("string_replace", "src/main.rs", "ok"),
                user("第二个问题"),
                assistant("第二个回答"),
            ];
            let effects = inspect_side_effects(&h, 1);
            assert_eq!(effects.writes, 2);
            assert_eq!(effects.targets.len(), 1);
            assert_eq!(effects.targets[0], "src/main.rs");
        }

        #[test]
        fn 副作用检查_target_反转义() {
            let h = vec![
                user("问题"),
                assistant("回答"),
                tool_result("write_file", "src/main.rs", "ok"),
                user("第二个问题"),
                assistant("第二个回答"),
            ];
            let effects = inspect_side_effects(&h, 1);
            assert_eq!(effects.targets[0], "src/main.rs");
        }

        #[test]
        fn 副作用检查_keep_through_user_0_全量检查() {
            let h = vec![
                user("问题"),
                assistant("回答"),
                tool_result("write_file", "src/main.rs", "ok"),
            ];
            let effects = inspect_side_effects(&h, 0);
            assert_eq!(effects.writes, 1);
        }

        #[test]
        fn 副作用检查_越界按_truncate_plan_语义() {
            let h = vec![
                user("问题"),
                assistant("回答"),
            ];
            let effects = inspect_side_effects(&h, 99);
            assert_eq!(effects.writes, 0);
            assert_eq!(effects.execs, 0);
        }

        #[test]
        fn 副作用检查_空历史() {
            let effects = inspect_side_effects(&[], 3);
            assert_eq!(effects.writes, 0);
            assert_eq!(effects.execs, 0);
            assert!(effects.targets.is_empty());
        }

        #[test]
        fn 副作用检查_未知工具名不计入() {
            let h = vec![
                user("问题"),
                assistant("回答"),
                tool_result("unknown_tool", "x", "ok"),
                user("第二个问题"),
                assistant("第二个回答"),
            ];
            let effects = inspect_side_effects(&h, 1);
            assert_eq!(effects.writes, 0);
            assert_eq!(effects.execs, 0);
        }
    }
}
