//! resources 域的数据模型与纯解析（v0.8.1 · M2-03）。
//!
//! URI 由服务器给出，**不可信**：这里只做形状校验，绝不把它映射到本地路径。
//! 内容也不可信：blob 只统计大小、不进对话上下文；文本按字节上限截断。
//! 缓存与网络请求在 `client.rs`，本文件不含 IO，便于单测。

use serde_json::Value;

/// 单条读取结果的字节上限。与文件面板预览口径一致。
pub const MAX_RESOURCE_BYTES: usize = 256 * 1024;
const MAX_URI_BYTES: usize = 2048;
/// 单服务器资源条数上限，防失控服务器撑爆设置页。
pub const MAX_RESOURCES: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct McpResource {
    pub uri: String,
    pub name: String,
    pub description: String,
    pub mime_type: Option<String>,
    /// `resources/templates/list` 产出的 URI 模板，需要参数展开才能读取。
    pub template: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ResourceReadResult {
    pub uri: String,
    pub text: String,
    pub mime_type: Option<String>,
    pub truncated: bool,
    pub total_bytes: usize,
    /// blob 内容的字节数（base64 长度），仅展示、不解码进文本。
    pub blob_bytes: usize,
}

/// URI 只校验形状，不解析路径也不做本地文件映射。
pub fn validate_resource_uri(uri: &str) -> Result<(), String> {
    let t = uri.trim();
    if t.is_empty() {
        return Err("资源 URI 不能为空".into());
    }
    if t.len() > MAX_URI_BYTES {
        return Err("资源 URI 过长".into());
    }
    if t.chars().any(char::is_control) {
        return Err("资源 URI 含非法控制字符".into());
    }
    Ok(())
}

fn field(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

/// 解析 `resources/list` 的一页。缺 uri 的条目直接丢弃。
pub fn parse_resource_page(result: &Value) -> Vec<McpResource> {
    let mut out = Vec::new();
    if let Some(arr) = result.get("resources").and_then(|r| r.as_array()) {
        for item in arr {
            let uri = field(item, "uri");
            if uri.trim().is_empty() {
                continue;
            }
            out.push(McpResource {
                name: field(item, "name"),
                description: field(item, "description"),
                mime_type: item
                    .get("mimeType")
                    .and_then(|m| m.as_str())
                    .map(str::to_string),
                uri,
                template: false,
            });
        }
    }
    // 模板只展示不读取：参数展开规则由服务器定义，二期不替它猜。
    if let Some(arr) = result
        .get("resourceTemplates")
        .and_then(|r| r.as_array())
    {
        for item in arr {
            let uri = field(item, "uriTemplate");
            if uri.trim().is_empty() {
                continue;
            }
            out.push(McpResource {
                name: field(item, "name"),
                description: field(item, "description"),
                mime_type: item
                    .get("mimeType")
                    .and_then(|m| m.as_str())
                    .map(str::to_string),
                uri,
                template: true,
            });
        }
    }
    out
}

/// 解析 `resources/read` 的 contents[]：text 拼接、blob 只记大小。
pub fn parse_resource_contents(result: &Value) -> (String, Option<String>, usize) {
    let mut parts: Vec<String> = Vec::new();
    let mut mime: Option<String> = None;
    let mut blob_bytes = 0usize;
    if let Some(arr) = result.get("contents").and_then(|c| c.as_array()) {
        for item in arr {
            if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                parts.push(t.to_string());
            }
            if let Some(b) = item.get("blob").and_then(|b| b.as_str()) {
                blob_bytes += b.len();
            }
            if mime.is_none() {
                mime = item
                    .get("mimeType")
                    .and_then(|m| m.as_str())
                    .map(str::to_string);
            }
        }
    }
    (parts.join("\n"), mime, blob_bytes)
}

/// 按字节上限裁剪，且不切断 UTF-8 多字节字符。
pub fn truncate_utf8(text: &str, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_string(), true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn uri_validation_rejects_empty_long_and_control_chars() {
        assert!(validate_resource_uri("file:///a").is_ok());
        assert!(validate_resource_uri("  ").is_err());
        assert!(validate_resource_uri(&"x".repeat(MAX_URI_BYTES + 1)).is_err());
        assert!(validate_resource_uri("file:///a\nrm -rf").is_err());
    }

    #[test]
    fn resource_page_parses_resources_and_templates() {
        let r = json!({
            "resources": [
                { "uri": "file:///a.txt", "name": "a", "description": "说明", "mimeType": "text/plain" },
                { "name": "缺 uri" }
            ],
            "resourceTemplates": [
                { "uriTemplate": "db://{table}", "name": "表模板" }
            ]
        });
        let out = parse_resource_page(&r);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].uri, "file:///a.txt");
        assert_eq!(out[0].mime_type.as_deref(), Some("text/plain"));
        assert!(!out[0].template);
        assert!(out[1].template);
    }

    #[test]
    fn contents_never_inline_blob_data() {
        let r = json!({ "contents": [
            { "uri": "x", "mimeType": "image/png", "text": "可读部分" },
            { "uri": "y", "mimeType": "image/png", "blob": "AAAA" }
        ]});
        let (text, mime, blob) = parse_resource_contents(&r);
        assert_eq!(text, "可读部分");
        assert_eq!(mime.as_deref(), Some("image/png"));
        assert_eq!(blob, 4);
        assert!(!text.contains("AAAA"));
    }

    #[test]
    fn truncation_keeps_utf8_boundary() {
        let text = "中".repeat(1000); // 3000 字节
        let (cut, truncated) = truncate_utf8(&text, 100);
        assert!(truncated);
        assert_eq!(cut.chars().count(), 33); // 99 字节 = 33 个中文
        assert!(cut.ends_with('中'));
        let (short, flag) = truncate_utf8("abc", 100);
        assert_eq!(short, "abc");
        assert!(!flag);
    }
}
