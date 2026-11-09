//! 可用 shell 的枚举（v0.8.0）。
//!
//! 终端标签页的下拉菜单要列出「这台机器上真的能启动的 shell」，
//! 所以候选清单按平台给，路径靠 PATH 查找并**验证文件存在**，
//! 启动参数按 shell 种类定：
//!
//! | shell | 参数 | 原因 |
//! |---|---|---|
//! | `cmd` | 无 | cmd 不接受 `-i`，给了会当成命令参数 |
//! | `powershell` / `pwsh` | `-NoLogo` | 不要 profile 横幅占掉第一屏 |
//! | 其它（sh/bash/zsh/fish） | `-i` | 交互模式，否则没有提示符 |

use std::path::Path;

use serde::Serialize;

/// 一个已确认存在的 shell。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ShellProfile {
    /// 可执行文件的完整路径
    pub path: String,
    /// 展示名（文件名，不含目录）
    pub name: String,
    /// shell 种类：cmd / powershell / pwsh / sh / bash / zsh / fish
    pub kind: String,
    /// 启动参数
    pub args: Vec<String>,
}

/// 候选 shell（按平台）。
#[cfg(windows)]
const CANDIDATES: &[&str] = &["cmd.exe", "powershell.exe", "pwsh.exe"];
#[cfg(not(windows))]
const CANDIDATES: &[&str] = &["sh", "bash", "zsh", "fish"];

/// 默认 shell：Windows 取 `COMSPEC`，Unix 取 `SHELL`，都没有再退回 PATH 查找。
pub fn default_shell() -> Result<ShellProfile, String> {
    #[cfg(windows)]
    {
        if let Some(comspec) = std::env::var_os("COMSPEC") {
            let path = comspec.to_string_lossy().to_string();
            if Path::new(&path).is_file() {
                return Ok(profile_of(&path));
            }
        }
        if let Some(found) = find_in_path("cmd.exe") {
            return Ok(profile_of(&found.to_string_lossy()));
        }
        Err("找不到可用的 shell：COMSPEC 未设置，PATH 里也没有 cmd.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        if let Some(shell) = std::env::var_os("SHELL") {
            let path = shell.to_string_lossy().to_string();
            if Path::new(&path).is_file() {
                return Ok(profile_of(&path));
            }
        }
        for candidate in ["bash", "sh"] {
            if let Some(found) = find_in_path(candidate) {
                return Ok(profile_of(&found.to_string_lossy()));
            }
        }
        Err("找不到可用的 shell：SHELL 未设置，PATH 里也没有 sh".to_string())
    }
}

/// 列出全部可用 shell：默认 shell 在前，其余按候选清单顺序，按种类去重。
pub fn discover() -> Vec<ShellProfile> {
    let mut out: Vec<ShellProfile> = Vec::new();
    let mut push = |p: ShellProfile| {
        if out.iter().any(|e| e.kind == p.kind) {
            return;
        }
        out.push(p);
    };
    if let Ok(default) = default_shell() {
        push(default);
    }
    for candidate in CANDIDATES {
        if let Some(found) = find_in_path(candidate) {
            push(profile_of(&found.to_string_lossy()));
        }
    }
    out
}

/// 把前端回传的 shell 路径解析成 profile。路径必须真实存在。
pub fn resolve(path: &str) -> Result<ShellProfile, String> {
    if path.trim().is_empty() {
        return Err("shell 路径为空".to_string());
    }
    if !Path::new(path).is_file() {
        return Err(format!("shell 不存在：{path}"));
    }
    Ok(profile_of(path))
}

/// 在 PATH 里找可执行文件。Windows 上还要展开 PATHEXT，
/// 否则找不到没写扩展名的 `cmd.exe`。
fn find_in_path(name: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    let dirs: Vec<std::path::PathBuf> = std::env::split_paths(&path).collect();

    #[cfg(windows)]
    let extensions: Vec<String> = if name.contains('.') {
        vec![String::new()]
    } else {
        let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        let mut list: Vec<String> = pathext
            .split(';')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .collect();
        list.push(String::new());
        list
    };
    #[cfg(not(windows))]
    let extensions: Vec<String> = vec![String::new()];

    for dir in dirs {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for ext in &extensions {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// 按文件名推出 shell 种类与启动参数。
fn profile_of(path: &str) -> ShellProfile {
    let name = path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_string();
    let kind = name
        .to_ascii_lowercase()
        .trim_end_matches(".exe")
        .to_string();
    let args = match kind.as_str() {
        "cmd" => vec![],
        "powershell" | "pwsh" => vec!["-NoLogo".to_string()],
        _ => vec!["-i".to_string()],
    };
    ShellProfile {
        path: path.to_string(),
        name,
        kind,
        args,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cmd_gets_no_interactive_flag() {
        // cmd 收到 -i 会把它当成命令，交互提示符就没了
        let p = profile_of("C:\\Windows\\System32\\cmd.exe");
        assert_eq!(p.kind, "cmd");
        assert_eq!(p.name, "cmd.exe");
        assert!(p.args.is_empty());
    }

    #[test]
    fn powershell_skips_profile_banner() {
        let p = profile_of("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
        assert_eq!(p.kind, "pwsh");
        assert_eq!(p.name, "pwsh.exe");
        assert_eq!(p.args, vec!["-NoLogo".to_string()]);
    }

    #[test]
    fn posix_shells_run_interactive() {
        let p = profile_of("/bin/bash");
        assert_eq!(p.kind, "bash");
        assert_eq!(p.name, "bash");
        assert_eq!(p.args, vec!["-i".to_string()]);
    }

    #[test]
    fn discover_never_returns_duplicates() {
        let list = discover();
        let mut kinds: Vec<&str> = list.iter().map(|s| s.kind.as_str()).collect();
        let count = kinds.len();
        kinds.sort_unstable();
        kinds.dedup();
        assert_eq!(kinds.len(), count, "同一个 kind 不应出现两次：{list:?}");
    }

    #[test]
    fn discover_entries_all_exist_on_disk() {
        for shell in discover() {
            assert!(
                Path::new(&shell.path).is_file(),
                "枚举出的 shell 必须真实存在：{}",
                shell.path
            );
        }
    }

    #[test]
    fn resolve_rejects_missing_path() {
        let err = resolve("C:/definitely/not/a/shell.exe").unwrap_err();
        assert!(err.contains("不存在"), "错误信息要说明原因：{err}");
    }

    #[test]
    fn default_shell_is_usable() {
        let shell = default_shell().expect("默认 shell 应当能解析");
        assert!(Path::new(&shell.path).is_file());
        assert!(!shell.kind.is_empty());
    }
}
