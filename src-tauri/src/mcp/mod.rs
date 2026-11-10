//! MCP（Model Context Protocol）集成（v0.8.0 · rc.3 第一部分）。
//!
//! 第一部分只做 stdio + tools 域：
//! - [`config`]：`mcp_servers` 表的读写（环境变量经 `secure` 加密落库）；
//! - `client`（C59 起）：stdio 子进程、NDJSON 帧、initialize 握手与 tools 发现。
//!
//! 工具挂载与分发在 `tools` 侧（`registry` / `async_tool`），这里只提供
//! 「配置与连接」的原语，避免 mcp 与 tools 互相知道太多。

pub mod config;

pub use config::McpServerConfig;
