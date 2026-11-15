//! 多服务器配额调度（v0.8.2 · M3-06）。
//!
//! M2-10 的信号量是 **per-server**（`concurrent=1` 时上限 3，默认串行）。
//! 本模块只在其之上加一层全局约束：总并发、单次超时、批量上限，
//! 并把多路结果按来源服务器标注，避免模型把不同服务器的结果当成同一来源。
//!
//! **不改变** per-server 默认串行、`Semaphore(3)` 上限、`auto_reconnect`
//! 默认关闭；关闭 `concurrent` 后行为完全回到 v0.8.1。

use std::future::Future;
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::Semaphore;

/// 跨所有服务器的并发上限。
pub const GLOBAL_CONCURRENCY: usize = 8;
/// 单次工具调用的全局超时（秒）。`tools/call` 本身也有 60s 超时，这里兜底。
pub const CALL_TIMEOUT_SECS: u64 = 60;
/// 一次批量调用最多几路，防失控请求撑爆上下文。
pub const MAX_BATCH: usize = 8;

fn quota() -> &'static Semaphore {
    static Q: OnceLock<Semaphore> = OnceLock::new();
    Q.get_or_init(|| Semaphore::new(GLOBAL_CONCURRENCY))
}

/// 在全局配额与超时下执行一次调用。超时不会拖垮整个会话。
pub async fn with_quota<F, T>(fut: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    let _permit = quota()
        .acquire()
        .await
        .map_err(|_| "全局调用配额已关闭".to_string())?;
    tokio::time::timeout(Duration::from_secs(CALL_TIMEOUT_SECS), fut)
        .await
        .map_err(|_| format!("工具调用超过 {CALL_TIMEOUT_SECS}s 全局超时"))?
}

/// 一次批量调用中的一路。
#[derive(Debug, Clone)]
pub struct BatchCall {
    pub server_id: i64,
    pub server_name: String,
    pub tool: String,
    pub args: Value,
}

/// 带来源标注的结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchItem {
    pub source: String,
    pub tool: String,
    pub ok: bool,
    pub text: String,
}

/// 给单路结果加来源头。抽成纯函数便于单测「多路不串源」。
pub fn annotate_source(server: &str, tool: &str, text: &str) -> String {
    format!("[来源：{server} / {tool}]\n{text}")
}

/// 限制批量路数；超出部分直接丢弃，不留半截任务。
pub fn trim_batch<T>(calls: Vec<T>) -> Vec<T> {
    let mut out = calls;
    out.truncate(MAX_BATCH);
    out
}

/// 并发调用多台服务器，按**输入顺序**返回结果（不按完成先后），
/// 每路都带来源标注；单路失败不影响其他路。
pub async fn call_batch(calls: Vec<BatchCall>) -> Vec<BatchItem> {
    let calls = trim_batch(calls);
    let mut tasks = Vec::with_capacity(calls.len());
    for c in calls {
        tasks.push(tokio::spawn(async move {
            let r = crate::mcp::call_tool(c.server_id, &c.tool, c.args).await;
            BatchItem {
                source: c.server_name,
                tool: c.tool,
                ok: r.is_ok(),
                text: r.unwrap_or_else(|e| format!("调用失败：{e}")),
            }
        }));
    }
    let mut out = Vec::with_capacity(tasks.len());
    for t in tasks {
        match t.await {
            Ok(item) => out.push(item),
            Err(e) => out.push(BatchItem {
                source: "?".to_string(),
                tool: "?".to_string(),
                ok: false,
                text: format!("调用任务异常：{e}"),
            }),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_header_names_server_and_tool() {
        let s = annotate_source("fs", "read_file", "内容");
        assert!(s.starts_with("[来源：fs / read_file]\n"));
        assert!(s.ends_with("内容"));
    }

    #[test]
    fn batch_is_capped() {
        assert_eq!(trim_batch((0..20).collect::<Vec<_>>()).len(), MAX_BATCH);
        assert_eq!(trim_batch(vec![1, 2]).len(), 2);
    }

    #[tokio::test]
    async fn quota_passes_through_success_and_error() {
        assert_eq!(with_quota(async { Ok::<_, String>(7) }).await.unwrap(), 7);
        assert!(with_quota(async { Err::<(), _>("boom".to_string()) })
            .await
            .is_err());
    }
}
