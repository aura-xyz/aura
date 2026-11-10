//! JSON-RPC 2.0 会话（v0.8.1 · M2-01）。
//!
//! 只管三件事：消息编解码、请求 id 自增与 oneshot 关联、入站消息分流。
//! **通知路由不在这里**——`dispatch` 把通知的 method 名交回上层，由
//! `Connection` 决定「工具列表变了」还是「资源更新了」，二期新增域时
//! 不必再改会话层。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::oneshot;

use super::transport::Transport;

/// 编码一条 JSON-RPC 消息为一行（不含换行符）。`id=None` 即通知。
pub fn encode_message(id: Option<u64>, method: &str, params: &Value) -> String {
    let mut obj = serde_json::Map::new();
    obj.insert("jsonrpc".to_string(), json!("2.0"));
    if let Some(id) = id {
        obj.insert("id".to_string(), json!(id));
    }
    obj.insert("method".to_string(), json!(method));
    obj.insert("params".to_string(), params.clone());
    serde_json::to_string(&Value::Object(obj)).unwrap_or_default()
}

/// 解析一行。空行视为无消息（返回 None）。
pub fn decode_line(line: &str) -> Result<Option<Value>, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    serde_json::from_str::<Value>(trimmed)
        .map(Some)
        .map_err(|e| format!("无法解析服务器消息：{e}"))
}

pub struct RpcSession {
    next_id: AtomicU64,
    pending: StdMutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
}

impl RpcSession {
    pub fn new() -> Self {
        RpcSession {
            next_id: AtomicU64::new(1),
            pending: StdMutex::new(HashMap::new()),
        }
    }

    /// 发一条请求并等待响应；超时会主动摘掉 pending，避免表只增不减。
    pub async fn request(
        &self,
        transport: &dyn Transport,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| "内部状态异常".to_string())?
            .insert(id, tx);

        let line = encode_message(Some(id), method, &params);
        transport.write_line(line).await?;

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(Ok(v))) => Ok(v),
            Ok(Ok(Err(e))) => Err(e),
            Ok(Err(_)) => Err("连接已关闭".to_string()),
            Err(_) => {
                if let Ok(mut map) = self.pending.lock() {
                    map.remove(&id);
                }
                Err(format!("请求超时：{method}"))
            }
        }
    }

    /// 发一条通知（无 id、不等待响应）。
    pub async fn notify(
        &self,
        transport: &dyn Transport,
        method: &str,
        params: Value,
    ) -> Result<(), String> {
        let line = encode_message(None, method, &params);
        transport.write_line(line).await
    }

    /// 分发入站消息。返回 `Some(method)` 表示这是一条通知，交给上层路由；
    /// 响应与无法识别的消息返回 None。
    pub fn dispatch(&self, v: Value) -> Option<String> {
        if let Some(id) = v.get("id").and_then(|x| x.as_u64()) {
            let tx = self.pending.lock().ok().and_then(|mut m| m.remove(&id));
            if let Some(tx) = tx {
                if let Some(err) = v.get("error") {
                    let msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("服务器返回错误");
                    let _ = tx.send(Err(msg.to_string()));
                } else {
                    let _ = tx.send(Ok(v.get("result").cloned().unwrap_or(Value::Null)));
                }
            }
            return None;
        }
        v.get("method")
            .and_then(|m| m.as_str())
            .map(str::to_string)
    }

    /// 连接关闭时让所有等待中的请求立刻失败，而不是各自熬到超时。
    pub fn fail_pending(&self, reason: &str) {
        if let Ok(mut map) = self.pending.lock() {
            for (_, tx) in map.drain() {
                let _ = tx.send(Err(reason.to_string()));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::transport::RecordingTransport;

    #[test]
    fn encode_request_has_jsonrpc_id_method_params() {
        let s = encode_message(Some(7), "initialize", &json!({"a": 1}));
        let v: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["jsonrpc"], "2.0");
        assert_eq!(v["id"], 7);
        assert_eq!(v["method"], "initialize");
        assert_eq!(v["params"]["a"], 1);
    }

    #[test]
    fn encode_notification_has_no_id() {
        let s = encode_message(None, "notifications/initialized", &json!({}));
        let v: Value = serde_json::from_str(&s).unwrap();
        assert!(v.get("id").is_none());
    }

    #[test]
    fn decode_line_handles_blank_and_garbage() {
        assert_eq!(decode_line("   ").unwrap(), None);
        assert!(decode_line("not json").is_err());
        let v = decode_line(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#)
            .unwrap()
            .unwrap();
        assert_eq!(v["id"], 1);
    }

    #[test]
    fn dispatch_routes_response_and_notification() {
        let session = RpcSession::new();
        // 没有 pending 的响应不应被当成通知
        assert_eq!(session.dispatch(json!({"id": 99, "result": {}})), None);
        assert_eq!(
            session.dispatch(json!({"method": "notifications/tools/list_changed"})),
            Some("notifications/tools/list_changed".to_string())
        );
        assert_eq!(session.dispatch(json!({"foo": 1})), None);
    }

    #[tokio::test]
    async fn notify_writes_one_line_without_id() {
        let t = RecordingTransport::new();
        session_notify(&t).await;
        let lines = t.lines.lock().unwrap();
        assert_eq!(lines.len(), 1);
        let v: Value = serde_json::from_str(&lines[0]).unwrap();
        assert!(v.get("id").is_none());
        assert_eq!(v["method"], "notifications/initialized");
    }

    async fn session_notify(t: &RecordingTransport) {
        let s = RpcSession::new();
        s.notify(t, "notifications/initialized", json!({}))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn request_timeout_drops_pending_entry() {
        let t = RecordingTransport::new();
        let s = RpcSession::new();
        let err = s
            .request(
                &t,
                "tools/list",
                json!({}),
                Duration::from_millis(1),
            )
            .await
            .unwrap_err();
        assert!(err.contains("超时"), "{err}");
        assert_eq!(t.lines.lock().unwrap().len(), 1);
        // 超时后再次请求仍能正常编码，pending 表没有残留
        let _ = s
            .request(&t, "tools/list", json!({}), Duration::from_millis(1))
            .await;
        assert_eq!(t.lines.lock().unwrap().len(), 2);
    }
}
