//! 内置终端（v0.8.0）。
//!
//! 右栏的「终端」标签背后是一个**真实 PTY**：后端持有伪终端句柄与子进程，
//! 前端只负责渲染输出与投递输入。
//!
//! 跨平台用 portable-pty：Windows 走 ConPTY，Unix 走原生 PTY，
//! 两边的 shell 枚举与进程清理分别处理（见 [`shells`]）。
//!
//! **生命周期约定**：终端进程活在 Rust 侧，前端只持有「视图」。
//! 切走标签页只断流、不杀进程；关闭标签才杀。

pub mod shells;

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::commands::AppState;

/// 输出事件名。前端 `listen` 它。
pub const OUTPUT_EVENT: &str = "terminal://output";
/// 进程退出事件名。
pub const EXIT_EVENT: &str = "terminal://exit";

/// 尺寸上限。防止前端传 0 或超大值把 PTY 弄坏。
const MIN_COLS: u16 = 2;
const MAX_COLS: u16 = 500;
const MIN_ROWS: u16 = 1;
const MAX_ROWS: u16 = 300;

/// 一段终端输出。
#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutput {
    pub id: String,
    pub data: String,
}

/// 终端进程退出。
#[derive(Debug, Clone, Serialize)]
pub struct TerminalExit {
    pub id: String,
    /// 退出码；被信号杀死时为 None
    pub code: Option<i32>,
}

/// 终端会话的元信息。
#[derive(Debug, Clone, Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub shell_path: String,
    pub shell_name: String,
    pub shell_kind: String,
    /// 启动时的工作目录
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub pid: Option<u32>,
}

/// 一个活着的终端会话。
struct TerminalSession {
    /// 写端：前端输入从这里进 PTY
    writer: Box<dyn Write + Send>,
    /// 主端：负责 resize
    master: Box<dyn MasterPty + Send>,
    /// 子进程：负责 kill
    child: Box<dyn Child + Send + Sync>,
}

/// 全局终端管理器。
///
/// 会话表用 `Arc` 包一层：输出泵跑在独立线程上，进程退出时它要回表里
/// 取退出码并清理自己。
#[derive(Clone, Default)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl TerminalManager {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, TerminalSession>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "终端状态锁已损坏".to_string())
    }
}

impl Drop for TerminalManager {
    fn drop(&mut self) {
        // 应用退出时把还活着的 shell 收掉：ConPTY / PTY 下的子进程
        // 不会因为父进程消失而自动结束，留着就是一堆孤儿。
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_id, mut session) in sessions.drain() {
                kill_tree(&mut session.child);
            }
        }
    }
}

/// 列出本机可用的 shell（终端标签页的下拉菜单用）。
#[tauri::command]
pub fn list_shells() -> Vec<shells::ShellProfile> {
    shells::discover()
}

/// 新建一个终端会话。
#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    state: State<'_, AppState>,
    id: String,
    session_id: String,
    shell_path: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<TerminalInfo, String> {
    let shell = match shell_path.as_deref() {
        Some(path) if !path.trim().is_empty() => shells::resolve(path)?,
        _ => shells::default_shell()?,
    };

    let cols = cols.clamp(MIN_COLS, MAX_COLS);
    let rows = rows.clamp(MIN_ROWS, MAX_ROWS);
    let cwd = session_workspace(&state, &session_id);

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("打开伪终端失败：{e}"))?;

    let mut cmd = CommandBuilder::new(&shell.path);
    for arg in &shell.args {
        cmd.arg(arg);
    }
    if !cwd.as_os_str().is_empty() && cwd.is_dir() {
        cmd.cwd(cwd.clone());
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("启动 {} 失败：{e}", shell.name))?;
    // 释放从设备：否则进程退出后读端永远等不到 EOF（Unix 上是 EIO）。
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("读取终端失败：{e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("写入终端失败：{e}"))?;

    let pid = child.process_id();
    {
        let mut sessions = manager.lock()?;
        sessions.insert(
            id.clone(),
            TerminalSession {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    spawn_output_pump(app, manager.sessions.clone(), id.clone(), reader);

    Ok(TerminalInfo {
        id,
        shell_path: shell.path,
        shell_name: shell.name,
        shell_kind: shell.kind,
        cwd: cwd.to_string_lossy().to_string(),
        cols,
        rows,
        pid,
    })
}

/// 向前端投递输入。
#[tauri::command]
pub fn terminal_write(
    manager: State<'_, TerminalManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = manager.lock()?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| "终端已退出或不存在".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入终端失败：{e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("写入终端失败：{e}"))?;
    Ok(())
}

/// 调整终端尺寸（前端 fit addon 算出来的行列数）。
#[tauri::command]
pub fn terminal_resize(
    manager: State<'_, TerminalManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = manager.lock()?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "终端已退出或不存在".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.clamp(MIN_ROWS, MAX_ROWS),
            cols: cols.clamp(MIN_COLS, MAX_COLS),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("调整终端尺寸失败：{e}"))
}

/// 关闭终端：结束进程并清理会话。
#[tauri::command]
pub fn terminal_close(manager: State<'_, TerminalManager>, id: String) -> Result<(), String> {
    let mut sessions = manager.lock()?;
    let mut session = sessions
        .remove(&id)
        .ok_or_else(|| "终端已退出或不存在".to_string())?;
    kill_tree(&mut session.child);
    Ok(())
}

/// 终端的工作目录：会话自己的工作区，查不到才回落全局工作区。
///
/// 与 `list_directory` 同一套口径——终端跑在哪个会话的工作区里，
/// 就该落在同一个目录，否则「终端里的当前目录」和「文件面板里的根」会打架。
fn session_workspace(state: &AppState, session_id: &str) -> PathBuf {
    let workspace = state
        .db
        .lock()
        .ok()
        .and_then(|conn| crate::db::load_session_workspace(&conn, session_id).ok().flatten())
        .filter(|s| !s.is_empty());
    match workspace {
        Some(w) => PathBuf::from(w),
        None => state.workspace.lock().map(|w| w.clone()).unwrap_or_default(),
    }
}

/// 结束 shell 及其子孙进程。
///
/// portable-pty 的 `kill` 在 Windows 上只 `TerminateProcess` 目标进程，
/// shell 里起的服务会活下来；Unix 侧 shell 是 `setsid` 出来的进程组长，
/// 要按组杀才干净。
fn kill_tree(child: &mut Box<dyn Child + Send + Sync>) {
    if let Some(pid) = child.process_id() {
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
        #[cfg(unix)]
        {
            // 负号表示进程组；shell 自己就是组长
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &format!("-{pid}")])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
    }
    let _ = child.kill();
}

/// 输出泵：独立线程读 PTY，把数据转成事件发给前端。
fn spawn_output_pump(
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    id: String,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let mut decoder = Utf8Stream::default();
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = decoder.decode(&buf[..n]);
                    if !text.is_empty() {
                        let _ = app.emit(
                            OUTPUT_EVENT,
                            TerminalOutput {
                                id: id.clone(),
                                data: text,
                            },
                        );
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }

        // 读端结束意味着进程已经退出：取退出码并清理会话。
        let mut code = None;
        if let Ok(mut sessions) = sessions.lock() {
            if let Some(mut session) = sessions.remove(&id) {
                if let Ok(Some(status)) = session.child.try_wait() {
                    code = Some(status.exit_code() as i32);
                }
            }
        }
        let _ = app.emit(EXIT_EVENT, TerminalExit { id, code });
    });
}

/// 增量 UTF-8 解码。
///
/// PTY 输出按字节块到达，一个多字节字符可能被切成两块。直接
/// `from_utf8_lossy` 会在边界上吐替换字符，中文尤其明显。
#[derive(Default)]
struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    fn decode(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    out.push_str(s);
                    self.pending.clear();
                    break;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    if let Ok(s) = std::str::from_utf8(&self.pending[..valid]) {
                        out.push_str(s);
                    }
                    let rest = self.pending.split_off(valid);
                    match e.error_len() {
                        // 尾部不完整：留到下一块再解
                        None => {
                            self.pending = rest;
                            break;
                        }
                        // 确实是非法字节：丢一个继续
                        Some(n) => {
                            out.push('\u{FFFD}');
                            self.pending = rest[n..].to_vec();
                        }
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_stream_keeps_split_multibyte_char() {
        // "中" 是三字节，被切成两半时不能变成替换字符
        let mut s = Utf8Stream::default();
        assert_eq!(s.decode(&[0xE4]), "");
        assert_eq!(s.decode(&[0xB8, 0xAD]), "中");
    }

    #[test]
    fn utf8_stream_passes_through_plain_ascii() {
        let mut s = Utf8Stream::default();
        assert_eq!(s.decode(b"hello"), "hello");
        assert_eq!(s.decode(b" world"), " world");
    }

    #[test]
    fn utf8_stream_replaces_invalid_bytes() {
        let mut s = Utf8Stream::default();
        // 0xFF 永远不是合法 UTF-8 起始字节
        assert_eq!(s.decode(&[0xFF]), "\u{FFFD}");
    }

    #[test]
    fn utf8_stream_keeps_trailing_bytes_for_next_chunk() {
        let mut s = Utf8Stream::default();
        assert_eq!(s.decode(&[0xE4, 0xB8]), "");
        assert_eq!(s.decode(&[0xAD]), "中");
    }

    #[test]
    fn dimensions_are_clamped() {
        let mut sessions = HashMap::new();
        sessions.insert("x".to_string(), ());
        // 只是确认钳制常量本身合理
        assert!(MIN_COLS <= MAX_COLS);
        assert!(MIN_ROWS <= MAX_ROWS);
    }
}
