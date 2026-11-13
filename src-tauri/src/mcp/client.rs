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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};
use tokio::sync::{Mutex as AsyncMutex, RwLock, Semaphore};

use super::capabilities::{client_capabilities, parse_capabilities, ServerCapabilities};
use super::config::ServerPolicy;
use super::prompts::{parse_prompt_messages, parse_prompt_page, McpPrompt, McpPromptMessage, MAX_PROMPTS};
use super::reconnect::{reconnect_delay, MAX_CONCURRENT_CALLS, MAX_RECONNECT_ATTEMPTS};
use super::resources::{
    parse_resource_contents, parse_resource_page, truncate_utf8, validate_resource_uri,
    McpResource, ResourceReadResult, MAX_RESOURCE_BYTES, MAX_RESOURCES,
};
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
/// 服务器声明的单个工具（原始名与 schema 原样保留）。
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct McpToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    /// 服务器自报的注解（如 `readOnlyHint`）。
    /// **仅用于设置页展示，绝不作为模式/审批放行依据**（规范明确注解不可信）。
    pub annotations: Option<Value>,
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

/// 自动重连所需的启动参数快照（M2-10）。
///
/// 只保存在 `auto_reconnect=1` 的连接上。存快照而不是回头查 DB：连接层
/// 不该知道配置表，且用户可能在断线期间改过配置——重连必须用拉起这台
/// 进程时的同一套参数，否则会出现「换了个命令却沿用旧连接」的错觉。
#[derive(Clone)]
struct ReconnectSpec {
    command: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    workspaces: Vec<String>,
    cwd: Option<PathBuf>,
    policy: ServerPolicy,
}

/// 一条活连接。
pub struct Connection {
    pub server_id: i64,
    pub server_name: String,
    /// 允许可见的工作区（空 = 全部）。工具可见性按当前工作区前缀过滤。
    pub workspaces: Vec<String>,
    /// 信任分级与连接策略（M2-08）。注册表同步与审批闸门从这里读。
    pub policy: ServerPolicy,
    transport: Arc<dyn Transport>,
    session: RpcSession,
    status: RwLock<ConnStatus>,
    stderr_tail: StdMutex<VecDeque<String>>,
    /// 握手协商结果（M2-02）：版本、服务器信息与支持的域。
    capabilities: RwLock<ServerCapabilities>,
    /// 最近一次 `tools/list` 的发现结果（C60）。
    tools: RwLock<Vec<McpToolDef>>,
    // 工具上限从 policy.tool_limit 读取（M2-08），不再单独存一份。
    /// 最近一次 resources/list + templates/list 的缓存（M2-03）。
    resources: RwLock<Vec<McpResource>>,
    /// 最近一次 prompts/list 的缓存（M2-05）。
    prompts: RwLock<Vec<McpPrompt>>,
    /// 已订阅更新的资源 URI。
    subscribed: RwLock<Vec<String>>,
    /// `tools/call` 串行化（一期默认行为，避免服务器实现差异）。
    call_lock: AsyncMutex<()>,
    /// `concurrent=1` 时改走信号量，允许最多 3 个并发调用。
    semaphore: Option<Semaphore>,
    /// 用户主动关闭/删除后不再重连。
    stopped: AtomicBool,
    /// 自动重连参数；None 表示保持一期「不自动重启」。
    reconnect: Option<ReconnectSpec>,
}

impl Connection {
    fn new(
        server_id: i64,
        server_name: String,
        workspaces: Vec<String>,
        policy: ServerPolicy,
        reconnect: Option<ReconnectSpec>,
        transport: Arc<dyn Transport>,
    ) -> Self {
        let policy = policy.normalized();
        let concurrent = policy.concurrent;
        Connection {
            server_id,
            server_name,
            workspaces,
            policy,
            transport,
            semaphore: if concurrent {
                Some(Semaphore::new(MAX_CONCURRENT_CALLS))
            } else {
                None
            },
            stopped: AtomicBool::new(false),
            reconnect,
            session: RpcSession::new(),
            status: RwLock::new(ConnStatus::Connecting),
            stderr_tail: StdMutex::new(VecDeque::new()),
            capabilities: RwLock::new(ServerCapabilities::default()),
            tools: RwLock::new(Vec::new()),
            resources: RwLock::new(Vec::new()),
            prompts: RwLock::new(Vec::new()),
            subscribed: RwLock::new(Vec::new()),
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

    /// 资源清单缓存（M2-03）。连接断开后由 `shutdown` 清空。
    pub async fn resources(&self) -> Vec<McpResource> {
        self.resources.read().await.clone()
    }

    /// 重扫 resources/list（带 cursor 翻页）与 resources/templates/list。
    ///
    /// 服务器未声明 resources 能力时仍允许手动重扫——不少老实现能回
    /// 结果却忘了在 capabilities 里写，从严拒绝会把可用功能挡在外面。
    pub async fn refresh_resources(&self) -> Result<Vec<McpResource>, String> {
        let mut all: Vec<McpResource> = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let res = self
                .request("resources/list", params, LIST_TIMEOUT)
                .await?;
            all.extend(parse_resource_page(&res));
            match res.get("nextCursor").and_then(|c| c.as_str()) {
                Some(c) if !c.is_empty() => cursor = Some(c.to_string()),
                _ => break,
            }
        }
        // 模板没有分页；失败不影响具体资源清单。
        if let Ok(res) = self
            .request("resources/templates/list", json!({}), LIST_TIMEOUT)
            .await
        {
            all.extend(parse_resource_page(&res));
        }
        all.truncate(MAX_RESOURCES);
        *self.resources.write().await = all.clone();
        crate::mcp::emit(
            "mcp:resources",
            json!({ "serverId": self.server_id, "count": all.len() }),
        );
        Ok(all)
    }

    /// 读取一条资源。URI 只做形状校验，不映射到本地文件系统；
    /// blob 只统计大小、不解码进文本；超长文本按 UTF-8 边界截断。
    pub async fn read_resource(&self, uri: &str) -> Result<ResourceReadResult, String> {
        validate_resource_uri(uri)?;
        let res = self
            .request("resources/read", json!({ "uri": uri }), LIST_TIMEOUT)
            .await?;
        let (raw_text, mime_type, blob_bytes) = parse_resource_contents(&res);
        let total_bytes = raw_text.len() + blob_bytes;
        let (text, truncated) = truncate_utf8(&raw_text, MAX_RESOURCE_BYTES);
        Ok(ResourceReadResult {
            uri: uri.to_string(),
            text,
            mime_type,
            truncated,
            total_bytes,
            blob_bytes,
        })
    }

    /// 订阅资源更新。只有服务器声明 `resources.subscribe` 时才发请求。
    pub async fn subscribe_resource(&self, uri: &str) -> Result<(), String> {
        validate_resource_uri(uri)?;
        if !self.capabilities().await.resources_subscribe {
            return Err("服务器未声明支持资源订阅更新".into());
        }
        self.request(
            "resources/subscribe",
            json!({ "uri": uri }),
            LIST_TIMEOUT,
        )
        .await?;
        let mut list = self.subscribed.write().await;
        if !list.iter().any(|u| u == uri) {
            list.push(uri.to_string());
        }
        Ok(())
    }

    /// 提示词清单缓存（M2-05）。
    pub async fn prompts(&self) -> Vec<McpPrompt> {
        self.prompts.read().await.clone()
    }

    /// 重扫 prompts/list（带 cursor 翻页）。
    pub async fn refresh_prompts(&self) -> Result<Vec<McpPrompt>, String> {
        let mut all: Vec<McpPrompt> = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let res = self.request("prompts/list", params, LIST_TIMEOUT).await?;
            all.extend(parse_prompt_page(&res));
            match res.get("nextCursor").and_then(|c| c.as_str()) {
                Some(c) if !c.is_empty() => cursor = Some(c.to_string()),
                _ => break,
            }
        }
        all.truncate(MAX_PROMPTS);
        *self.prompts.write().await = all.clone();
        crate::mcp::emit(
            "mcp:prompts",
            json!({ "serverId": self.server_id, "count": all.len() }),
        );
        Ok(all)
    }

    /// 展开一条提示词模板。**只取消息文本，绝不执行、不写 history。**
    pub async fn get_prompt(
        &self,
        name: &str,
        args: Value,
    ) -> Result<Vec<McpPromptMessage>, String> {
        if name.trim().is_empty() {
            return Err("提示词名称不能为空".into());
        }
        if !args.is_object() && !args.is_null() {
            return Err("提示词参数必须是对象".into());
        }
        let res = self
            .request(
                "prompts/get",
                json!({ "name": name, "arguments": args }),
                LIST_TIMEOUT,
            )
            .await?;
        Ok(parse_prompt_messages(&res))
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
                    // 注解只收对象形式，原样保存供设置页展示；解析层不做任何
                    // 语义判断，避免「readOnlyHint」悄悄流进放行链路。
                    let annotations = t
                        .get("annotations")
                        .cloned()
                        .filter(|a| a.is_object());
                    all.push(McpToolDef {
                        name: name.to_string(),
                        description,
                        input_schema,
                        annotations,
                    });
                }
            }
            match res.get("nextCursor").and_then(|c| c.as_str()) {
                Some(c) if !c.is_empty() => cursor = Some(c.to_string()),
                _ => break,
            }
        }
        all.truncate(self.policy.tool_limit);
        *self.tools.write().await = all.clone();
        crate::mcp::emit(
            "mcp:tools",
            json!({ "serverId": self.server_id, "count": all.len() }),
        );
        Ok(all)
    }

    /// 调用一个工具。默认串行（一期行为）；`concurrent=1` 时用信号量
    /// 放开到最多 3 个并发，但仍共用同一条 NDJSON 写入通道（请求 id 关联
    /// 保证响应不会串错）。返回原始 `result`，内容映射交由上层。
    pub async fn call_tool(&self, name: &str, args: Value) -> Result<Value, String> {
        let params = json!({ "name": name, "arguments": args });
        if let Some(sem) = &self.semaphore {
            let _permit = sem
                .acquire()
                .await
                .map_err(|_| "连接已关闭".to_string())?;
            self.request("tools/call", params, CALL_TIMEOUT).await
        } else {
            let _guard = self.call_lock.lock().await;
            self.request("tools/call", params, CALL_TIMEOUT).await
        }
    }

    /// 通知路由：会话层只负责把 method 与 params 交回来，具体动作在这里决定。
    /// 未知通知按一期口径忽略，不报错、不打断流。
    async fn on_notification(&self, method: &str, params: &Value) {
        match method {
            "notifications/tools/list_changed" => {
                // 重扫失败不弹错误，只留痕（状态徽标由上层按工具数展示）。
                match self.refresh_tools().await {
                    Ok(_) => crate::tools::registry::sync_mcp_tools(None).await,
                    Err(e) => self.push_stderr(format!("刷新工具列表失败：{e}")),
                }
            }
            "notifications/resources/list_changed" => {
                if let Err(e) = self.refresh_resources().await {
                    self.push_stderr(format!("刷新资源列表失败：{e}"));
                    crate::mcp::diag(&format!(
                        "资源清单重扫失败 server={}: {e}",
                        self.server_name
                    ));
                }
            }
            "notifications/resources/updated" => {
                let uri = params.get("uri").and_then(|u| u.as_str()).unwrap_or("");
                let subscribed = self.subscribed.read().await.iter().any(|u| u == uri);
                if subscribed && !uri.is_empty() {
                    crate::mcp::emit(
                        "mcp:resource",
                        json!({ "serverId": self.server_id, "uri": uri }),
                    );
                }
            }
            "notifications/prompts/list_changed" => {
                if let Err(e) = self.refresh_prompts().await {
                    self.push_stderr(format!("刷新提示词列表失败：{e}"));
                    crate::mcp::diag(&format!(
                        "提示词清单重扫失败 server={}: {e}",
                        self.server_name
                    ));
                }
            }
            _ => {}
        }
    }

    /// 断线后是否允许自动重连：配置开启、且不是用户主动关闭的。
    fn can_reconnect(&self) -> bool {
        self.reconnect.is_some() && !self.stopped.load(Ordering::SeqCst)
    }

    /// 关闭连接：关 stdin 让服务器自行退出，再兜底 kill + 回收。
    /// `stopped` 先置位，确保已在退避等待中的重连任务醒来后直接退出。
    pub async fn shutdown(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.transport.shutdown().await;
        self.session.fail_pending("连接已关闭");
        *self.resources.write().await = Vec::new();
        *self.prompts.write().await = Vec::new();
        *self.subscribed.write().await = Vec::new();
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
        let caps = parse_capabilities(&result);
        crate::mcp::diag(&format!(
            "握手完成 server={} protocol={} domains={:?}",
            self.server_name,
            caps.protocol_version,
            caps.domains()
        ));
        *self.capabilities.write().await = caps;
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
                    if let Some((method, params)) = conn.session.dispatch(v) {
                        conn.on_notification(&method, &params).await;
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
    if conn.can_reconnect() {
        tokio::spawn(attempt_reconnect(conn.clone()));
    } else {
        conn.mark_down("连接已关闭".to_string()).await;
    }
    conn.reap().await;
}

/// 指数退避自动重连（M2-10）。只在 `auto_reconnect=1` 且用户没有主动
/// 关闭时进入；每次尝试前都检查 `stopped`，避免在用户已经停用服务器后
/// 又把进程拉起来。成功后替换 manager 里的连接并重扫工具/资源/提示词。
async fn attempt_reconnect(conn: Arc<Connection>) {
    let Some(spec) = conn.reconnect.clone() else {
        return;
    };
    conn.set_status(ConnStatus::Connecting).await;
    for attempt in 0..MAX_RECONNECT_ATTEMPTS {
        let delay = reconnect_delay(attempt);
        crate::mcp::emit(
            "mcp:reconnect",
            json!({
                "serverId": conn.server_id,
                "attempt": attempt + 1,
                "delayMs": delay.as_millis(),
            }),
        );
        crate::mcp::diag(&format!(
            "重连尝试 server={} 第 {} 次，等待 {}s",
            conn.server_name,
            attempt + 1,
            delay.as_secs()
        ));
        tokio::time::sleep(delay).await;
        if conn.stopped.load(Ordering::SeqCst) {
            crate::mcp::diag(&format!(
                "重连取消 server={}（用户已关闭）",
                conn.server_name
            ));
            return;
        }
        let result = connect(
            conn.server_id,
            conn.server_name.clone(),
            spec.command.clone(),
            spec.args.clone(),
            spec.env.clone(),
            spec.workspaces.clone(),
            spec.cwd.clone(),
            spec.policy.clone(),
        )
        .await;
        match result {
            Ok(next) => {
                crate::mcp::diag(&format!(
                    "重连成功 server={} 第 {} 次",
                    conn.server_name,
                    attempt + 1
                ));
                crate::mcp::manager().insert(conn.server_id, next).await;
                // connect() 内部已重扫工具与能力域；这里同步模型可见表。
                crate::tools::registry::sync_mcp_tools(None).await;
                crate::mcp::emit(
                    "mcp:reconnected",
                    json!({ "serverId": conn.server_id, "attempt": attempt + 1 }),
                );
                return;
            }
            Err(e) => conn.push_stderr(format!(
                "第 {} 次自动重连失败：{e}",
                attempt + 1
            )),
        }
    }
    crate::mcp::diag(&format!(
        "重连放弃 server={}（已尝试 {MAX_RECONNECT_ATTEMPTS} 次）",
        conn.server_name
    ));
    conn.mark_down(format!(
        "自动重连失败（已尝试 {MAX_RECONNECT_ATTEMPTS} 次），请手动重连"
    ))
    .await;
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
///
/// 返回**装箱**的 Future 而不是 `async fn`：stdout_loop → attempt_reconnect
/// → connect → spawn(stdout_loop) 构成一条 opaque future 的 Send 判定环，
/// 编译器会报 E0391。把 connect 的返回类型固定成 trait object 就切断了环，
/// 调用方仍然是 `.await`，语义不变。
pub fn connect(
    server_id: i64,
    server_name: String,
    command: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    workspaces: Vec<String>,
    cwd: Option<PathBuf>,
    policy: ServerPolicy,
) -> std::pin::Pin<
    Box<dyn std::future::Future<Output = Result<Arc<Connection>, String>> + Send>,
> {
    Box::pin(async move {
    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = &cwd {
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

    let reconnect = if policy.auto_reconnect {
        Some(ReconnectSpec {
            command: command.clone(),
            args: args.clone(),
            env: env.clone(),
            workspaces: workspaces.clone(),
            cwd: cwd.clone(),
            policy: policy.clone(),
        })
    } else {
        None
    };

    let transport: Arc<dyn Transport> = Arc::new(StdioTransport::new(child, stdin));
    let conn = Arc::new(Connection::new(
        server_id,
        server_name,
        workspaces,
        policy,
        reconnect,
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
            // 只有服务器声明了 resources 才自动拉清单；未声明时用户仍可在
            // 设置页手动重扫（老实现常漏报能力却照样能回结果）。
            if conn.capabilities().await.resources {
                if let Err(e) = conn.refresh_resources().await {
                    conn.push_stderr(format!("首次拉取资源列表失败：{e}"));
                }
            }
            if conn.capabilities().await.prompts {
                if let Err(e) = conn.refresh_prompts().await {
                    conn.push_stderr(format!("首次拉取提示词列表失败：{e}"));
                }
            }
            Ok(conn)
        }
        Err(e) => {
            conn.mark_down(e.clone()).await;
            conn.shutdown().await;
            Err(e)
        }
    }
    })
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
