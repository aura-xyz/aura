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
    pub created_at: i64,
    pub updated_at: i64,
}

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
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 列出全部服务器（按 id 升序，稳定展示顺序）。
pub fn list(conn: &Connection) -> Result<Vec<McpServerConfig>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, command, args_json, env_encrypted, enabled, \
             workspaces_json, created_at, updated_at FROM mcp_servers ORDER BY id ASC",
        )
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
        .prepare(
            "SELECT id, name, command, args_json, env_encrypted, enabled, \
             workspaces_json, created_at, updated_at FROM mcp_servers WHERE id = ?1",
        )
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
) -> Result<McpServerConfig, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if command.trim().is_empty() {
        return Err("命令不能为空".into());
    }
    let ts = now();
    let args_json = serde_json::to_string(&args).map_err(|e| e.to_string())?;
    let env_blob = encrypt_env(&env)?;
    let workspaces_json = serde_json::to_string(&workspaces).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO mcp_servers \
         (name, command, args_json, env_encrypted, enabled, workspaces_json, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            name,
            command.trim(),
            args_json,
            env_blob,
            if enabled { 1 } else { 0 },
            workspaces_json,
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
) -> Result<McpServerConfig, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if command.trim().is_empty() {
        return Err("命令不能为空".into());
    }
    let args_json = serde_json::to_string(&args).map_err(|e| e.to_string())?;
    let env_blob = encrypt_env(&env)?;
    let workspaces_json = serde_json::to_string(&workspaces).map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE mcp_servers SET name = ?1, command = ?2, args_json = ?3, \
             env_encrypted = ?4, workspaces_json = ?5, updated_at = ?6 WHERE id = ?7",
            params![name, command.trim(), args_json, env_blob, workspaces_json, now(), id],
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

        let updated = update(&conn, c.id, "fs2", "node", vec!["a".into()], BTreeMap::new(), vec!["/w".into()]).unwrap();
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
        insert(&conn, "dup", "npx", vec![], BTreeMap::new(), vec![], true).unwrap();
        let err = insert(&conn, "dup", "npx", vec![], BTreeMap::new(), vec![], true).unwrap_err();
        assert!(err.contains("已存在"), "{err}");
    }

    #[test]
    fn empty_name_or_command_is_rejected() {
        let conn = mem();
        assert!(insert(&conn, " ", "npx", vec![], BTreeMap::new(), vec![], true).is_err());
        assert!(insert(&conn, "x", "  ", vec![], BTreeMap::new(), vec![], true).is_err());
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
}
