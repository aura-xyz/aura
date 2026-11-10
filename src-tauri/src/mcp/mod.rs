//! MCP（Model Context Protocol）集成（v0.8.0 · rc.3 第一部分）。
//!
//! 第一部分只做 stdio + tools 域：
//! - [`config`]：`mcp_servers` 表的读写（环境变量经 `secure` 加密落库）；
//! - [`client`]：stdio 子进程、NDJSON 帧、initialize 握手与请求关联；
//! - 本模块的 [`Manager`]：连接的生命周期与按 id 查找。
//!
//! 工具挂载与分发在 `tools` 侧（`registry` / `async_tool`），这里只提供
//! 「配置与连接」的原语，避免 mcp 与 tools 互相知道太多。

pub mod client;
pub mod config;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};

use tokio::sync::RwLock;

pub use client::{ConnStatus, Connection, McpToolDef};
pub use config::McpServerConfig;

/// 事件观察者：`(kind, payload)`。由应用层安装为向前端 emit。
pub type Observer = Box<dyn Fn(&str, serde_json::Value) + Send + Sync>;

static OBSERVER: StdMutex<Option<Observer>> = StdMutex::new(None);

/// 安装事件观察者（启动时调用；未安装时 [`emit`] 为 no-op）。
pub fn set_observer(observer: Observer) {
    let mut guard = OBSERVER.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(observer);
}

/// 向观察者发一条事件（连接状态、工具集变化）。
pub fn emit(kind: &str, payload: serde_json::Value) {
    if let Ok(guard) = OBSERVER.lock() {
        if let Some(cb) = guard.as_ref() {
            cb(kind, payload);
        }
    }
}

/// 连接管理器：按服务器 id 持有活连接。
pub struct Manager {
    conns: RwLock<HashMap<i64, Arc<Connection>>>,
}

impl Manager {
    fn new() -> Self {
        Manager {
            conns: RwLock::new(HashMap::new()),
        }
    }

    pub async fn insert(&self, id: i64, conn: Arc<Connection>) {
        self.conns.write().await.insert(id, conn);
    }

    pub async fn get(&self, id: i64) -> Option<Arc<Connection>> {
        self.conns.read().await.get(&id).cloned()
    }

    pub async fn remove(&self, id: i64) -> Option<Arc<Connection>> {
        self.conns.write().await.remove(&id)
    }

    /// 当前全部连接（注册表同步用）。
    pub async fn snapshot(&self) -> Vec<(i64, Arc<Connection>)> {
        self.conns
            .read()
            .await
            .iter()
            .map(|(id, c)| (*id, c.clone()))
            .collect()
    }
}

/// 全局管理器。进程内单例。
pub fn manager() -> &'static Manager {
    static MANAGER: OnceLock<Manager> = OnceLock::new();
    MANAGER.get_or_init(Manager::new)
}

/// 拉起并登记一台服务器。已存在同 id 连接时先断开旧的。
pub async fn connect_server(
    cfg: &McpServerConfig,
    cwd: Option<PathBuf>,
) -> Result<Arc<Connection>, String> {
    if let Some(old) = manager().remove(cfg.id).await {
        old.shutdown().await;
    }
    let conn = client::connect(
        cfg.id,
        cfg.name.clone(),
        cfg.command.clone(),
        cfg.args.clone(),
        cfg.env.clone(),
        cwd,
    )
    .await?;
    manager().insert(cfg.id, conn.clone()).await;
    // 工具挂载进注册表（静态表 + 动态表双源）。
    crate::tools::registry::sync_mcp_tools().await;
    Ok(conn)
}

/// 断开并注销一台服务器（不存在则忽略）。
pub async fn disconnect_server(id: i64) {
    if let Some(conn) = manager().remove(id).await {
        conn.shutdown().await;
    }
    crate::tools::registry::sync_mcp_tools().await;
}

/// 查询连接状态；未连接返回 None。
pub async fn server_status(id: i64) -> Option<ConnStatus> {
    match manager().get(id).await {
        Some(conn) => Some(conn.status().await),
        None => None,
    }
}

/// 调用某服务器的工具，返回映射后的文本。
///
/// `tools/call` 必须发**服务器的原始工具名**（改写名只用于模型侧唯一性）。
/// `isError:true` 是工具的业务失败，转 `Err` 走统一的工具失败路径；
/// 协议错误（超时 / JSON-RPC error）由 `client::call_tool` 直接返回 Err。
pub async fn call_tool(
    server_id: i64,
    original_name: &str,
    args: serde_json::Value,
) -> Result<String, String> {
    let conn = manager()
        .get(server_id)
        .await
        .ok_or_else(|| "MCP 服务器未连接".to_string())?;
    let result = conn.call_tool(original_name, args).await?;
    map_tool_result(&result)
}

/// `result` → 回填给模型的文本。`isError` 转 Err，其余按 content 拼接。
fn map_tool_result(result: &serde_json::Value) -> Result<String, String> {
    let is_error = result
        .get("isError")
        .and_then(|b| b.as_bool())
        .unwrap_or(false);
    let text = extract_tool_content(result);
    if is_error {
        Err(if text.trim().is_empty() {
            "MCP 工具报告执行失败".to_string()
        } else {
            text
        })
    } else {
        Ok(if text.trim().is_empty() {
            "（工具无文本输出）".to_string()
        } else {
            text
        })
    }
}

/// 把 `content` 数组拼成文本。第一部分不做多模态渲染：
/// 非文本项以占位文本注明类型与大小。
fn extract_tool_content(result: &serde_json::Value) -> String {
    let Some(items) = result.get("content").and_then(|c| c.as_array()) else {
        // 少数服务器直接把结果放在字符串里。
        return result
            .as_str()
            .map(str::to_string)
            .unwrap_or_default();
    };
    let mut parts: Vec<String> = Vec::new();
    for item in items {
        let ty = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match ty {
            "text" => {
                if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                    parts.push(t.to_string());
                }
            }
            "image" => {
                let mime = item
                    .get("mimeType")
                    .and_then(|m| m.as_str())
                    .unwrap_or("image");
                let bytes = item
                    .get("data")
                    .and_then(|d| d.as_str())
                    .map(|d| d.len())
                    .unwrap_or(0);
                parts.push(format!("[图片 {mime}，约 {bytes} 字节 base64]"));
            }
            "audio" => parts.push("[音频内容]".to_string()),
            "resource" | "resource_link" => {
                let uri = item
                    .get("uri")
                    .or_else(|| item.get("resource").and_then(|r| r.get("uri")))
                    .and_then(|u| u.as_str())
                    .unwrap_or("");
                parts.push(format!("[资源 {uri}]"));
            }
            other => {
                if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                    parts.push(t.to_string());
                } else if !other.is_empty() {
                    parts.push(format!("[{other} 内容]"));
                }
            }
        }
    }
    parts.join("\n")
}

/// 关闭全部连接（应用退出时调用）。
pub async fn shutdown_all() {
    let conns = manager().snapshot().await;
    for (id, _) in conns {
        disconnect_server(id).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn text_content_is_joined_in_order() {
        let r = json!({ "content": [
            { "type": "text", "text": "第一段" },
            { "type": "text", "text": "第二段" }
        ]});
        assert_eq!(map_tool_result(&r).unwrap(), "第一段\n第二段");
    }

    #[test]
    fn is_error_becomes_err_with_text() {
        let r = json!({ "isError": true, "content": [{ "type": "text", "text": "权限不足" }] });
        let err = map_tool_result(&r).unwrap_err();
        assert_eq!(err, "权限不足");
    }

    #[test]
    fn non_text_content_uses_placeholder() {
        let r = json!({ "content": [
            { "type": "image", "mimeType": "image/png", "data": "AAAA" },
            { "type": "resource_link", "uri": "file:///x" }
        ]});
        let text = map_tool_result(&r).unwrap();
        assert!(text.contains("[图片 image/png"), "{text}");
        assert!(text.contains("file:///x"), "{text}");
    }

    #[test]
    fn empty_content_gets_readable_placeholder() {
        let r = json!({ "content": [] });
        assert_eq!(map_tool_result(&r).unwrap(), "（工具无文本输出）");
    }
}
