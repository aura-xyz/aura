//! MCP 服务器配置存储（v0.8.0 · rc.3 C58）。
//!
//! 一行 = 一台 stdio 服务器：命令、参数、环境变量、启用状态、可见工作区。
//!
//! **环境变量加密落库**：MCP 服务器普遍用 env 注入凭据（如 GitHub token）。
//! 明文躺在 SQLite 里与 API Key 明文落库是同类风险（备份、误分享、其他进程
//! 读取都能直接拿到），因此复用 `secure` 的既有加密路径，不引入第二套机制。
//! 密文带类型前缀，`secure::unprotect` 按前缀分派，换机/换后端都能正确读回。

use std::collections::BTreeMap;

use rusqlite::{params, Connection};

use crate::db::now;

/// 信任分级与连接策略（v0.8.1 M2-08）。
///
/// 默认值刻意保持一期行为：strict（Exec + 逐次审批）、不自动重连、
/// 串行调用、50 工具上限。任何一项放宽都必须由用户在本机显式改。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ServerPolicy {
    /// `"strict"`（默认）或 `"trusted"`
    pub trust_level: String,
    pub auto_reconnect: bool,
    pub tool_limit: usize,
    pub concurrent: bool,
}

impl Default for ServerPolicy {
    fn default() -> Self {
        ServerPolicy {
            trust_level: "strict".to_string(),
            auto_reconnect: false,
            tool_limit: 50,
            concurrent: false,
        }
    }
}

impl ServerPolicy {
    /// 归一化：只认 `trusted`，其余一律回落 strict；工具上限夹在 1..=500。
    pub fn normalized(mut self) -> Self {
        self.trust_level = if self.trust_level.trim().eq_ignore_ascii_case("trusted") {
            "trusted".to_string()
        } else {
            "strict".to_string()
        };
        self.tool_limit = self.tool_limit.clamp(1, 500);
        self
    }

    pub fn is_trusted(&self) -> bool {
        self.trust_level == "trusted"
    }
}

/// 一台 MCP 服务器的配置。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct McpServerConfig {
    pub id: i64,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    /// 环境变量（明文仅存在于内存；落库前整体加密）。
    pub env: BTreeMap<String, String>,
    pub enabled: bool,
    /// 允许可见的工作区路径；空数组 = 全部工作区可见。
    pub workspaces: Vec<String>,
    pub policy: ServerPolicy,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 所有 SELECT 共用一份列清单，避免 list/get 两处漂移。
const COLUMNS: &str = "id, name, command, args_json, env_encrypted, enabled, \
     workspaces_json, trust_level, auto_reconnect, tool_limit, concurrent, \
     created_at, updated_at";

/// 环境变量加密：把 map 序列化后交给 `secure::protect`。
fn encrypt_env(env: &BTreeMap<String, String>) -> Result<String, String> {
    let json = serde_json::to_string(env).map_err(|e| e.to_string())?;
    crate::secure::protect(&json)
}

/// 环境变量解密：解不开时回退空表（配置损坏不应让整台服务器不可用）。
fn decrypt_env(blob: &str) -> BTreeMap<String, String> {
    if blob.trim().is_empty() {
        return BTreeMap::new();
    }
    match crate::secure::unprotect(blob) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => BTreeMap::new(),
    }
}

fn row_to_config(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpServerConfig> {
    let args_json: String = row.get("args_json")?;
    let env_blob: String = row.get("env_encrypted")?;
    let workspaces_json: Option<String> = row.get("workspaces_json")?;
    Ok(McpServerConfig {
        id: row.get("id")?,
        name: row.get("name")?,
        command: row.get("command")?,
        args: serde_json::from_str(&args_json).unwrap_or_default(),
        env: decrypt_env(&env_blob),
        enabled: row.get::<_, i64>("enabled")? != 0,
        workspaces: workspaces_json
            .filter(|s| !s.trim().is_empty())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        // 老库补列后一定有 DEFAULT；这里仍做兜底，方便单测用极简表。
        policy: ServerPolicy {
            trust_level: row
                .get::<_, String>("trust_level")
                .unwrap_or_else(|_| "strict".to_string()),
            auto_reconnect: row.get::<_, i64>("auto_reconnect").unwrap_or(0) != 0,
            tool_limit: row.get::<_, i64>("tool_limit").unwrap_or(50).max(1) as usize,
            concurrent: row.get::<_, i64>("concurrent").unwrap_or(0) != 0,
        }
        .normalized(),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 列出全部服务器（按 id 升序，稳定展示顺序）。
pub fn list(conn: &Connection) -> Result<Vec<McpServerConfig>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM mcp_servers ORDER BY id ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_config)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 取单台服务器。
pub fn get(conn: &Connection, id: i64) -> Result<Option<McpServerConfig>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM mcp_servers WHERE id = ?1"
        ))
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query_map(params![id], row_to_config).map_err(|e| e.to_string())?;
    match rows.next() {
        Some(Ok(c)) => Ok(Some(c)),
        Some(Err(e)) => Err(e.to_string()),
        None => Ok(None),
    }
}

fn is_unique_violation(e: &rusqlite::Error) -> bool {
    e.to_string().contains("UNIQUE constraint failed")
}

/// 新增服务器，返回落库后的完整配置。
pub fn insert(
    conn: &Connection,
    name: &str,
    command: &str,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    workspaces: Vec<String>,
    enabled: bool,
    policy: ServerPolicy,
) -> Result<McpServerConfig, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if command.trim().is_empty() {
        return Err("命令不能为空".into());
    }
    let p = policy.normalized();
    let ts = now();
    let args_json = serde_json::to_string(&args).map_err(|e| e.to_string())?;
    let env_blob = encrypt_env(&env)?;
    let workspaces_json = serde_json::to_string(&workspaces).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO mcp_servers \
         (name, command, args_json, env_encrypted, enabled, workspaces_json, \
          trust_level, auto_reconnect, tool_limit, concurrent, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![
            name,
            command.trim(),
            args_json,
            env_blob,
            if enabled { 1 } else { 0 },
            workspaces_json,
            p.trust_level,
            if p.auto_reconnect { 1 } else { 0 },
            p.tool_limit as i64,
            if p.concurrent { 1 } else { 0 },
            ts
        ],
    )
    .map_err(|e| {
        if is_unique_violation(&e) {
            format!("同名服务器已存在：{name}")
        } else {
            e.to_string()
        }
    })?;
    let id = conn.last_insert_rowid();
    get(conn, id)?.ok_or_else(|| "新增后读取失败".to_string())
}

/// 更新服务器（不含 enabled，启用状态走 [`set_enabled`]）。
pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    command: &str,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    workspaces: Vec<String>,
    policy: ServerPolicy,
) -> Result<McpServerConfig, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if command.trim().is_empty() {
        return Err("命令不能为空".into());
    }
    let p = policy.normalized();
    let args_json = serde_json::to_string(&args).map_err(|e| e.to_string())?;
    let env_blob = encrypt_env(&env)?;
    let workspaces_json = serde_json::to_string(&workspaces).map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE mcp_servers SET name = ?1, command = ?2, args_json = ?3, \
             env_encrypted = ?4, workspaces_json = ?5, trust_level = ?6, \
             auto_reconnect = ?7, tool_limit = ?8, concurrent = ?9, \
             updated_at = ?10 WHERE id = ?11",
            params![
                name,
                command.trim(),
                args_json,
                env_blob,
                workspaces_json,
                p.trust_level,
                if p.auto_reconnect { 1 } else { 0 },
                p.tool_limit as i64,
                if p.concurrent { 1 } else { 0 },
                now(),
                id
            ],
        )
        .map_err(|e| {
            if is_unique_violation(&e) {
                format!("同名服务器已存在：{name}")
            } else {
                e.to_string()
            }
        })?;
    if changed == 0 {
        return Err("服务器不存在".into());
    }
    get(conn, id)?.ok_or_else(|| "更新后读取失败".to_string())
}

/// 删除服务器（运行中的连接由调用方先断开）。
pub fn remove(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 切换启用状态。
pub fn set_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE mcp_servers SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![if enabled { 1 } else { 0 }, now(), id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("服务器不存在".into());
    }
    Ok(())
}

/// 单独更新信任分级与连接策略（M2-08）。
/// 降级/升级都会重连，由命令层负责断开与重新拉起，这里只管落库。
pub fn set_policy(conn: &Connection, id: i64, policy: ServerPolicy) -> Result<(), String> {
    let p = policy.normalized();
    let changed = conn
        .execute(
            "UPDATE mcp_servers SET trust_level = ?1, auto_reconnect = ?2, \
             tool_limit = ?3, concurrent = ?4, updated_at = ?5 WHERE id = ?6",
            params![
                p.trust_level,
                if p.auto_reconnect { 1 } else { 0 },
                p.tool_limit as i64,
                if p.concurrent { 1 } else { 0 },
                now(),
                id
            ],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("服务器不存在".into());
    }
    Ok(())
}

/// 添加/更新服务器前的**静态审查**：复用安全规则表扫描命令与参数。
///
/// 返回：
/// - `Err(msg)`：命中 HardBlock（不可逆破坏等），拒绝接入；
/// - `Ok(Some(msg))`：命中提示级规则，调用方记录并提示用户；
/// - `Ok(None)`：干净。
pub fn audit_server(command: &str, args: &[String]) -> Result<Option<String>, String> {
    let line = std::iter::once(command.to_string())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    let line = line.trim();
    if line.is_empty() {
        return Ok(None);
    }
    match crate::security::rules::check_command(line) {
        Some(hit) if hit.action == crate::security::rules::Action::HardBlock => Err(format!(
            "该命令命中安全规则「{}」：{}",
            hit.id, hit.reason
        )),
        Some(hit) => Ok(Some(format!(
            "该命令命中提示规则「{}」：{}",
            hit.id, hit.reason
        ))),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE mcp_servers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                command TEXT NOT NULL,
                args_json TEXT NOT NULL DEFAULT '[]',
                env_encrypted TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                workspaces_json TEXT,
                trust_level TEXT NOT NULL DEFAULT 'strict',
                auto_reconnect INTEGER NOT NULL DEFAULT 0,
                tool_limit INTEGER NOT NULL DEFAULT 50,
                concurrent INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn insert_list_get_update_remove_roundtrip() {
        let conn = mem();
        let mut env = BTreeMap::new();
        env.insert("TOKEN".to_string(), "sk-secret".to_string());
        let c = insert(
            &conn,
            "filesystem",
            "npx",
            vec!["-y".into(), "server".into()],
            env,
            vec![],
            true,
            ServerPolicy::default(),
        )
        .expect("应能新增");
        assert_eq!(c.name, "filesystem");
        assert!(c.enabled);
        assert_eq!(c.env.get("TOKEN").map(String::as_str), Some("sk-secret"));

        // 环境变量落库必须是密文，不能出现明文。
        let raw: String = conn
            .query_row("SELECT env_encrypted FROM mcp_servers WHERE id = ?1", params![c.id], |r| r.get(0))
            .unwrap();
        assert!(!raw.contains("sk-secret"), "env 不应明文落库：{raw}");
        assert!(!raw.is_empty());

        assert_eq!(list(&conn).unwrap().len(), 1);
        assert_eq!(get(&conn, c.id).unwrap().unwrap().name, "filesystem");

        let updated = update(
            &conn,
            c.id,
            "fs2",
            "node",
            vec!["a".into()],
            BTreeMap::new(),
            vec!["/w".into()],
            ServerPolicy::default(),
        )
        .unwrap();
        assert_eq!(updated.name, "fs2");
        assert_eq!(updated.workspaces, vec!["/w".to_string()]);

        set_enabled(&conn, c.id, false).unwrap();
        assert!(!get(&conn, c.id).unwrap().unwrap().enabled);

        remove(&conn, c.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn duplicate_name_is_rejected_with_readable_message() {
        let conn = mem();
        insert(&conn, "dup", "npx", vec![], BTreeMap::new(), vec![], true, ServerPolicy::default()).unwrap();
        let err = insert(&conn, "dup", "npx", vec![], BTreeMap::new(), vec![], true, ServerPolicy::default()).unwrap_err();
        assert!(err.contains("已存在"), "{err}");
    }

    #[test]
    fn empty_name_or_command_is_rejected() {
        let conn = mem();
        assert!(insert(&conn, " ", "npx", vec![], BTreeMap::new(), vec![], true, ServerPolicy::default()).is_err());
        assert!(insert(&conn, "x", "  ", vec![], BTreeMap::new(), vec![], true, ServerPolicy::default()).is_err());
    }

    #[test]
    fn audit_rejects_hard_block_commands() {
        // mkfs 属不可逆破坏，必须拒绝接入。
        let err = audit_server("mkfs.ext4", &["/dev/sda1".into()]).unwrap_err();
        assert!(err.contains("安全规则"), "{err}");
    }

    #[test]
    fn audit_allows_normal_mcp_command() {
        // 常规 npx 服务器不应被硬拒。
        let r = audit_server("npx", &["-y".into(), "server-filesystem".into()]);
        assert!(r.is_ok(), "普通命令不应被拒绝：{r:?}");
    }

    #[test]
    fn policy_defaults_keep_phase_one_behavior() {
        let conn = mem();
        let c = insert(
            &conn,
            "p",
            "npx",
            vec![],
            BTreeMap::new(),
            vec![],
            true,
            ServerPolicy::default(),
        )
        .unwrap();
        assert!(!c.policy.is_trusted());
        assert!(!c.policy.auto_reconnect);
        assert!(!c.policy.concurrent);
        assert_eq!(c.policy.tool_limit, 50);
    }

    #[test]
    fn set_policy_roundtrip_normalizes_values() {
        let conn = mem();
        let c = insert(
            &conn,
            "p",
            "npx",
            vec![],
            BTreeMap::new(),
            vec![],
            true,
            ServerPolicy::default(),
        )
        .unwrap();
        set_policy(
            &conn,
            c.id,
            ServerPolicy {
                trust_level: "TRUSTED".into(),
                auto_reconnect: true,
                tool_limit: 9999,
                concurrent: true,
            },
        )
        .unwrap();
        let got = get(&conn, c.id).unwrap().unwrap().policy;
        assert!(got.is_trusted());
        assert!(got.auto_reconnect);
        assert!(got.concurrent);
        assert_eq!(got.tool_limit, 500);
    }

    #[test]
    fn unknown_trust_level_falls_back_to_strict() {
        let p = ServerPolicy {
            trust_level: "admin".into(),
            ..Default::default()
        }
        .normalized();
        assert!(!p.is_trusted());
        assert_eq!(p.trust_level, "strict");
    }

    #[test]
    fn migrate_adds_policy_columns_to_legacy_table_idempotently() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id INTEGER PRIMARY KEY, workspace TEXT, todos_json TEXT);
             CREATE TABLE mcp_servers (
                id INTEGER PRIMARY KEY, name TEXT, command TEXT, args_json TEXT,
                env_encrypted TEXT, enabled INTEGER, workspaces_json TEXT,
                created_at INTEGER, updated_at INTEGER);
             INSERT INTO mcp_servers (id, name, command) VALUES (1, 'old', 'npx');",
        )
        .unwrap();
        crate::db::migrate(&conn).unwrap();
        let row: (String, i64, i64, i64) = conn
            .query_row(
                "SELECT trust_level, auto_reconnect, tool_limit, concurrent \
                 FROM mcp_servers WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(row, ("strict".to_string(), 0, 50, 0));
        // 重复执行不能因列已存在而失败
        crate::db::migrate(&conn).unwrap();
    }
}
