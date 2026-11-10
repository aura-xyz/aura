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

/// 关闭全部连接（应用退出时调用）。
pub async fn shutdown_all() {
    let conns = manager().snapshot().await;
    for (id, _) in conns {
        disconnect_server(id).await;
    }
}
