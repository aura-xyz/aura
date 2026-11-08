/**
 * 系统集成：运行时防止系统休眠、开机自动启动（v0.8.0）。
 *
 * 刻意不引 tauri-plugin-autostart / windows-sys：两个能力都用平台自带
 * 原语就能完成，零新增依赖，Linux 也能编译。
 *
 * - 防休眠：Windows 的 SetThreadExecutionState（ES_CONTINUOUS |
 *   ES_SYSTEM_REQUIRED）。它**与调用线程绑定**，所以启用与关闭必须发生在
 *   同一个常驻线程里；这里用一个专用线程 + channel 承载状态。
 * - 开机自启：Windows 写 HKCU Run（当前用户，无需 UAC）；
 *   Linux 写 XDG 的 ~/.config/autostart/aura.desktop。
 */

use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;

pub const SETTING_PREVENT_SLEEP: &str = "prevent_sleep";

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "Aura";
const DESKTOP_FILE: &str = "aura.desktop";

/* ---------------------------------------------------------------
   防休眠
   --------------------------------------------------------------- */

#[cfg(windows)]
mod keep_awake_win {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

    /// 返回是否成功；失败（返回 0）时状态不该被记成已生效。
    pub fn apply(enabled: bool) -> bool {
        let flags = if enabled {
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        } else {
            ES_CONTINUOUS
        };
        // SAFETY: 无指针参数，只改当前线程的执行状态。
        unsafe { SetThreadExecutionState(flags) != 0 }
    }
}

#[cfg(not(windows))]
mod keep_awake_win {
    pub fn apply(_enabled: bool) -> bool {
        false
    }
}

/// 当前平台是否支持防休眠。Linux 没有等价的进程级电源抑制原语，
/// 设置页据此把开关置灰，而不是让用户以为打开就能生效。
pub fn keep_awake_supported() -> bool {
    cfg!(windows)
}

static KEEP_AWAKE_TX: OnceLock<Sender<bool>> = OnceLock::new();

fn keep_awake_tx() -> &'static Sender<bool> {
    KEEP_AWAKE_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<bool>();
        let _ = std::thread::Builder::new()
            .name("aura-keep-awake".into())
            .spawn(move || {
                let mut current = false;
                for next in rx {
                    if next == current {
                        continue;
                    }
                    if keep_awake_win::apply(next) {
                        current = next;
                    }
                }
                // 通道关闭（进程退出）时恢复默认电源策略
                if current {
                    keep_awake_win::apply(false);
                }
            });
        tx
    })
}

/// 启用 / 关闭防休眠。返回是否成功派发到常驻线程。
pub fn set_keep_awake(enabled: bool) -> bool {
    if !keep_awake_supported() {
        return false;
    }
    keep_awake_tx().send(enabled).is_ok()
}

/* ---------------------------------------------------------------
   开机自启
   --------------------------------------------------------------- */

fn current_exe() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("无法定位可执行文件：{e}"))
}

/// Windows `reg` 参数。抽成纯函数便于单测钉住「写 HKCU、带引号包路径、
/// 关闭时删除值」这几条契约，命令实际执行仍在平台分支里。
pub fn windows_reg_args(enabled: bool, exe: &str) -> Vec<String> {
    if enabled {
        vec![
            "add".into(),
            RUN_KEY.into(),
            "/v".into(),
            RUN_VALUE.into(),
            "/t".into(),
            "REG_SZ".into(),
            "/d".into(),
            format!("\"{exe}\""),
            "/f".into(),
        ]
    } else {
        vec![
            "delete".into(),
            RUN_KEY.into(),
            "/v".into(),
            RUN_VALUE.into(),
            "/f".into(),
        ]
    }
}

/// XDG autostart 的 .desktop 内容。抽成纯函数便于单测。
pub fn desktop_entry(exe: &str) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName=Aura\nExec=\"{exe}\"\nX-GNOME-Autostart-enabled=true\n"
    )
}

#[cfg(windows)]
fn run_reg(args: &[String]) -> Result<std::process::Output, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("reg")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("执行 reg 失败：{e}"))
}

#[cfg(windows)]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let exe = if enabled { current_exe()? } else { String::new() };
    let args = windows_reg_args(enabled, &exe);
    let out = run_reg(&args)?;
    if out.status.success() {
        return Ok(());
    }
    // 删除一个本来就不存在的值是幂等成功，不该让开关报错
    if !enabled {
        return Ok(());
    }
    Err(format!(
        "设置开机自启失败：{}",
        String::from_utf8_lossy(&out.stderr).trim()
    ))
}

#[cfg(windows)]
pub fn autostart_enabled() -> bool {
    // 复用 run_reg：隐藏控制台窗口，否则每次打开设置页都会闪一下黑框
    let args: Vec<String> = ["query", RUN_KEY, "/v", RUN_VALUE]
        .iter()
        .map(|s| (*s).to_string())
        .collect();
    run_reg(&args)
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn autostart_path() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config"))
        })?;
    Some(base.join("autostart").join(DESKTOP_FILE))
}

#[cfg(not(windows))]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let path = autostart_path().ok_or_else(|| "无法确定 XDG 配置目录".to_string())?;
    if enabled {
        std::fs::create_dir_all(
            path.parent()
                .ok_or_else(|| "无效的 autostart 路径".to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::write(&path, desktop_entry(&current_exe()?)).map_err(|e| e.to_string())?;
    } else {
        // 文件不存在就是已经关着，幂等
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn autostart_enabled() -> bool {
    autostart_path().map(|p| p.exists()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reg_args_write_hkcu_with_quoted_exe() {
        let args = windows_reg_args(true, r"C:\Program Files\Aura\aura.exe");
        assert_eq!(args[0], "add");
        assert!(args.contains(&RUN_KEY.to_string()), "只写当前用户，无需 UAC");
        assert!(
            args.contains(&"\"C:\\Program Files\\Aura\\aura.exe\"".to_string()),
            "带空格的路径必须被引号包住"
        );
        assert!(args.contains(&"/f".to_string()));
    }

    #[test]
    fn reg_args_delete_value_when_disabled() {
        let args = windows_reg_args(false, "");
        assert_eq!(args[0], "delete");
        assert!(args.contains(&RUN_VALUE.to_string()));
        assert!(!args.contains(&"/d".to_string()));
    }

    #[test]
    fn desktop_entry_has_exec_and_autostart_flag() {
        let text = desktop_entry("/opt/aura/aura");
        assert!(text.contains("[Desktop Entry]"));
        assert!(text.contains("Exec=\"/opt/aura/aura\""));
        assert!(text.contains("X-GNOME-Autostart-enabled=true"));
    }
}
