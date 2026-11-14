//! Streamable HTTP 传输（v0.8.2 · M3-03）。
//!
//! D-02 结论选 B：保留 M2-01 的自研 `RpcSession`，只新增第二种
//! [`Transport`] 实现。请求关联、帧解码、通知路由、超时与关闭语义
//! 全部复用，stdio 路径零改动。
//!
//! 与 stdio 的唯一结构差异：HTTP 没有「stdout 管道」，因此传输自己把
//! 响应体（普通 JSON 或 SSE 事件）里的 JSON-RPC 文本推进入站通道，
//! 由 `client.rs` 的 `inbound_loop` 统一消费。`Mcp-Session-Id` 按规范
//! 从首次响应头取下并在后续请求带回。

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use tokio::sync::mpsc;

use super::transport::Transport;

/// 建立远程连接所需的运行时参数（不落库、不含 token 明文配置）。
#[derive(Debug, Clone)]
pub struct HttpSpec {
    pub url: String,
    /// M3-04 起由 OAuth 层注入；本批次为 None（无认证或免认证服务器）。
    pub token: Option<String>,
}

/// 从 SSE 块里切出完整的 `data` 事件。
///
/// `rest` 保存跨 chunk 的半行，`data` 保存当前事件的多条 `data:` 行。
/// 空行是事件边界；`event:` / `id:` / `:` 注释行按规范忽略。
/// 抽成纯函数是为了让「分块到达、多行 data」这类最容易出错的解析可单测。
pub fn parse_sse_chunk(
    chunk: &str,
    rest: &mut String,
    data: &mut Vec<String>,
) -> Vec<String> {
    rest.push_str(chunk);
    let mut out = Vec::new();
    while let Some(pos) = rest.find('\n') {
        let raw: String = rest.drain(..=pos).collect();
        let line = raw.trim_end_matches(['\r', '\n']);
        if let Some(v) = line.strip_prefix("data:") {
            data.push(v.trim_start().to_string());
        } else if line.is_empty() && !data.is_empty() {
            out.push(data.join("\n"));
            data.clear();
        }
    }
    out
}

/// 流结束时冲刷残留：有些服务器最后一个事件不补空行。
pub fn flush_sse(rest: &mut String, data: &mut Vec<String>) -> Vec<String> {
    let trimmed = rest.trim();
    if let Some(v) = trimmed.strip_prefix("data:") {
        data.push(v.trim_start().to_string());
    }
    rest.clear();
    if data.is_empty() {
        return Vec::new();
    }
    let out = data.join("\n");
    data.clear();
    vec![out]
}

pub struct HttpTransport {
    client: reqwest::Client,
    url: String,
    token: Option<String>,
    session_id: Arc<RwLock<Option<String>>>,
    closed: Arc<AtomicBool>,
    /// 包一层 Option：shutdown 时丢掉 Sender 才能让入站通道 EOF，
    /// 否则 `inbound_loop` 永远等不到结束、重连任务也不会被触发。
    tx: Mutex<Option<mpsc::Sender<String>>>,
    inbound: Mutex<Option<mpsc::Receiver<String>>>,
}

impl HttpTransport {
    pub fn new(spec: HttpSpec) -> Self {
        let (tx, rx) = mpsc::channel(64);
        HttpTransport {
            client: reqwest::Client::new(),
            url: spec.url,
            token: spec.token,
            session_id: Arc::new(RwLock::new(None)),
            closed: Arc::new(AtomicBool::new(false)),
            tx: Mutex::new(Some(tx)),
            inbound: Mutex::new(Some(rx)),
        }
    }
}

impl Transport for HttpTransport {
    fn write_line(
        &self,
        line: String,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        // 全部 clone 成 owned：SSE 读任务要 tokio::spawn，不能借用 &self。
        let client = self.client.clone();
        let url = self.url.clone();
        let token = self.token.clone();
        let sid = self.session_id.read().ok().and_then(|g| g.clone());
        let session_id = self.session_id.clone();
        let closed = self.closed.clone();
        let tx = self.tx.lock().ok().and_then(|g| g.clone());
        Box::pin(async move {
            let tx = tx.ok_or_else(|| "连接已关闭".to_string())?;
            if closed.load(Ordering::SeqCst) {
                return Err("连接已关闭".to_string());
            }
            let mut req = client
                .post(&url)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header(
                    reqwest::header::ACCEPT,
                    "application/json, text/event-stream",
                )
                .body(line);
            if let Some(s) = sid {
                req = req.header("Mcp-Session-Id", s);
            }
            if let Some(t) = token {
                req = req.header(
                    reqwest::header::AUTHORIZATION,
                    format!("Bearer {t}"),
                );
            }
            let mut resp = req
                .send()
                .await
                .map_err(|e| format!("远程服务器请求失败：{e}"))?;
            if let Some(v) = resp
                .headers()
                .get("mcp-session-id")
                .and_then(|v| v.to_str().ok())
            {
                if let Ok(mut g) = session_id.write() {
                    *g = Some(v.to_string());
                }
            }
            let status = resp.status();
            if !status.is_success() {
                let body = resp.text().await.unwrap_or_default();
                let brief: String = body.chars().take(200).collect();
                return Err(format!("远程服务器返回 HTTP {}：{brief}", status.as_u16()));
            }
            let is_sse = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.contains("text/event-stream"))
                .unwrap_or(false);
            if is_sse {
                tokio::spawn(async move {
                    let mut rest = String::new();
                    let mut data: Vec<String> = Vec::new();
                    loop {
                        match resp.chunk().await {
                            Ok(Some(bytes)) => {
                                let text = String::from_utf8_lossy(&bytes);
                                for item in parse_sse_chunk(&text, &mut rest, &mut data) {
                                    if tx.send(item).await.is_err() {
                                        return;
                                    }
                                }
                            }
                            Ok(None) => break,
                            Err(_) => break,
                        }
                    }
                    for item in flush_sse(&mut rest, &mut data) {
                        let _ = tx.send(item).await;
                    }
                });
            } else {
                let body = resp
                    .text()
                    .await
                    .map_err(|e| format!("读取远程响应失败：{e}"))?;
                for l in body.lines().map(str::trim).filter(|l| !l.is_empty()) {
                    let _ = tx.send(l.to_string()).await;
                }
            }
            Ok(())
        })
    }

    fn take_inbound(&self) -> Option<mpsc::Receiver<String>> {
        self.inbound.lock().ok().and_then(|mut g| g.take())
    }

    fn shutdown(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            self.closed.store(true, Ordering::SeqCst);
            if let Ok(mut g) = self.tx.lock() {
                *g = None; // 关闭入站通道，inbound_loop 收到 EOF 后走重连/置 Down
            }
            if let Ok(mut g) = self.session_id.write() {
                *g = None;
            }
        })
    }

    /// HTTP 没有子进程可回收；保留空实现以对齐 `Transport` 契约。
    fn reap(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_sse_event_is_extracted() {
        let mut rest = String::new();
        let mut data = Vec::new();
        let out = parse_sse_chunk(
            "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1}\n\n",
            &mut rest,
            &mut data,
        );
        assert_eq!(out, vec![r#"{"jsonrpc":"2.0","id":1}"#]);
        assert!(rest.is_empty());
    }

    #[test]
    fn chunked_sse_event_waits_for_the_whole_line() {
        let mut rest = String::new();
        let mut data = Vec::new();
        assert!(parse_sse_chunk("data: {\"a\":", &mut rest, &mut data).is_empty());
        let out = parse_sse_chunk("\"1\"}\n\n", &mut rest, &mut data);
        assert_eq!(out, vec![r#"{"a":"1"}"#]);
    }

    #[test]
    fn multiple_data_lines_are_joined_and_comments_ignored() {
        let mut rest = String::new();
        let mut data = Vec::new();
        let out = parse_sse_chunk(
            ": heartbeat\nid: 7\ndata: {\"x\":\ndata: 1}\n\n",
            &mut rest,
            &mut data,
        );
        assert_eq!(out, vec!["{\"x\":\n1}"]);
    }

    #[test]
    fn flush_emits_final_event_without_trailing_blank_line() {
        let mut rest = String::from("data: {\"late\":1}");
        let mut data = Vec::new();
        assert_eq!(flush_sse(&mut rest, &mut data), vec![r#"{"late":1}"#]);
        assert!(rest.is_empty());
    }
}
