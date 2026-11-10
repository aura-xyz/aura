//! 检测本机可用于「在…中打开」的应用（v0.8.0）。
//!
//! Windows 上编辑器装在哪儿没有统一约定：VS Code 可能在任意盘的
//! `Microsoft VS Code`，JetBrains 可能在 `Program Files\JetBrains`、
//! Toolbox 的 `ch-0/<build>/bin`，或用户目录。这里只做**只读探测**，
//! 不读注册表、不加 winreg 依赖，用候选根 + 有限深度的 bin 目录枚举。
//!
//! 打开目标由命令层从会话工作区取（见 `commands::open_in_app`），
//! 本模块不接受用户传来的任意路径。

use serde::Serialize;
use std::path::{Path, PathBuf};

/// 暴露给前端的最小信息：路径不传给渲染层。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct OpenAppView {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OpenApp {
    id: String,
    name: String,
    exe: PathBuf,
}

/// JetBrains 产品：id / 显示名 / 可执行文件候选名 / 目录名关键词 / Toolbox 启动脚本名。
#[cfg(windows)]
const JETBRAINS: &[(&str, &str, &[&str], &[&str], &[&str])] = &[
    ("idea", "IntelliJ IDEA", &["idea64.exe", "idea.exe"], &["idea", "intellij"], &["idea"]),
    ("pycharm", "PyCharm", &["pycharm64.exe", "pycharm.exe"], &["pycharm"], &["pycharm"]),
    ("webstorm", "WebStorm", &["webstorm64.exe", "webstorm.exe"], &["webstorm"], &["webstorm"]),
    ("rider", "Rider", &["rider64.exe", "rider.exe"], &["rider"], &["Rider", "rider"]),
    ("clion", "CLion", &["clion64.exe", "clion.exe"], &["clion"], &["clion"]),
    ("goland", "GoLand", &["goland64.exe", "goland.exe"], &["goland"], &["goland"]),
    ("phpstorm", "PhpStorm", &["phpstorm64.exe", "phpstorm.exe"], &["phpstorm"], &["phpstorm"]),
    ("datagrip", "DataGrip", &["datagrip64.exe", "datagrip.exe"], &["datagrip"], &["datagrip"]),
    ("androidstudio", "Android Studio", &["studio64.exe", "studio.exe"], &["android studio", "androidstudio"], &["studio"]),
];

/// 目录名是否命中产品关键词（大小写不敏感）。
#[cfg(windows)]
fn matches_product(dir: &str, keywords: &[&str]) -> bool {
    let lower = dir.to_lowercase();
    keywords.iter().any(|k| lower.contains(k))
}

/// 收集 root 下有限深度内名为 `bin` 的目录，并只保留产品关键词命中的祖先链。
#[cfg(windows)]
fn collect_bin_dirs(root: &Path, keywords: &[&str], depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 || !root.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten().take(256) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.eq_ignore_ascii_case("bin") {
            // 能走到这里说明祖先链已经按产品关键词 / Toolbox 结构筛过；
            // 是否真的属于该产品由 find_exe 里的可执行文件名兜底。
            out.push(path.clone());
            continue;
        }
        // 只在「看起来像这个产品」或 JetBrains/Toolbox 的结构目录里继续下钻，
        // 避免把整个 Program Files 递归一遍。Toolbox 的 ch-0/<build>/bin
        // 有 5 层，深度必须留够（调用方传 6）。
        let lower = name.to_lowercase();
        let descend = matches_product(&name, keywords)
            || lower.contains("jetbrains")
            || lower.contains("toolbox")
            || lower == "apps"
            || lower.starts_with("ch-")
            || lower.chars().all(|c| c.is_ascii_digit() || c == '.');
        if descend {
            collect_bin_dirs(&path, keywords, depth - 1, out);
        }
    }
}

/// 在一组 bin 目录里找第一个存在的可执行文件。
#[cfg(windows)]
fn find_exe(bin_dirs: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    for dir in bin_dirs {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Windows 候选根：按用户目录 / 程序目录 / PATH 拼出来，供检测与单测注入。
#[cfg(windows)]
pub fn candidate_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if !local.is_empty() {
        roots.push(PathBuf::from(&local).join("Programs"));
        roots.push(PathBuf::from(&local).join("JetBrains").join("Toolbox").join("apps"));
        // Toolbox 把启动脚本放在 scripts/ 下（idea.cmd、Rider.cmd…），
        // 实测本机五个 IDE 全靠它们才能被识别。
        roots.push(PathBuf::from(&local).join("JetBrains").join("Toolbox").join("scripts"));
    }
    for key in ["ProgramFiles", "ProgramW6432"] {
        let value = std::env::var(key).unwrap_or_default();
        if value.is_empty() {
            continue;
        }
        roots.push(PathBuf::from(&value).join("JetBrains"));
        roots.push(PathBuf::from(&value));
    }
    // Toolbox 常把 IDE 直接装在别的盘根目录（D:\CLion、D:\PyCharm…）。
    // 只枚举存在的盘符根目录，下钻仍由产品关键词收窄，不会遍历整块盘。
    for letter in b'A'..=b'Z' {
        let root = PathBuf::from(format!("{}:\\", letter as char));
        if root.is_dir() {
            roots.push(root);
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for part in std::env::split_paths(&path) {
            if part.to_string_lossy().to_lowercase().contains("vs code") {
                roots.push(part.parent().map(|p| p.to_path_buf()).unwrap_or(part));
            }
        }
    }
    roots
}

/// Toolbox 启动脚本（.cmd/.bat/.exe）；Windows 下 .cmd 需要交给 cmd /C。
#[cfg(windows)]
fn find_toolbox_script(roots: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    for root in roots {
        for name in names {
            for ext in ["cmd", "bat", "exe"] {
                let candidate = root.join(format!("{name}.{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// VS Code：优先 `Code.exe`（直接 spawn，不经 cmd），PATH 里的 `bin/code` 也可推断安装根。
#[cfg(windows)]
fn find_vscode(roots: &[PathBuf]) -> Option<PathBuf> {
    for root in roots {
        for rel in ["Microsoft VS Code/Code.exe", "Code.exe", "bin/code.cmd"] {
            let candidate = root.join(rel);
            if candidate.is_file() {
                // Code.exe 最好；code.cmd 需要 cmd /C，仍可用但排在后面
                if rel == "bin/code.cmd" {
                    let exe = root.join("Code.exe");
                    if exe.is_file() {
                        return Some(exe);
                    }
                }
                return Some(candidate);
            }
        }
    }
    None
}

/// Windows 下用给定根做检测（单测注入假目录，不碰真实磁盘布局）。
#[cfg(windows)]
fn detect_in(roots: &[PathBuf]) -> Vec<OpenApp> {
    let mut apps = Vec::new();
    if let Some(exe) = find_vscode(roots) {
        apps.push(OpenApp { id: "vscode".into(), name: "VS Code".into(), exe });
    }
    for (id, name, exe_names, keywords, scripts) in JETBRAINS {
        let mut bins = Vec::new();
        for root in roots {
            collect_bin_dirs(root, keywords, 6, &mut bins);
        }
        // 先找真实 IDE 可执行文件，再退回 Toolbox 启动脚本
        if let Some(exe) = find_exe(&bins, exe_names).or_else(|| find_toolbox_script(roots, scripts)) {
            apps.push(OpenApp { id: (*id).into(), name: (*name).into(), exe });
        }
    }
    apps
}

/// Linux 候选根：.desktop 文件目录、常见安装目录、PATH。
#[cfg(target_os = "linux")]
pub fn candidate_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        roots.push(home.join(".local").join("share").join("applications"));
        roots.push(
            home.join(".local")
                .join("share")
                .join("Flatpak")
                .join("exports")
                .join("share")
                .join("applications"),
        );
    }
    roots.push(PathBuf::from("/usr/share/applications"));
    roots.push(PathBuf::from("/usr/local/share/applications"));
    roots.push(PathBuf::from("/opt"));
    if let Some(path) = std::env::var_os("PATH") {
        for part in std::env::split_paths(&path) {
            roots.push(part);
        }
    }
    roots
}

/// 在一组根目录里找第一个名为 `name` 的可执行文件（Linux 用）。
#[cfg(target_os = "linux")]
fn find_exe_in_roots(roots: &[PathBuf], name: &str) -> Option<PathBuf> {
    for root in roots {
        let candidate = root.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Linux 常见编辑器：(可执行文件名, 前端 id, 显示名)。
///
/// id 必须与 Windows 侧保持一致（如 `code` → `vscode`）——前端图标表按 id 取图，
/// 之前在 Linux 上 id 直接用可执行文件名 `code`，图标表查不到，退成了资源管理器图标。
#[cfg(target_os = "linux")]
const LINUX_EDITORS: &[(&str, &str, &str)] = &[
    ("code", "vscode", "VS Code"),
    ("code-oss", "vscode-oss", "VS Code (OSS)"),
    ("subl", "sublime", "Sublime Text"),
    ("atom", "atom", "Atom"),
    ("gedit", "gedit", "gedit"),
    ("kate", "kate", "Kate"),
    ("mousepad", "mousepad", "Mousepad"),
];

/// Linux 下用给定根做检测：探测常见桌面编辑器可执行文件。
#[cfg(target_os = "linux")]
fn detect_in(roots: &[PathBuf]) -> Vec<OpenApp> {
    let mut apps = Vec::new();
    for &(exe, id, name) in LINUX_EDITORS {
        if let Some(path) = find_exe_in_roots(roots, exe) {
            apps.push(OpenApp {
                id: id.to_string(),
                name: name.to_string(),
                exe: path,
            });
        }
    }
    apps
}

/// Windows 前端拿到的列表：资源管理器永远在，且是默认项。
#[cfg(windows)]
pub fn installed_apps() -> Vec<OpenAppView> {
    let mut out = vec![OpenAppView {
        id: "explorer".into(),
        name: "文件资源管理器".into(),
    }];
    for app in detect_in(&candidate_roots()) {
        out.push(OpenAppView { id: app.id, name: app.name });
    }
    out
}

/// Linux 前端拿到的列表：文件管理器（xdg-open）永远在，且是默认项；
/// 其余按常见编辑器可执行文件探测。
#[cfg(target_os = "linux")]
pub fn installed_apps() -> Vec<OpenAppView> {
    let mut out = vec![OpenAppView {
        id: "xdg-open".into(),
        name: "文件管理器".into(),
    }];
    for app in detect_in(&candidate_roots()) {
        out.push(OpenAppView { id: app.id, name: app.name });
    }
    out
}

/// Windows 打开工作区。只接受 `installed_apps()` 里出现过的 id，杜绝任意程序启动。
#[cfg(windows)]
pub fn open_in(app_id: &str, target: &Path) -> Result<(), String> {
    if !target.is_dir() {
        return Err("工作区目录不存在".into());
    }
    let program: PathBuf = if app_id == "explorer" {
        PathBuf::from("explorer")
    } else {
        detect_in(&candidate_roots())
            .into_iter()
            .find(|a| a.id == app_id)
            .map(|a| a.exe)
            .ok_or_else(|| "未安装该应用".to_string())?
    };
    // 不再手工拼 `cmd /C start "" …`：Rust 的 Command 在 Windows 上对
    // .cmd/.bat 会自动改走 cmd.exe 并正确转义参数，而自己拼的空标题
    // `""` 会被 Rust 转义成 `\"\"`，反而让 start 把它当成要启动的程序。
    std::process::Command::new(&program)
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("启动失败：{e}"))
}

/// Linux 打开工作区。xdg-open 交给桌面环境打开目录；编辑器直接 spawn。
#[cfg(target_os = "linux")]
pub fn open_in(app_id: &str, target: &Path) -> Result<(), String> {
    if !target.is_dir() {
        return Err("工作区目录不存在".into());
    }
    let program = if app_id == "xdg-open" {
        PathBuf::from("xdg-open")
    } else {
        detect_in(&candidate_roots())
            .into_iter()
            .find(|a| a.id == app_id)
            .map(|a| a.exe)
            .ok_or_else(|| "未安装该应用".to_string())?
    };
    std::process::Command::new(&program)
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("启动失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("aura-open-apps-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("建临时目录");
        root
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Windows 测试
    // ═══════════════════════════════════════════════════════════════════════════

    #[cfg(windows)]
    #[test]
    fn explorer_is_always_available_and_first() {
        let apps = installed_apps();
        assert_eq!(apps[0].id, "explorer");
        assert_eq!(apps[0].name, "文件资源管理器");
    }

    #[cfg(windows)]
    #[test]
    fn detects_vscode_and_jetbrains_from_injected_roots() {
        let root = temp_root("detect");
        let vscode = root.join("Microsoft VS Code");
        fs::create_dir_all(&vscode).unwrap();
        fs::write(vscode.join("Code.exe"), b"").unwrap();
        let rider = root.join("JetBrains").join("Rider 2026.1").join("bin");
        fs::create_dir_all(&rider).unwrap();
        fs::write(rider.join("rider64.exe"), b"").unwrap();

        let apps = detect_in(&[root.clone()]);
        let ids: Vec<&str> = apps.iter().map(|a| a.id.as_str()).collect();
        assert!(ids.contains(&"vscode"), "应识别 VS Code：{ids:?}");
        assert!(ids.contains(&"rider"), "应识别 Rider：{ids:?}");
        assert!(!ids.contains(&"pycharm"), "未安装的产品不能出现：{ids:?}");

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn toolbox_layout_is_found_too() {
        let root = temp_root("toolbox");
        let bin = root
            .join("apps")
            .join("PyCharm")
            .join("ch-0")
            .join("261.1")
            .join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("pycharm64.exe"), b"").unwrap();
        let apps = detect_in(&[root.clone()]);
        assert!(apps.iter().any(|a| a.id == "pycharm"));
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn open_rejects_missing_workspace_without_spawning() {
        let missing = std::env::temp_dir().join("aura-open-apps-no-such-dir");
        let err = open_in("explorer", &missing).expect_err("目录不存在必须拒绝");
        assert!(err.contains("不存在"), "err={err}");
    }

    /// 本机实测：五个 IDE 都由 Toolbox scripts 暴露，Program Files 里只有缓存目录。
    #[cfg(windows)]
    #[test]
    fn toolbox_scripts_are_detected() {
        let root = temp_root("scripts");
        for name in ["idea", "pycharm", "webstorm", "clion", "Rider"] {
            fs::write(root.join(format!("{name}.cmd")), b"").unwrap();
        }
        let apps = detect_in(&[root.clone()]);
        let ids: Vec<&str> = apps.iter().map(|a| a.id.as_str()).collect();
        for id in ["idea", "pycharm", "webstorm", "clion", "rider"] {
            assert!(ids.contains(&id), "Toolbox 应识别 {id}：{ids:?}");
        }
        let _ = fs::remove_dir_all(&root);
    }

    /// IDE 直接装在 D:\CLion 这类盘根目录时也要找到。
    #[cfg(windows)]
    #[test]
    fn drive_root_layout_is_detected() {
        let root = temp_root("drive");
        let bin = root.join("WebStorm").join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("webstorm64.exe"), b"").unwrap();
        assert!(detect_in(&[root.clone()]).iter().any(|a| a.id == "webstorm"));
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn unknown_app_id_is_rejected() {
        let root = temp_root("unknown");
        let err = open_in("not-a-real-app", &root).expect_err("未知 id 必须拒绝");
        assert!(err.contains("未安装"), "err={err}");
        let _ = fs::remove_dir_all(&root);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Linux 测试
    // ═══════════════════════════════════════════════════════════════════════════

    #[cfg(target_os = "linux")]
    #[test]
    fn xdg_open_is_always_available_and_first() {
        let apps = installed_apps();
        assert_eq!(apps[0].id, "xdg-open");
        assert_eq!(apps[0].name, "文件管理器");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn detects_common_editors_from_injected_roots() {
        let root = temp_root("detect");
        let bin = root.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("code"), b"").unwrap();
        let _ = std::os::unix::fs::Permissions::set_mode(&bin.join("code"), 0o755);

        let apps = detect_in(&[root.clone()]);
        let ids: Vec<&str> = apps.iter().map(|a| a.id.as_str()).collect();
        // id 统一为 vscode（与 Windows 对齐），前端图标表才取得到 VS Code 图标。
        assert!(ids.contains(&"vscode"), "应识别 VS Code：{ids:?}");
        assert!(!ids.contains(&"sublime"), "未安装的产品不能出现：{ids:?}");

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn open_in_uses_xdg_open() {
        let dir = temp_root("target");
        fs::create_dir_all(&dir).unwrap();
        // xdg-open 在 CI 头less 环境下可能不存在，只断言命令被构造并尝试启动；
        // 失败原因应是「命令未找到」而非「目录不存在」或「未安装应用」。
        let err = open_in("xdg-open", &dir).unwrap_err();
        assert!(
            err.contains("启动失败"),
            "xdg-open 应尝试启动，err={err}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn open_rejects_missing_workspace_without_spawning() {
        let missing = std::env::temp_dir().join("aura-open-apps-no-such-dir");
        let err = open_in("xdg-open", &missing).expect_err("目录不存在必须拒绝");
        assert!(err.contains("不存在"), "err={err}");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn unknown_app_id_is_rejected() {
        let root = temp_root("unknown");
        let err = open_in("not-a-real-app", &root).expect_err("未知 id 必须拒绝");
        assert!(err.contains("未安装"), "err={err}");
        let _ = fs::remove_dir_all(&root);
    }
}
