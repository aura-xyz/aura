//! prompts 域的数据模型与纯解析（v0.8.1 · M2-05）。
//!
//! `prompts/get` 返回的是**不可信文本**：这里只把它整理成可放进输入框的
//! 纯文本，不执行、不写 history、不交给模型；由用户看过再按发送键。
//! 网络请求与缓存仍在 `client.rs`。

use serde_json::Value;

/// 单服务器提示词条数上限。
pub const MAX_PROMPTS: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct McpPromptArg {
    pub name: String,
    pub description: String,
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct McpPrompt {
    pub name: String,
    pub description: String,
    pub arguments: Vec<McpPromptArg>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct McpPromptMessage {
    pub role: String,
    pub text: String,
}

fn text(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

/// 解析 `prompts/list` 的一页。缺 name 的条目直接丢弃。
pub fn parse_prompt_page(result: &Value) -> Vec<McpPrompt> {
    let mut out = Vec::new();
    let Some(arr) = result.get("prompts").and_then(|p| p.as_array()) else {
        return out;
    };
    for item in arr {
        let name = text(item, "name");
        if name.trim().is_empty() {
            continue;
        }
        let arguments = item
            .get("arguments")
            .and_then(|a| a.as_array())
            .map(|args| {
                args.iter()
                    .map(|a| McpPromptArg {
                        name: text(a, "name"),
                        description: text(a, "description"),
                        required: a
                            .get("required")
                            .and_then(|r| r.as_bool())
                            .unwrap_or(false),
                    })
                    .filter(|a| !a.name.trim().is_empty())
                    .collect()
            })
            .unwrap_or_default();
        out.push(McpPrompt {
            name,
            description: text(item, "description"),
            arguments,
        });
    }
    out
}

/// content 可能是字符串、`{type:"text",text}` 或多段数组，按规范都要兼容。
fn content_text(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    if let Some(obj) = v.as_object() {
        if let Some(t) = obj.get("text").and_then(|t| t.as_str()) {
            return t.to_string();
        }
    }
    if let Some(arr) = v.as_array() {
        return arr
            .iter()
            .filter_map(|part| part.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

/// 解析 `prompts/get` 的 messages[]。协议里的 content 形态很多，取不到就留空。
pub fn parse_prompt_messages(result: &Value) -> Vec<McpPromptMessage> {
    let Some(arr) = result.get("messages").and_then(|m| m.as_array()) else {
        // 少数服务器直接给单个 content.text
        if let Some(t) = result.get("content") {
            let text = content_text(t);
            if !text.is_empty() {
                return vec![McpPromptMessage {
                    role: "user".to_string(),
                    text,
                }];
            }
        }
        return Vec::new();
    };
    arr.iter()
        .map(|m| McpPromptMessage {
            role: {
                let r = text(m, "role");
                if r.is_empty() { "user".to_string() } else { r }
            },
            text: m
                .get("content")
                .map(content_text)
                .unwrap_or_default(),
        })
        .filter(|m| !m.text.is_empty())
        .collect()
}

/// 填入输入框的纯文本：单条消息直接给正文，多条带角色前缀便于辨认。
/// 绝不解析其中的 `<tool>` 之类协议标记——它是不可信内容。
pub fn prompt_plain_text(messages: &[McpPromptMessage]) -> String {
    if messages.len() == 1 {
        return messages[0].text.clone();
    }
    messages
        .iter()
        .map(|m| format!("[{}] {}", m.role, m.text))
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prompt_page_parses_arguments_and_required_flag() {
        let r = json!({ "prompts": [
            { "name": "review", "description": "代码评审", "arguments": [
                { "name": "path", "description": "路径", "required": true },
                { "name": "tone", "description": "语气" }
            ]},
            { "description": "缺 name" }
        ]});
        let out = parse_prompt_page(&r);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "review");
        assert_eq!(out[0].arguments.len(), 2);
        assert!(out[0].arguments[0].required);
        assert!(!out[0].arguments[1].required);
    }

    #[test]
    fn messages_accept_all_content_shapes() {
        let r = json!({ "messages": [
            { "role": "system", "content": { "type": "text", "text": "你是评审" } },
            { "role": "user", "content": "直接字符串" },
            { "role": "user", "content": [
                { "type": "text", "text": "第一段" },
                { "type": "text", "text": "第二段" }
            ]}
        ]});
        let out = parse_prompt_messages(&r);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].text, "你是评审");
        assert_eq!(out[1].text, "直接字符串");
        assert_eq!(out[2].text, "第一段\n第二段");
    }

    #[test]
    fn single_message_plain_text_has_no_role_prefix() {
        let msgs = vec![McpPromptMessage {
            role: "user".into(),
            text: "<tool>{\"name\":\"x\"}</tool>".into(),
        }];
        // 内容原样保留，交给用户判断；后端不执行任何东西
        assert_eq!(prompt_plain_text(&msgs), "<tool>{\"name\":\"x\"}</tool>");
    }

    #[test]
    fn multiple_messages_keep_role_labels() {
        let msgs = vec![
            McpPromptMessage { role: "system".into(), text: "规则".into() },
            McpPromptMessage { role: "user".into(), text: "问题".into() },
        ];
        assert_eq!(prompt_plain_text(&msgs), "[system] 规则\n\n[user] 问题");
    }
}
