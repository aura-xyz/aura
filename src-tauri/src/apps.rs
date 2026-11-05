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

/// JetBrains 产品：id / 显示名 / 可执行文件候选名 / 目录名关键词。
const JETBRAINS: &[(&str, &str, &[&str], &[&str])] = &[
    ("idea", "IntelliJ IDEA", &["idea64.exe", "idea.exe"], &["idea", "intellij"]),
    ("pycharm", "PyCharm", &["pycharm64.exe", "pycharm.exe"], &["pycharm"]),
    ("webstorm", "WebStorm", &["webstorm64.exe", "webstorm.exe"], &["webstorm"]),
    ("rider", "Rider", &["rider64.exe", "rider.exe"], &["rider"]),
    ("clion", "CLion", &["clion64.exe", "clion.exe"], &["clion"]),
    ("goland", "GoLand", &["goland64.exe", "goland.exe"], &["goland"]),
    ("phpstorm", "PhpStorm", &["phpstorm64.exe", "phpstorm.exe"], &["phpstorm"]),
    ("datagrip", "DataGrip", &["datagrip64.exe", "datagrip.exe"], &["datagrip"]),
    ("androidstudio", "Android Studio", &["studio64.exe", "studio.exe"], &["android studio", "androidstudio"]),
];

/// 目录名是否命中产品关键词（大小写不敏感）。
fn matches_product(dir: &str, keywords: &[&str]) -> bool {
    let lower = dir.to_lowercase();
    keywords.iter().any(|k| lower.contains(k))
}

/// 收集 root 下有限深度内名为 `bin` 的目录，并只保留产品关键词命中的祖先链。
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

/// 候选根：按用户目录 / 程序目录 / PATH 拼出来，供检测与单测注入。
pub fn candidate_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if !local.is_empty() {
        roots.push(PathBuf::from(&local).join("Programs"));
        roots.push(PathBuf::from(&local).join("JetBrains").join("Toolbox").join("apps"));
    }
    for key in ["ProgramFiles", "ProgramW6432"] {
        let value = std::env::var(key).unwrap_or_default();
        if value.is_empty() {
            continue;
        }
        roots.push(PathBuf::from(&value).join("JetBrains"));
        roots.push(PathBuf::from(&value));
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

/// VS Code：优先 `Code.exe`（直接 spawn，不经 cmd），PATH 里的 `bin/code` 也可推断安装根。
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

/// 用给定根做检测（单测注入假目录，不碰真实磁盘布局）。
fn detect_in(roots: &[PathBuf]) -> Vec<OpenApp> {
    let mut apps = Vec::new();
    if let Some(exe) = find_vscode(roots) {
        apps.push(OpenApp { id: "vscode".into(), name: "VS Code".into(), exe });
    }
    for (id, name, exe_names, keywords) in JETBRAINS {
        let mut bins = Vec::new();
        for root in roots {
            collect_bin_dirs(root, keywords, 6, &mut bins);
        }
        if let Some(exe) = find_exe(&bins, exe_names) {
            apps.push(OpenApp { id: (*id).into(), name: (*name).into(), exe });
        }
    }
    apps
}

/// 前端拿到的列表：资源管理器永远在，且是默认项。
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

/// 打开工作区。只接受 `installed_apps()` 里出现过的 id，杜绝任意程序启动。
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
    let is_cmd = program
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("cmd"))
        .unwrap_or(false);
    let mut command = if is_cmd {
        // code.cmd 是批处理，Windows 下必须交给 cmd；单行命令不受
        // 「cmd /C 只执行第一行」那条坑影响。
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", "\"\""]);
        c.arg(&program);
        c
    } else {
        std::process::Command::new(&program)
    };
    command
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

    #[test]
    fn explorer_is_always_available_and_first() {
        let apps = installed_apps();
        assert_eq!(apps[0].id, "explorer");
        assert_eq!(apps[0].name, "文件资源管理器");
    }

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

    #[test]
    fn open_rejects_missing_workspace_without_spawning() {
        let missing = std::env::temp_dir().join("aura-open-apps-no-such-dir");
        let err = open_in("explorer", &missing).expect_err("目录不存在必须拒绝");
        assert!(err.contains("不存在"), "err={err}");
    }

    #[test]
    fn unknown_app_id_is_rejected() {
        let root = temp_root("unknown");
        let err = open_in("not-a-real-app", &root).expect_err("未知 id 必须拒绝");
        assert!(err.contains("未安装"), "err={err}");
        let _ = fs::remove_dir_all(&root);
    }
}
