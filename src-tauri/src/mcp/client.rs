//! stdio MCP 客户端（v0.8.1 · M2-01 重构）。
//!
//! 连接生命周期留在这里；**字节传输**在 `transport.rs`、**JSON-RPC 请求关联**
//! 在 `session.rs`。二期新增 resources / prompts 域只需加方法，不必再动
//! 子进程与帧处理。
//!
//! 不引入官方 rmcp：M2 计划 D-01 把迁移触发点放到三期的 HTTP/OAuth，
//! 这里先用 `Transport` trait 把替换面压到最小。

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};
use tokio::sync::{Mutex as AsyncMutex, RwLock};

use super::capabilities::{client_capabilities, parse_capabilities, ServerCapabilities};
use super::session::RpcSession;
use super::transport::{StdioTransport, Transport};

// 保持一期对外符号不变：其他模块与既有单测仍从 client 引用这两个函数。
pub use super::session::{decode_line, encode_message};

/// 握手时向服务器声明的最低共同版本（见设计文档 1.1 / 二期计划 2.4）。
pub const PROTOCOL_VERSION: &str = "2025-06-18";
/// stderr 环形缓冲保留的行数。
const MAX_STDERR_LINES: usize = 50;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
/// 单服务器工具数上限：防失控服务器撑爆 prompt。
const MAX_TOOLS: usize = 50;

/// 服务器声明的单个工具（原始名与 schema 原样保留）。
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct McpToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// 连接状态。`Down` 携带原因（退出码 / 握手失败文案），供 UI 展示。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnStatus {
    Connecting,
    Running,
    Down { reason: String },
    Disabled,
}

impl ConnStatus {
    /// 给状态点用的粗粒度标签（running / connecting / down / disabled）。
    pub fn label(&self) -> &'static str {
        match self {
            ConnStatus::Connecting => "connecting",
            ConnStatus::Running => "running",
            ConnStatus::Down { .. } => "down",
            ConnStatus::Disabled => "disabled",
        }
    }
}

/// 一条活连接。
pub struct Connection {
    pub server_id: i64,
    pub server_name: String,
    /// 允许可见的工作区（空 = 全部）。工具可见性按当前工作区前缀过滤。
    pub workspaces: Vec<String>,
    transport: Arc<dyn Transport>,
    session: RpcSession,
    status: RwLock<ConnStatus>,
    stderr_tail: StdMutex<VecDeque<String>>,
    /// 握手协商结果（M2-02）：版本、服务器信息与支持的域。
    capabilities: RwLock<ServerCapabilities>,
    /// 最近一次 `tools/list` 的发现结果（C60）。
    tools: RwLock<Vec<McpToolDef>>,
    /// `tools/call` 串行化（第一部分不做并发，避免服务器实现差异）。
    call_lock: AsyncMutex<()>,
}

impl Connection {
    fn new(
        server_id: i64,
        server_name: String,
        workspaces: Vec<String>,
        transport: Arc<dyn Transport>,
    ) -> Self {
        Connection {
            server_id,
            server_name,
            workspaces,
            transport,
            session: RpcSession::new(),
            status: RwLock::new(ConnStatus::Connecting),
            stderr_tail: StdMutex::new(VecDeque::new()),
            capabilities: RwLock::new(ServerCapabilities::default()),
            tools: RwLock::new(Vec::new()),
            call_lock: AsyncMutex::new(()),
        }
    }

    pub async fn status(&self) -> ConnStatus {
        self.status.read().await.clone()
    }

    async fn set_status(&self, s: ConnStatus) {
        *self.status.write().await = s.clone();
        // 状态变化推给前端（未安装观察者时为 no-op）。
        if let Ok(payload) = serde_json::to_value(&s) {
            crate::mcp::emit(
                "mcp:status",
                serde_json::json!({ "serverId": self.server_id, "status": payload }),
            );
        }
    }

    /// 最近一次发现的工具集（克隆，供注册表同步与状态查询）。
    pub async fn tools(&self) -> Vec<McpToolDef> {
        self.tools.read().await.clone()
    }

    /// 握手协商出的能力快照（M2-02）。
    pub async fn capabilities(&self) -> ServerCapabilities {
        self.capabilities.read().await.clone()
    }

    /// stderr 尾部（最近若干行），供连接排错展示。
    pub fn stderr_tail(&self) -> Vec<String> {
        self.stderr_tail
            .lock()
            .map(|q| q.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn push_stderr(&self, line: String) {
        if let Ok(mut q) = self.stderr_tail.lock() {
            q.push_back(line);
            while q.len() > MAX_STDERR_LINES {
                q.pop_front();
            }
        }
    }

    /// 发一条请求并等待响应。`id` 自增关联由会话层负责。
    pub async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        self.session
            .request(self.transport.as_ref(), method, params, timeout)
            .await
    }

    /// 发一条通知（无 id、不等待响应）。
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.session
            .notify(self.transport.as_ref(), method, params)
            .await
    }

    /// 拉取工具集：`tools/list` 支持 cursor 翻页，逐页取尽后截断到上限。
    pub async fn refresh_tools(&self) -> Result<Vec<McpToolDef>, String> {
        let mut all: Vec<McpToolDef> = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let res = self.request("tools/list", params, LIST_TIMEOUT).await?;
            if let Some(arr) = res.get("tools").and_then(|t| t.as_array()) {
                for t in arr {
                    let name = t.get("name").and_then(|n| n.as_str()).unwrap_or("").trim();
                    if name.is_empty() {
                        continue;
                    }
                    let description = t
                        .get("description")
                        .and_then(|d| d.as_str())
                        .filter(|d| !d.trim().is_empty())
                        .unwrap_or("（服务器未提供描述）")
                        .to_string();
                    let input_schema = t.get("inputSchema").cloned().unwrap_or(Value::Null);
                    all.push(McpToolDef {
                        name: name.to_string(),
                        description,
                        input_schema,
                    });
                }
            }
            match res.get("nextCursor").and_then(|c| c.as_str()) {
                Some(c) if !c.is_empty() => cursor = Some(c.to_string()),
                _ => break,
            }
        }
        all.truncate(MAX_TOOLS);
        *self.tools.write().await = all.clone();
        crate::mcp::emit(
            "mcp:tools",
            json!({ "serverId": self.server_id, "count": all.len() }),
        );
        Ok(all)
    }

    /// 调用一个工具。同一服务器的调用串行执行（`call_lock`），避免服务器
    /// 实现差异带来的交错问题。返回原始 `result`，内容映射交由上层。
    pub async fn call_tool(&self, name: &str, args: Value) -> Result<Value, String> {
        let _guard = self.call_lock.lock().await;
        let params = json!({ "name": name, "arguments": args });
        self.request("tools/call", params, CALL_TIMEOUT).await
    }

    /// 通知路由：会话层只负责把 method 名交回来，具体动作在这里决定。
    /// 未知通知按一期口径忽略，不报错、不打断流。
    async fn on_notification(&self, method: &str) {
        if method == "notifications/tools/list_changed" {
            // 重扫失败不弹错误，只留痕（状态徽标由上层按工具数展示）。
            match self.refresh_tools().await {
                Ok(_) => crate::tools::registry::sync_mcp_tools(None).await,
                Err(e) => self.push_stderr(format!("刷新工具列表失败：{e}")),
            }
        }
    }

    /// 关闭连接：关 stdin 让服务器自行退出，再兜底 kill + 回收。
    pub async fn shutdown(&self) {
        self.transport.shutdown().await;
        self.session.fail_pending("连接已关闭");
        self.set_status(ConnStatus::Disabled).await;
    }

    /// 回收已退出的子进程（stdout EOF 后调用）。
    async fn reap(&self) {
        self.transport.reap().await;
    }

    async fn mark_down(&self, reason: String) {
        self.session.fail_pending(&reason);
        self.set_status(ConnStatus::Down { reason }).await;
    }

    async fn handshake(&self) -> Result<(), String> {
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            // M2-02：声明 resources / prompts 两个域，服务器才会推对应通知。
            // sampling 留给三期，不在这里声明。
            "capabilities": client_capabilities(),
            "clientInfo": { "name": "aura", "version": env!("CARGO_PKG_VERSION") }
        });
        // 协商以服务器返回值为准；不校验版本，兼容只支持旧版的服务器。
        let result = self.request("initialize", params, HANDSHAKE_TIMEOUT).await?;
        *self.capabilities.write().await = parse_capabilities(&result);
        self.notify("notifications/initialized", json!({})).await?;
        Ok(())
    }
}

async fn stdout_loop(conn: Arc<Connection>, stdout: ChildStdout) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF：子进程退出或关闭了 stdout
            Ok(_) => match decode_line(&line) {
                Ok(Some(v)) => {
                    if let Some(method) = conn.session.dispatch(v) {
                        conn.on_notification(&method).await;
                    }
                }
                Ok(None) => {}
                Err(e) => conn.push_stderr(e),
            },
            Err(e) => {
                conn.push_stderr(format!("读取服务器输出失败：{e}"));
                break;
            }
        }
    }
    conn.mark_down("连接已关闭".to_string()).await;
    conn.reap().await;
}

async fn stderr_loop(conn: Arc<Connection>, stderr: ChildStderr) {
    let mut reader = BufReader::new(stderr);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                let text = line.trim_end_matches(['\r', '\n']).to_string();
                if !text.trim().is_empty() {
                    conn.push_stderr(text);
                }
            }
            Err(_) => break,
        }
    }
}

/// 拉起一台服务器并完成初始化握手。
pub async fn connect(
    server_id: i64,
    server_name: String,
    command: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    workspaces: Vec<String>,
    cwd: Option<PathBuf>,
) -> Result<Arc<Connection>, String> {
    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    // Windows 下避免为控制台子进程弹窗。
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动服务器「{server_name}」：{e}"))?;
    let stdin = child.stdin.take().ok_or("无法获取服务器 stdin")?;
    let stdout = child.stdout.take().ok_or("无法获取服务器 stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取服务器 stderr")?;

    let transport: Arc<dyn Transport> = Arc::new(StdioTransport::new(child, stdin));
    let conn = Arc::new(Connection::new(
        server_id,
        server_name,
        workspaces,
        transport,
    ));
    // 先起读任务，握手响应才有处可投递。
    tokio::spawn(stdout_loop(conn.clone(), stdout));
    tokio::spawn(stderr_loop(conn.clone(), stderr));

    match conn.handshake().await {
        Ok(_) => {
            conn.set_status(ConnStatus::Running).await;
            // 首次工具发现：失败不阻断连接（工具数为 0，状态仍 Running）。
            if let Err(e) = conn.refresh_tools().await {
                conn.push_stderr(format!("首次拉取工具列表失败：{e}"));
            }
            Ok(conn)
        }
        Err(e) => {
            conn.mark_down(e.clone()).await;
            conn.shutdown().await;
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn status_label_matches_kind() {
        assert_eq!(ConnStatus::Running.label(), "running");
        assert_eq!(ConnStatus::Down { reason: "x".into() }.label(), "down");
    }
}
