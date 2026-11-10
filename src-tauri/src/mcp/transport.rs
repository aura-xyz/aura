//! stdio 传输层（v0.8.1 · M2-01）。
//!
//! 把「子进程 / stdin 管道」从 `client.rs` 里剥出来。会话层只认 [`Transport`]
//! 这个契约，不认 `tokio::process::Child`：三期接 Streamable HTTP 时只需在
//! `connect()` 换一个实现，JSON-RPC 请求关联与通知路由都不用动。
//!
//! 这是 M2 计划中 D-01 决策的落点——rmcp 迁移触发点后移到三期的
//! HTTP/OAuth，二期不引入 SDK；这里先把替换面压缩到一个 trait。

use std::future::Future;
use std::pin::Pin;

use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex as AsyncMutex;

/// 一行 JSON-RPC 文本的写入与连接回收。
///
/// 用 `&self` + 内部锁而不是 `&mut self`：stdout 读任务与请求任务共享同一条
/// 连接，`Arc<dyn Transport>` 才能同时被两侧持有。
pub trait Transport: Send + Sync {
    fn write_line(
        &self,
        line: String,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>>;
    fn shutdown(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>>;
    fn reap(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>>;
}

struct Inner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

/// stdio 实现：写 stdin、关闭时先关 stdin 让服务器自行退出，再兜底 kill。
pub struct StdioTransport {
    inner: AsyncMutex<Inner>,
}

impl StdioTransport {
    pub fn new(child: Child, stdin: ChildStdin) -> Self {
        StdioTransport {
            inner: AsyncMutex::new(Inner {
                child: Some(child),
                stdin: Some(stdin),
            }),
        }
    }
}

impl Transport for StdioTransport {
    fn write_line(
        &self,
        line: String,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        Box::pin(async move {
            let mut guard = self.inner.lock().await;
            let stdin = guard
                .stdin
                .as_mut()
                .ok_or_else(|| "连接已关闭".to_string())?;
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| format!("写入服务器失败：{e}"))?;
            stdin
                .write_all(b"\n")
                .await
                .map_err(|e| format!("写入服务器失败：{e}"))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("写入服务器失败：{e}"))?;
            Ok(())
        })
    }

    fn shutdown(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let mut guard = self.inner.lock().await;
            if let Some(mut stdin) = guard.stdin.take() {
                let _ = stdin.shutdown().await;
            }
            if let Some(mut child) = guard.child.take() {
                let _ = child.start_kill();
                let _ = child.wait().await;
            }
        })
    }

    fn reap(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let mut guard = self.inner.lock().await;
            if let Some(mut child) = guard.child.take() {
                let _ = child.wait().await;
            }
        })
    }
}

/// 仅供单测：一个把写入内容记下来的假传输，验证会话层的请求关联与超时清理。
#[cfg(test)]
pub struct RecordingTransport {
    pub lines: std::sync::Mutex<Vec<String>>,
}

#[cfg(test)]
impl RecordingTransport {
    pub fn new() -> Self {
        RecordingTransport {
            lines: std::sync::Mutex::new(Vec::new()),
        }
    }
}

#[cfg(test)]
impl Transport for RecordingTransport {
    fn write_line(
        &self,
        line: String,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        Box::pin(async move {
            self.lines.lock().unwrap().push(line);
            Ok(())
        })
    }
    fn shutdown(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }
    fn reap(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }
}
