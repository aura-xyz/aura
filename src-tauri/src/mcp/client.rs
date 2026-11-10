//! stdio MCP 客户端（v0.8.0 · rc.3 C59）。
//!
//! 只做第一部分需要的最小子集：拉起子进程、按行（NDJSON）收发 JSON-RPC 2.0、
//! `initialize` 握手、请求-响应按 id 关联、stderr 尾部留痕、进程退出即状态转 Down。
//!
//! 不引入官方 rmcp：第一部分只用到 stdio + tools 两方法一通知，自研约数百行、
//! 零新增依赖（tokio 已启用 process/io-util），排错时看 stderr 就能定位。

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex, RwLock};

/// 第一部分对齐的协议版本（见设计文档 1.1）。
pub const PROTOCOL_VERSION: &str = "2025-06-18";
/// stderr 环形缓冲保留的行数。
const MAX_STDERR_LINES: usize = 50;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
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

/// 一条活连接。
pub struct Connection {
    pub server_id: i64,
    pub server_name: String,
    child: AsyncMutex<Option<Child>>,
    stdin: AsyncMutex<Option<ChildStdin>>,
    next_id: AtomicU64,
    pending: StdMutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    status: RwLock<ConnStatus>,
    stderr_tail: StdMutex<VecDeque<String>>,
    /// 最近一次 `tools/list` 的发现结果（C60）。
    tools: RwLock<Vec<McpToolDef>>,
    /// `tools/call` 串行化（第一部分不做并发，避免服务器实现差异）。
    call_lock: AsyncMutex<()>,
}

impl Connection {
    fn new(server_id: i64, server_name: String, child: Child, stdin: ChildStdin) -> Self {
        Connection {
            server_id,
            server_name,
            child: AsyncMutex::new(Some(child)),
            stdin: AsyncMutex::new(Some(stdin)),
            next_id: AtomicU64::new(1),
            pending: StdMutex::new(HashMap::new()),
            status: RwLock::new(ConnStatus::Connecting),
            stderr_tail: StdMutex::new(VecDeque::new()),
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

    fn fail_pending(&self, reason: &str) {
        if let Ok(mut map) = self.pending.lock() {
            for (_, tx) in map.drain() {
                let _ = tx.send(Err(reason.to_string()));
            }
        }
    }

    /// 发一条请求并等待响应。`id` 自增关联。
    pub async fn request(
        &self,
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
        self.write_line(&line).await?;

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
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let line = encode_message(None, method, &params);
        self.write_line(&line).await
    }

    async fn write_line(&self, line: &str) -> Result<(), String> {
        let mut guard = self.stdin.lock().await;
        let stdin = guard.as_mut().ok_or_else(|| "连接已关闭".to_string())?;
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
    }

    /// 分发一条从服务器收到的消息：带 id 的是响应，无 id 的是通知。
    async fn dispatch(&self, v: Value) {
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
            return;
        }
        // 通知：第一部分只关心工具列表变更（C60 处理），其余忽略。
        if let Some(method) = v.get("method").and_then(|m| m.as_str()) {
            if method == "notifications/tools/list_changed" {
                self.on_tools_changed().await;
            }
        }
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

    /// `notifications/tools/list_changed`：重扫本服务器工具集。
    async fn on_tools_changed(&self) {
        // 重扫失败不弹错误，只留痕（状态徽标由上层按工具数展示）。
        if let Err(e) = self.refresh_tools().await {
            self.push_stderr(format!("刷新工具列表失败：{e}"));
        }
    }

    /// 关闭连接：关 stdin 让服务器自行退出，再兜底 kill + 回收。
    pub async fn shutdown(&self) {
        if let Some(mut stdin) = self.stdin.lock().await.take() {
            let _ = stdin.shutdown().await;
        }
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        self.fail_pending("连接已关闭");
        self.set_status(ConnStatus::Disabled).await;
    }

    /// 回收已退出的子进程（stdout EOF 后调用）。
    async fn reap(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.wait().await;
        }
    }

    async fn mark_down(&self, reason: String) {
        self.fail_pending(&reason);
        self.set_status(ConnStatus::Down { reason }).await;
    }

    async fn handshake(&self) -> Result<Value, String> {
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "aura", "version": env!("CARGO_PKG_VERSION") }
        });
        // 协商以服务器返回值为准；这里不校验返回版本，兼容只支持旧版的服务器。
        let result = self.request("initialize", params, HANDSHAKE_TIMEOUT).await?;
        self.notify("notifications/initialized", json!({})).await?;
        Ok(result)
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
                Ok(Some(v)) => conn.dispatch(v).await,
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

    let conn = Arc::new(Connection::new(server_id, server_name, child, stdin));
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
        let v = decode_line(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#).unwrap().unwrap();
        assert_eq!(v["id"], 1);
    }

    #[test]
    fn status_label_matches_kind() {
        assert_eq!(ConnStatus::Running.label(), "running");
        assert_eq!(ConnStatus::Down { reason: "x".into() }.label(), "down");
    }
}
