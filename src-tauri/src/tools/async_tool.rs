//! 工具的异步分发（v0.8.1 C50）。
//!
//! 注册表（[`super::registry`]）里是**同步**工具：函数指针 `fn(&AccessScope, &Value)`。
//! 这在只有内置工具时够用，但接 MCP 时会遇到两个问题：
//!
//! 1. MCP 调用是网络往返，同步函数没法直接表达；
//! 2. 内置工具要跑子进程（`exec`）或做大量 IO，必须挪到阻塞线程池，
//!    否则会占住 tokio worker，SSE 流式输出与停止按钮都会卡。
//!
//! 所以这里引入 [`AsyncTool`]：一条「怎么异步执行」的统一约定。
//! 内置工具的实现（[`BuiltinTool`]）在内部包一层 `spawn_blocking`，
//! MCP 工具的实现（rc.3）则直接 `await` 网络调用——两者对调用方没有区别。
//!
//! 三层闸门（已知工具 / 模式闸门 / 审批分级）都作用在**注册表**上，
//! 与执行方式无关，因此 MCP 工具挂进来后自然受同样的约束，不需要特判。

use std::future::Future;
use std::pin::Pin;

use serde_json::Value;

use super::registry::{ToolSource, ToolSpec};
use super::scope::AccessScope;
use super::ToolOutput;

/// 异步工具。
pub trait AsyncTool: Send + Sync {
    /// 工具描述（与注册表一致）。
    fn spec(&self) -> &ToolSpec;

    /// 执行。失败时返回可直接回填给模型的中文原因。
    fn run(
        &self,
        scope: AccessScope,
        args: Value,
    ) -> Pin<Box<dyn Future<Output = Result<ToolOutput, String>> + Send>>;
}

/// 内置工具的适配器：把同步函数指针包进 `spawn_blocking`。
pub struct BuiltinTool {
    spec: &'static ToolSpec,
}

impl BuiltinTool {
    pub fn new(spec: &'static ToolSpec) -> Self {
        BuiltinTool { spec }
    }
}

impl AsyncTool for BuiltinTool {
    fn spec(&self) -> &ToolSpec {
        self.spec
    }

    fn run(
        &self,
        scope: AccessScope,
        args: Value,
    ) -> Pin<Box<dyn Future<Output = Result<ToolOutput, String>> + Send>> {
        let spec = self.spec;
        Box::pin(async move {
            let run = spec.run;
            // 阻塞部分整体挪进线程池：子进程、磁盘 IO 都不该占住
            // tokio 的 worker 线程。
            tokio::task::spawn_blocking(move || run(&scope, &args))
                .await
                .map_err(|e| format!("工具执行异常: {e}"))?
        })
    }
}

/// MCP 工具的占位实现（rc.3 挂载真实服务器时替换）。
///
/// 现在就留着，是为了让「来源」这条线索从一开始就在代码里：
/// 挂载时只需要换掉 `run` 的实现，注册表、闸门、提示词都不用动。
pub struct McpTool {
    spec: &'static ToolSpec,
}

impl McpTool {
    pub fn new(spec: &'static ToolSpec) -> Self {
        McpTool { spec }
    }
}

impl AsyncTool for McpTool {
    fn spec(&self) -> &ToolSpec {
        self.spec
    }

    fn run(
        &self,
        _scope: AccessScope,
        _args: Value,
    ) -> Pin<Box<dyn Future<Output = Result<ToolOutput, String>> + Send>> {
        let server = match &self.spec.source {
            ToolSource::Mcp { server } => server.clone(),
            _ => "未知服务器".to_string(),
        };
        Box::pin(async move {
            Err(format!("MCP 服务器「{server}」尚未连接"))
        })
    }
}

/// 按来源给工具挑一个执行器。
pub fn adapter(spec: &'static ToolSpec) -> Box<dyn AsyncTool> {
    match spec.source {
        ToolSource::Builtin => Box::new(BuiltinTool::new(spec)),
        ToolSource::Mcp { .. } => Box::new(McpTool::new(spec)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::registry;

    #[tokio::test]
    async fn builtin_tool_runs_through_the_trait() {
        let spec = registry::find("list_files").expect("内置工具应已注册");
        let tool = adapter(spec);
        let scope = crate::tools::scope::testutil::scope(std::path::PathBuf::from("."));
        let out = tool
            .run(scope, serde_json::json!({"path": "/"}))
            .await
            .expect("内置工具应能执行");
        assert!(!out.result.is_empty());
    }

    /// MCP 工具在服务器未连接时要给出**明确**的错误，
    /// 而不是 panic 或一句「未知工具」——模型据此知道自己该换条路。
    #[tokio::test]
    async fn mcp_tool_reports_disconnected_server() {
        let spec = registry::find("list_files").expect("内置工具应已注册");
        // 造一个 MCP 来源的 spec（不改全局注册表）
        let mcp_spec: &'static ToolSpec = Box::leak(Box::new(ToolSpec {
            name: "mcp_demo",
            kind: registry::ToolKind::Read,
            source: ToolSource::Mcp {
                server: "demo".into(),
            },
            input_schema: Some("{}".into()),
            desc: spec.desc,
            example: spec.example,
            run: spec.run,
            label: spec.label,
            max_consecutive: spec.max_consecutive,
        }));
        let tool = adapter(mcp_spec);
        let scope = crate::tools::scope::testutil::scope(std::path::PathBuf::from("."));
        let err = tool.run(scope, serde_json::json!({})).await.unwrap_err();
        assert!(err.contains("demo"), "{err}");
    }
}
