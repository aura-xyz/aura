//! 服务器能力快照（v0.8.1 · M2-02）。
//!
//! 一期把 `InitializeResult` 整个丢掉了：客户端声明 `capabilities: {}`，
//! 服务器自然不会推 resources / prompts。二期握手时声明两个新域，并把
//! 协商结果（版本 + 服务器自报能力）存下来，供设置页展示与后续域开关使用。
//!
//! 判据按规范：**服务器返回什么就认什么**。老版本服务器只报 tools，
//! 这里其余字段为 false，界面置灰但不影响既有工具链路。

use serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ServerCapabilities {
    /// 协商后的协议版本（以服务器返回值为准）
    pub protocol_version: String,
    pub server_name: String,
    pub server_version: String,
    pub tools: bool,
    pub tools_list_changed: bool,
    pub resources: bool,
    pub resources_subscribe: bool,
    pub prompts: bool,
    pub prompts_list_changed: bool,
}

impl ServerCapabilities {
    /// 能力徽标的紧凑展示：不给前端塞一堆布尔值自己拼。
    pub fn domains(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        if self.tools {
            out.push("tools");
        }
        if self.resources {
            out.push("resources");
        }
        if self.prompts {
            out.push("prompts");
        }
        out
    }
}

fn flag(v: &Value, key: &str) -> bool {
    v.get(key)
        .and_then(|x| x.as_bool())
        .unwrap_or(false)
}

fn text(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

/// 解析 `InitializeResult`。缺字段一律当「不支持」，绝不猜。
pub fn parse_capabilities(result: &Value) -> ServerCapabilities {
    let caps = result.get("capabilities").cloned().unwrap_or(Value::Null);
    let info = result.get("serverInfo").cloned().unwrap_or(Value::Null);
    let tools = caps.get("tools").cloned().unwrap_or(Value::Null);
    let resources = caps.get("resources").cloned().unwrap_or(Value::Null);
    let prompts = caps.get("prompts").cloned().unwrap_or(Value::Null);
    ServerCapabilities {
        protocol_version: text(result, "protocolVersion"),
        server_name: text(&info, "name"),
        server_version: text(&info, "version"),
        // 规范里 tools/resources/prompts 是对象（可为空对象），不能只判 bool
        tools: tools.is_object(),
        tools_list_changed: flag(&tools, "listChanged"),
        resources: resources.is_object(),
        resources_subscribe: flag(&resources, "subscribe"),
        prompts: prompts.is_object(),
        prompts_list_changed: flag(&prompts, "listChanged"),
    }
}

/// 客户端在 `initialize` 里声明的能力。
///
/// 只声明 resources（含 subscribe）与 prompts；**不含 sampling**——服务器
/// 反向请求模型属于授权边界问题，按二期计划留给三期。
pub fn client_capabilities() -> Value {
    serde_json::json!({
        "resources": { "subscribe": true },
        "prompts": {}
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn full_capabilities_are_parsed() {
        let r = json!({
            "protocolVersion": "2025-11-25",
            "serverInfo": { "name": "fs-server", "version": "1.2.3" },
            "capabilities": {
                "tools": { "listChanged": true },
                "resources": { "subscribe": true, "listChanged": true },
                "prompts": { "listChanged": false }
            }
        });
        let c = parse_capabilities(&r);
        assert_eq!(c.protocol_version, "2025-11-25");
        assert_eq!(c.server_name, "fs-server");
        assert_eq!(c.server_version, "1.2.3");
        assert!(c.tools && c.tools_list_changed);
        assert!(c.resources && c.resources_subscribe);
        assert!(c.prompts && !c.prompts_list_changed);
        assert_eq!(c.domains(), vec!["tools", "resources", "prompts"]);
    }

    #[test]
    fn legacy_server_only_advertises_tools() {
        let r = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} }
        });
        let c = parse_capabilities(&r);
        assert!(c.tools);
        assert!(!c.resources);
        assert!(!c.prompts);
        assert_eq!(c.domains(), vec!["tools"]);
    }

    #[test]
    fn missing_capabilities_degrades_to_all_false() {
        let c = parse_capabilities(&json!({ "result": "anything" }));
        assert_eq!(c, ServerCapabilities::default());
        assert!(c.domains().is_empty());
    }

    #[test]
    fn client_never_declares_sampling() {
        let c = client_capabilities();
        assert!(c.get("sampling").is_none());
        assert!(c["resources"]["subscribe"].as_bool().unwrap_or(false));
        assert!(c.get("prompts").is_some());
    }
}
