use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde_json::Value;

pub struct SavedSession {
    pub id: String,
    pub title: String,
    pub workspace: String,
    pub messages: Vec<Value>,
    pub todos: Vec<crate::agent::Todo>,
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn json_err(e: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(e))
}

pub fn open(path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS settings (
             key TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS sessions (
             id TEXT PRIMARY KEY,
             title TEXT NOT NULL,
             workspace TEXT NOT NULL,
             history_json TEXT NOT NULL DEFAULT '[]',
             model_idx INTEGER NOT NULL DEFAULT 0,
             todos_json TEXT NOT NULL DEFAULT '[]',
             updated_at INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS messages (
             session_id TEXT NOT NULL,
             seq INTEGER NOT NULL,
             payload TEXT NOT NULL,
             PRIMARY KEY (session_id, seq)
         );
         -- v0.6.1：技能的启用状态覆盖。技能实体永远在磁盘（SKILL.md），
         -- 库里只记「用户改过什么」，所以没有行的技能 = 默认启用。
         CREATE TABLE IF NOT EXISTS skills (
             name TEXT PRIMARY KEY,
             path TEXT NOT NULL,
             source TEXT NOT NULL,
             enabled INTEGER NOT NULL DEFAULT 1
         );
         -- v0.6.3：市场自定义源。官方源写死在代码里（不可删），这里只存
         -- 用户添加的 GitHub 仓库；url 已归一化为 raw 基址。
         CREATE TABLE IF NOT EXISTS skill_sources (
             url TEXT PRIMARY KEY,
             name TEXT NOT NULL
         );
         -- v0.6.2：操作时间线。记录模型在一次会话里的全部操作。
         -- session_id 实现「对话级隔离」：查某会话只取它的行。
         CREATE TABLE IF NOT EXISTS timeline (
             session_id  TEXT NOT NULL,
             seq         INTEGER NOT NULL,
             ts_ms       INTEGER NOT NULL,
             turn        INTEGER NOT NULL DEFAULT 0,
             kind        TEXT NOT NULL,
             title       TEXT NOT NULL,
             detail      TEXT,
             ok          INTEGER NOT NULL DEFAULT 1,
             duration_ms INTEGER,
             PRIMARY KEY (session_id, seq)
         );
         -- v0.6.2：路径白名单。授权给模型访问的额外目录。
         -- path 是归一化后的绝对路径（正斜杠），builtin=1 是内置默认项
         -- （skills/local，不可删）。判定逻辑在 paths.rs，不在库里。
         CREATE TABLE IF NOT EXISTS path_allowlist (
             path TEXT PRIMARY KEY,
             label TEXT NOT NULL,
             builtin INTEGER NOT NULL DEFAULT 0,
             added_at INTEGER NOT NULL DEFAULT 0
         );",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

/// 迁移历史脏数据：早期 set_workspace 曾写入带 //?/ 扩展前缀的键，
/// 与普通路径并存导致侧边栏出现重复的 src-tauri 分组。
/// 同时补齐 v0.4.0 新增的 `todos_json` 列。
pub(crate) fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE sessions SET workspace = replace(workspace, '//?/', '')
         WHERE workspace LIKE '//?/%'",
        [],
    )?;

    // CREATE TABLE IF NOT EXISTS 不会给已存在的表补列，老库必须单独 ALTER。
    // 用 pragma_table_info 判断而非「执行后再看报错」，因为 SQLite 不支持
    // IF NOT EXISTS 形式的 ADD COLUMN，重复执行会直接失败。
    let has_todos = conn
        .prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'todos_json'")?
        .query([])?
        .next()?
        .is_some();
    if !has_todos {
        conn.execute(
            "ALTER TABLE sessions ADD COLUMN todos_json TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
    }
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    match rows.next()? {
        Some(row) => Ok(row.get(0)?),
        None => Ok(None),
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// 技能的持久化状态。`path` / `source` 是快照（便于排障与审计），
/// 运行时一律以磁盘扫描结果为准——技能被用户手动挪走后，行里的路径就是旧值。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillRow {
    pub name: String,
    pub path: String,
    pub source: String,
    pub enabled: bool,
}

pub fn load_skill_rows(conn: &Connection) -> Result<Vec<SkillRow>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached("SELECT name, path, source, enabled FROM skills")?;
    let rows = stmt.query_map([], |r| {
        Ok(SkillRow {
            name: r.get(0)?,
            path: r.get(1)?,
            source: r.get(2)?,
            // SQLite 没有 bool：0 = 禁用，其余（含历史脏值）= 启用
            enabled: r.get::<_, i64>(3)? != 0,
        })
    })?;
    rows.collect()
}

/// 写入启用状态。按 name 覆盖（同一技能名四个来源共用一份状态）。
pub fn set_skill_enabled(
    conn: &Connection,
    name: &str,
    path: &str,
    source: &str,
    enabled: bool,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO skills (name, path, source, enabled) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(name) DO UPDATE SET
             path = excluded.path,
             source = excluded.source,
             enabled = excluded.enabled",
        params![name, path, source, enabled as i64],
    )?;
    Ok(())
}

pub fn remove_skill_row(conn: &Connection, name: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM skills WHERE name = ?1", params![name])?;
    Ok(())
}

/// 被禁用的技能名。runner 每轮开头读一次，用于把技能挡在 L1 索引之外。
pub fn disabled_skill_names(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached("SELECT name FROM skills WHERE enabled = 0")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

/// 用户添加的市场源。官方源不在表里（写死在代码里，不可删）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceRow {
    pub name: String,
    pub url: String,
}

pub fn load_skill_sources(conn: &Connection) -> Result<Vec<SourceRow>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached("SELECT name, url FROM skill_sources ORDER BY name")?;
    let rows = stmt.query_map([], |r| {
        Ok(SourceRow {
            name: r.get(0)?,
            url: r.get(1)?,
        })
    })?;
    rows.collect()
}

/// 添加源。同 url 重复添加只更新名字（用户改了个称呼不该报错）。
pub fn add_skill_source(conn: &Connection, url: &str, name: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO skill_sources (url, name) VALUES (?1, ?2)
         ON CONFLICT(url) DO UPDATE SET name = excluded.name",
        params![url, name],
    )?;
    Ok(())
}

pub fn remove_skill_source(conn: &Connection, url: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM skill_sources WHERE url = ?1", params![url])?;
    Ok(())
}

/// 一条路径白名单。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllowlistRow {
    /// 归一化后的绝对路径（正斜杠）
    pub path: String,
    /// 展示名
    pub label: String,
    /// 内置默认项（不可删）
    pub builtin: bool,
}

pub fn load_allowlist(conn: &Connection) -> Result<Vec<AllowlistRow>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        "SELECT path, label, builtin FROM path_allowlist ORDER BY builtin DESC, added_at, path",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(AllowlistRow {
            path: r.get(0)?,
            label: r.get(1)?,
            builtin: r.get::<_, i64>(2)? != 0,
        })
    })?;
    rows.collect()
}

/// 添加白名单项。同路径重复添加只更新展示名。
pub fn add_allowlist(
    conn: &Connection,
    path: &str,
    label: &str,
    builtin: bool,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO path_allowlist (path, label, builtin, added_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO UPDATE SET label = excluded.label",
        params![path, label, builtin as i64, now()],
    )?;
    Ok(())
}

/// 写入一条时间线记录。
///
/// 同 seq 覆盖（重试写入不会产生重复行）。
pub fn add_timeline_entry(conn: &Connection, e: &crate::timeline::TimelineEntry) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO timeline (session_id, seq, ts_ms, turn, kind, title, detail, ok, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(session_id, seq) DO UPDATE SET
             ts_ms = excluded.ts_ms,
             turn = excluded.turn,
             kind = excluded.kind,
             title = excluded.title,
             detail = excluded.detail,
             ok = excluded.ok,
             duration_ms = excluded.duration_ms",
        params![
            e.session_id,
            e.seq,
            e.ts_ms,
            e.turn,
            kind_str(e.kind),
            e.title,
            e.detail,
            e.ok as i64,
            e.duration_ms,
        ],
    )?;
    Ok(())
}

/// 类型与字符串互转（库里存字符串，代码里用枚举）。
fn kind_str(k: crate::timeline::EntryKind) -> &'static str {
    match k {
        crate::timeline::EntryKind::User => "user",
        crate::timeline::EntryKind::Assistant => "assistant",
        crate::timeline::EntryKind::Tool => "tool",
        crate::timeline::EntryKind::Denied => "denied",
        crate::timeline::EntryKind::Context => "context",
        crate::timeline::EntryKind::Todo => "todo",
        crate::timeline::EntryKind::Error => "error",
        crate::timeline::EntryKind::Notice => "notice",
    }
}

/// 字符串 → 类型。认不出来的当作提示（不丢数据）。
fn kind_from(s: &str) -> crate::timeline::EntryKind {
    use crate::timeline::EntryKind::*;
    match s {
        "user" => User,
        "assistant" => Assistant,
        "tool" => Tool,
        "denied" => Denied,
        "context" => Context,
        "todo" => Todo,
        "error" => Error,
        _ => Notice,
    }
}

/// 读某会话的全部时间线记录，按 seq 升序。
pub fn load_timeline(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<crate::timeline::TimelineEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        "SELECT session_id, seq, ts_ms, turn, kind, title, detail, ok, duration_ms
         FROM timeline WHERE session_id = ?1 ORDER BY seq",
    )?;
    let rows = stmt.query_map(params![session_id], |r| {
        Ok(crate::timeline::TimelineEntry {
            session_id: r.get(0)?,
            seq: r.get(1)?,
            ts_ms: r.get(2)?,
            turn: r.get(3)?,
            kind: kind_from(&r.get::<_, String>(4)?),
            title: r.get(5)?,
            detail: r.get(6)?,
            ok: r.get::<_, i64>(7)? != 0,
            duration_ms: r.get(8)?,
        })
    })?;
    rows.collect()
}

/// 删掉某会话的时间线（会话被删除时一起清掉）。
pub fn delete_timeline(conn: &Connection, session_id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM timeline WHERE session_id = ?1", params![session_id])?;
    Ok(())
}

/// 删除白名单项。内置项不可删——返回 false 表示没删。
pub fn remove_allowlist(conn: &Connection, path: &str) -> Result<bool, rusqlite::Error> {
    let n = conn.execute(
        "DELETE FROM path_allowlist WHERE path = ?1 AND builtin = 0",
        params![path],
    )?;
    Ok(n > 0)
}

pub fn save_session(
    conn: &Connection,
    id: &str,
    title: &str,
    workspace: &str,
    messages: &[Value],
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO sessions (id, title, workspace, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             workspace = excluded.workspace,
             updated_at = excluded.updated_at",
        params![id, title, workspace, now()],
    )?;
    conn.execute("DELETE FROM messages WHERE session_id = ?1", params![id])?;
    let mut stmt =
        conn.prepare_cached("INSERT INTO messages (session_id, seq, payload) VALUES (?1, ?2, ?3)")?;
    for (i, m) in messages.iter().enumerate() {
        stmt.execute(params![id, i as i64, m.to_string()])?;
    }
    Ok(())
}

/// 仅更新 agent 历史，绝不插入会话行。
///
/// 历史行由前端 `save_session` 负责创建（携带真实 title/workspace）；
/// 这里若用 INSERT OR IGNORE 会写入 `title=''`、`workspace=''` 的脏行，
/// 导致下次启动侧边栏多出��空白工作区分组。
pub fn save_history(
    conn: &Connection,
    id: &str,
    history: &[Value],
    model_idx: usize,
) -> Result<(), rusqlite::Error> {
    let json = serde_json::to_string(history).map_err(json_err)?;
    conn.execute(
        "UPDATE sessions SET history_json = ?2, model_idx = ?3 WHERE id = ?1",
        params![id, json, model_idx as i64],
    )?;
    Ok(())
}

pub fn load_history(
    conn: &Connection,
    id: &str,
) -> Result<Option<(Vec<Value>, usize)>, rusqlite::Error> {
    let mut stmt =
        conn.prepare_cached("SELECT history_json, model_idx FROM sessions WHERE id = ?1")?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => {
            let json: String = row.get(0)?;
            let idx: i64 = row.get(1)?;
            let history = serde_json::from_str(&json).map_err(json_err)?;
            Ok(Some((history, idx as usize)))
        }
        None => Ok(None),
    }
}

/// 覆盖保存任务清单，绝不插入会话行。
///
/// 与 [`save_history`] 同理：会话行由前端 `save_session` 创建，此处若 INSERT
/// 会写出 `title=''` 的脏行，让侧边栏多出空白工作区分组。
pub fn save_todos(
    conn: &Connection,
    id: &str,
    todos: &[crate::agent::Todo],
) -> Result<(), rusqlite::Error> {
    let json = serde_json::to_string(todos).map_err(json_err)?;
    conn.execute(
        "UPDATE sessions SET todos_json = ?2 WHERE id = ?1",
        params![id, json],
    )?;
    Ok(())
}

/// 读取任务清单。会话不存在或内容损坏时返回空清单而非报错——
/// 清单是增强信息，不该让整个会话加载失败。
pub fn load_todos(
    conn: &Connection,
    id: &str,
) -> Result<Vec<crate::agent::Todo>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached("SELECT todos_json FROM sessions WHERE id = ?1")?;
    let mut rows = stmt.query(params![id])?;
    let Some(row) = rows.next()? else {
        return Ok(Vec::new());
    };
    let json: String = row.get(0)?;
    Ok(serde_json::from_str(&json).unwrap_or_default())
}

/// 取单个会话的工作区（`load_sessions` 的单项版本）。
///
/// `send_message` 用它决定工具的执行目录。**不能改用 `AppState.workspace`**
/// 那个全局单值：那是「当前聚焦哪个」的 UI 状态，一旦与实际发送的会话
/// 不一致，模型就会在错误的目录里读写文件（Build 模式的沙盒边界正是它）。
///
/// 内存新建、尚未落库的会话查不到（`save_session` 只在首次发消息时才写），
/// 返回 `None` 由调用方回落全局值。
pub fn load_session_workspace(
    conn: &Connection,
    id: &str,
) -> Result<Option<String>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached("SELECT workspace FROM sessions WHERE id = ?1")?;
    let mut rows = stmt.query(params![id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    Ok(Some(row.get(0)?))
}

fn load_messages(conn: &Connection, session_id: &str) -> Result<Vec<Value>, rusqlite::Error> {
    let mut stmt =
        conn.prepare_cached("SELECT payload FROM messages WHERE session_id = ?1 ORDER BY seq")?;
    let rows = stmt.query_map(params![session_id], |row| row.get::<_, String>(0))?;
    let mut out = Vec::new();
    for payload in rows {
        out.push(serde_json::from_str(&payload?).map_err(json_err)?);
    }
    Ok(out)
}

pub fn load_sessions(conn: &Connection) -> Result<Vec<SavedSession>, rusqlite::Error> {
    let mut stmt =
        conn.prepare_cached("SELECT id, title, workspace FROM sessions ORDER BY updated_at DESC")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, title, workspace) = row?;
        let messages = load_messages(conn, &id)?;
        let todos = load_todos(conn, &id)?;
        out.push(SavedSession {
            id,
            title,
            workspace,
            messages,
            todos,
        });
    }
    Ok(out)
}

/// 物理删除空会话：没有任何消息，或工作区字段为空（历史脏数据）。
/// 返回被删除的行数。启动时调用一次，保证侧边栏不被空对话挤满。
pub fn purge_empty_sessions(conn: &Connection) -> Result<usize, rusqlite::Error> {
    conn.execute(
        "DELETE FROM messages WHERE session_id IN (
            SELECT s.id FROM sessions s
            LEFT JOIN messages m ON m.session_id = s.id
            WHERE s.workspace = '' OR m.session_id IS NULL
         )",
        [],
    )?;
    let removed = conn.execute(
        "DELETE FROM sessions WHERE workspace = ''
         OR id NOT IN (SELECT DISTINCT session_id FROM messages)",
        [],
    )?;
    Ok(removed)
}

pub fn delete_session(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM messages WHERE session_id = ?1", params![id])?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete_workspace(conn: &Connection, workspace: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE workspace = ?1)",
        params![workspace],
    )?;
    conn.execute("DELETE FROM sessions WHERE workspace = ?1", params![workspace])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setting_roundtrip_and_upsert() {
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "setting"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("t.db")).unwrap();

        assert_eq!(get_setting(&conn, "global_rules").unwrap(), None);
        set_setting(&conn, "global_rules", "使用中文回复").unwrap();
        assert_eq!(
            get_setting(&conn, "global_rules").unwrap().as_deref(),
            Some("使用中文回复")
        );
        set_setting(&conn, "global_rules", "使用英文回复").unwrap();
        assert_eq!(
            get_setting(&conn, "global_rules").unwrap().as_deref(),
            Some("使用英文回复")
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn session_persistence_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "session"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("t.db")).unwrap();

        let messages = vec![
            serde_json::json!({ "id": "m1", "role": "user", "content": "你好" }),
            serde_json::json!({ "id": "m2", "role": "assistant", "blocks": [] }),
        ];
        save_session(&conn, "s1", "问候", "/ws", &messages).unwrap();
        let history = vec![serde_json::json!({ "role": "user", "content": "你好" })];
        save_history(&conn, "s1", &history, 1).unwrap();

        let loaded = load_sessions(&conn).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "s1");
        assert_eq!(loaded[0].title, "问候");
        assert_eq!(loaded[0].messages.len(), 2);

        let (restored, model_idx) = load_history(&conn, "s1").unwrap().unwrap();
        assert_eq!(restored, history);
        assert_eq!(model_idx, 1);

        save_session(&conn, "s1", "问候2", "/ws2", &messages[..1]).unwrap();
        let loaded = load_sessions(&conn).unwrap();
        assert_eq!(loaded[0].title, "问候2");
        assert_eq!(loaded[0].messages.len(), 1);
        let (_, model_idx) = load_history(&conn, "s1").unwrap().unwrap();
        assert_eq!(model_idx, 1, "保存 UI 消息不应清空 history");

        delete_session(&conn, "s1").unwrap();
        assert!(load_sessions(&conn).unwrap().is_empty());
        assert!(load_history(&conn, "s1").unwrap().is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn purge_removes_empty_and_dirty_sessions_only() {
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "purge"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("t.db")).unwrap();

        let msg = serde_json::json!({ "id": "m1", "role": "user", "content": "hi" });
        // 有消息：保留
        save_session(&conn, "keep", "正常对话", "E:/dev/aura", &[msg]).unwrap();
        // 无消息：应清除
        save_session(&conn, "blank", "新对话", "E:/dev/aura", &[]).unwrap();
        // 模拟 save_history 历史脏行（workspace 为空）
        conn.execute(
            "INSERT OR IGNORE INTO sessions (id, title, workspace, updated_at) VALUES ('dirty','',' ', 0)",
            [],
        )
        .unwrap();

        assert_eq!(load_sessions(&conn).unwrap().len(), 3);
        let removed = purge_empty_sessions(&conn).unwrap();
        assert_eq!(removed, 2);

        let left = load_sessions(&conn).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, "keep");

        // 幂等：再次清理不应删掉任何东西
        assert_eq!(purge_empty_sessions(&conn).unwrap(), 0);
        assert_eq!(load_sessions(&conn).unwrap().len(), 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_history_never_creates_session_row() {
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "history"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("t.db")).unwrap();

        // 会话行不存在时，save_history 不应凭空插入空 title/workspace 的行
        save_history(&conn, "ghost", &[serde_json::json!({"role":"user"})], 0).unwrap();
        assert!(load_sessions(&conn).unwrap().is_empty());

        // 行存在时正常更新，且不破坏原有 title/workspace
        save_session(&conn, "s1", "标题", "E:/dev/aura", &[]).unwrap();
        save_history(&conn, "s1", &[serde_json::json!({"role":"user"})], 2).unwrap();
        let (hist, idx) = load_history(&conn, "s1").unwrap().unwrap();
        assert_eq!(hist.len(), 1);
        assert_eq!(idx, 2);
        let loaded = load_sessions(&conn).unwrap();
        assert_eq!(loaded[0].title, "标题");
        assert_eq!(loaded[0].workspace, "E:/dev/aura");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn load_session_workspace_distinguishes_hit_miss_and_empty() {
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "session-workspace"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("t.db")).unwrap();

        // 命中：返回该会话自己的工作区
        save_session(&conn, "s1", "A", "E:/dev/aura", &[]).unwrap();
        save_session(&conn, "s2", "B", "E:/dev/other", &[]).unwrap();
        assert_eq!(
            load_session_workspace(&conn, "s1").unwrap().as_deref(),
            Some("E:/dev/aura")
        );
        assert_eq!(
            load_session_workspace(&conn, "s2").unwrap().as_deref(),
            Some("E:/dev/other")
        );

        // 未命中：内存新建、尚未落库的会话走这条，由调用方回落全局值
        assert_eq!(load_session_workspace(&conn, "not-yet-saved").unwrap(), None);

        // 空串：脏数据。返回 Some("") 而非 None，调用方需自行 filter——
        // 这里只固定 db 层的原样返回，不替调用方做判断
        conn.execute(
            "UPDATE sessions SET workspace = '' WHERE id = 's2'",
            [],
        )
        .unwrap();
        assert_eq!(
            load_session_workspace(&conn, "s2").unwrap().as_deref(),
            Some("")
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_migrates_extended_workspace_keys() {
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "migration"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");

        let conn = open(&path).unwrap();
        save_session(&conn, "s1", "t", "//?/E:/dev/aura", &[]).unwrap();
        save_session(&conn, "s2", "t", "E:/dev/aura", &[]).unwrap();
        drop(conn);

        let conn = open(&path).unwrap();
        let loaded = load_sessions(&conn).unwrap();
        let ws1 = loaded
            .iter()
            .find(|s| s.id == "s1")
            .map(|s| s.workspace.clone());
        let ws2 = loaded
            .iter()
            .find(|s| s.id == "s2")
            .map(|s| s.workspace.clone());
        assert_eq!(ws1.as_deref(), Some("E:/dev/aura"));
        assert_eq!(ws2.as_deref(), Some("E:/dev/aura"));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// v0.4.0 新增列。老库由 migrate() 的 ALTER TABLE 补齐，
    /// 这条测试刻意建一个不含 todos_json 的旧结构库来验证迁移。
    #[test]
    fn open_migrates_legacy_table_without_todos_column() {
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "legacy-todos"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("legacy.db");

        // 手工造一个 v0.3.x 结构的库：有会话行，但没有 todos_json 列
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                 id TEXT PRIMARY KEY,
                 title TEXT NOT NULL,
                 workspace TEXT NOT NULL,
                 history_json TEXT NOT NULL DEFAULT '[]',
                 model_idx INTEGER NOT NULL DEFAULT 0,
                 updated_at INTEGER NOT NULL DEFAULT 0
             );
             INSERT INTO sessions (id, title, workspace, updated_at)
             VALUES ('old', '旧会话', 'E:/dev/aura', 1);",
        )
        .unwrap();
        drop(conn);

        // 重新打开应完成迁移，且旧会话行不能丢
        let conn = open(&path).unwrap();
        let loaded = load_sessions(&conn).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "old");
        assert_eq!(loaded[0].title, "旧会话");
        assert!(loaded[0].todos.is_empty(), "旧会话默认空清单");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 迁移必须可重复执行：open() 每次启动都会跑 migrate()，
    /// 第二次运行若再 ALTER 一次会直接报错。
    #[test]
    fn migration_is_idempotent() {
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "idempotent"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        let conn = open(&path).unwrap();
        drop(conn);
        // 第二次 open 再次执行 migrate，不应因列已存在而失败
        let conn = open(&path).unwrap();
        drop(conn);
        let _ = open(&path).unwrap();

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn todos_roundtrip_and_survive_message_saves() {
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "todos"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        let conn = open(&path).unwrap();
        save_session(&conn, "s1", "t", "E:/dev/aura", &[]).unwrap();

        let todos = vec![
            crate::agent::Todo::new("s1", "建表"),
            crate::agent::Todo {
                id: "s2".into(),
                title: "写测试".into(),
                status: crate::agent::TodoStatus::Done,
            },
        ];
        save_todos(&conn, "s1", &todos).unwrap();

        // 保存 UI 消息（全量重写 messages）不应影响独立列
        save_session(
            &conn,
            "s1",
            "t",
            "E:/dev/aura",
            &[serde_json::json!({"id":"m1","role":"user","content":"hi"})],
        )
        .unwrap();

        let loaded = load_sessions(&conn).unwrap();
        let s = loaded.iter().find(|s| s.id == "s1").unwrap();
        assert_eq!(s.todos.len(), 2);
        assert_eq!(s.todos[0].title, "建表");
        // 关键：状态枚举必须原样往返，否则前端读到的是错的进度
        assert_eq!(s.todos[1].status, crate::agent::TodoStatus::Done);
        assert_eq!(s.messages.len(), 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn load_todos_on_missing_session_is_empty_not_error() {
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "no-session"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("t.db")).unwrap();
        assert!(load_todos(&conn, "nope").unwrap().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_todos_does_not_create_ghost_session() {
        // 会话行只由 save_session 创建；save_todos 若 INSERT 会写出
        // title='' 的脏行，让侧边栏多出空白工作区分组
        let dir = std::env::temp_dir().join(format!(
            "aura-db-test-{}-{}",
            std::process::id(),
            "ghost"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("t.db")).unwrap();
        save_todos(&conn, "ghost", &[crate::agent::Todo::new("s1", "任务")]).unwrap();
        assert!(load_sessions(&conn).unwrap().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// v0.6.2：时间线的读写往返与**对话级隔离**。
    ///
    /// 隔离是这张表的核心语义：两个会话的记录混在一起就没意义了。
    #[test]
    fn timeline_round_trip_and_session_isolation() {
        let dir = std::env::temp_dir().join(format!("aura-db-test-{}-timeline", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("timeline.db")).unwrap();

        use crate::timeline::{EntryKind, TimelineEntry};

        let e1 = TimelineEntry::new("s1", 0, 1000, 0, EntryKind::User, "你好");
        let e2 = TimelineEntry::new("s1", 1, 2000, 1, EntryKind::Tool, "Read a.rs")
            .with_detail("参数：{}")
            .with_duration(42);
        let e3 = TimelineEntry::new("s2", 0, 3000, 0, EntryKind::User, "另一个会话");
        add_timeline_entry(&conn, &e1).unwrap();
        add_timeline_entry(&conn, &e2).unwrap();
        add_timeline_entry(&conn, &e3).unwrap();

        // 只取得到本会话的记录
        let rows = load_timeline(&conn, "s1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].title, "你好");
        assert_eq!(rows[0].kind, EntryKind::User);
        assert_eq!(rows[1].kind, EntryKind::Tool);
        assert_eq!(rows[1].duration_ms, Some(42));
        assert_eq!(rows[1].detail.as_deref(), Some("参数：{}"));
        assert!(rows[1].ok);

        // 另一个会话只看到自己那条
        let other = load_timeline(&conn, "s2").unwrap();
        assert_eq!(other.len(), 1);
        assert_eq!(other[0].title, "另一个会话");

        // 同 seq 覆盖而不是产生重复行
        let mut dup = e1.clone();
        dup.title = "改过的".into();
        add_timeline_entry(&conn, &dup).unwrap();
        let rows = load_timeline(&conn, "s1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].title, "改过的");

        // 删除会话时一并清掉
        delete_timeline(&conn, "s1").unwrap();
        assert!(load_timeline(&conn, "s1").unwrap().is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// v0.6.2：路径白名单的读写往返。
    ///
    /// 内置项（builtin=1）必须删不掉——它是「技能目录」这个默认授权，
    /// 用户可以在设置里看到它，但不该能移除掉整个能力。
    #[test]
    fn allowlist_round_trip() {
        let dir = std::env::temp_dir().join(format!("aura-db-test-{}-allowlist", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("allowlist.db")).unwrap();

        assert!(load_allowlist(&conn).unwrap().is_empty());

        add_allowlist(&conn, "C:/data", "数据目录", false).unwrap();
        add_allowlist(&conn, "C:/app/skills/local", "技能目录", true).unwrap();

        let rows = load_allowlist(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        // 内置项排在前面（ORDER BY builtin DESC）
        assert!(rows[0].builtin);
        assert_eq!(rows[0].label, "技能目录");
        assert!(!rows[1].builtin);
        assert_eq!(rows[1].path, "C:/data");

        // 同路径重复添加只更新名字，不新增行
        add_allowlist(&conn, "C:/data", "新名字", false).unwrap();
        let rows = load_allowlist(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].label, "新名字");

        // 内置项删不掉
        assert!(!remove_allowlist(&conn, "C:/app/skills/local").unwrap());
        assert_eq!(load_allowlist(&conn).unwrap().len(), 2);

        // 用户项能删
        assert!(remove_allowlist(&conn, "C:/data").unwrap());
        assert_eq!(load_allowlist(&conn).unwrap().len(), 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    /// v0.6.1 技能状态表：按 name 覆盖、禁用名单只由 enabled=0 产生、
    /// 删除行后回到「默认启用」的语义。
    #[test]
    fn skill_states_round_trip() {
        let dir = std::env::temp_dir().join(format!("aura-db-test-{}-skills", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("skills.db")).unwrap();

        // 空表：没有记录（调用方按「默认启用」处理），禁用名单为空
        assert!(load_skill_rows(&conn).unwrap().is_empty());
        assert!(disabled_skill_names(&conn).unwrap().is_empty());

        set_skill_enabled(&conn, "demo", "E:/skills/local/demo", "local", false).unwrap();
        let rows = load_skill_rows(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "demo");
        assert!(!rows[0].enabled);
        assert_eq!(rows[0].source, "local");
        assert_eq!(disabled_skill_names(&conn).unwrap(), vec!["demo".to_string()]);

        // 再启用：同名覆盖，不新增行
        set_skill_enabled(&conn, "demo", "E:/skills/local/demo", "local", true).unwrap();
        let rows = load_skill_rows(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].enabled);
        assert!(disabled_skill_names(&conn).unwrap().is_empty());

        // 删除行后回到「无记录」状态，而不是留下一条 enabled=1 的残行
        remove_skill_row(&conn, "demo").unwrap();
        assert!(load_skill_rows(&conn).unwrap().is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn skill_sources_round_trip() {
        let dir = std::env::temp_dir().join(format!("aura-db-test-{}-sources", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("sources.db")).unwrap();

        // 官方源不入库，空表就是「只有官方源」
        assert!(load_skill_sources(&conn).unwrap().is_empty());

        add_skill_source(&conn, "https://raw.githubusercontent.com/team/skills/HEAD/", "skills")
            .unwrap();
        add_skill_source(&conn, "https://raw.githubusercontent.com/other/kit/HEAD/", "kit")
            .unwrap();
        let rows = load_skill_sources(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "kit", "按名字排序，界面顺序稳定");

        // 同 url 再添加：只改名，不新增行
        add_skill_source(&conn, "https://raw.githubusercontent.com/team/skills/HEAD/", "团队技能")
            .unwrap();
        let rows = load_skill_sources(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|r| r.name == "团队技能"));

        remove_skill_source(&conn, "https://raw.githubusercontent.com/other/kit/HEAD/").unwrap();
        assert_eq!(load_skill_sources(&conn).unwrap().len(), 1);

        std::fs::remove_dir_all(&dir).ok();
    }
}
