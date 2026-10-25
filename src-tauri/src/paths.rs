//! 路径白名单的判定规则（v0.6.2）
//!
//! 用户可以授权额外目录给模型访问。这些目录一旦授权，模型就能读写其中
//! 全部文件——所以**添加时的判定**就是安全边界本身。
//!
//! 三档判定：
//!
//! | 档位 | 含义 | 行为 |
//! |---|---|---|
//! | [`Verdict::Reject`] | 硬拒 | 永不添加，不需要用户确认 |
//! | [`Verdict::Confirm`] | 警告 | 需用户显式确认才写入 |
//! | [`Verdict::Allow`] | 放行 | 直接添加 |
//!
//! ## 为什么要分三档而不是「一律拒绝」
//!
//! 一律拒绝会逼用户把工作区建在奇怪的地方，或者干脆不用这个功能。
//! 一律放行等于没有闸门。分三档把决定权交给用户，但**把明显不该碰的
//! 目录挡在门外**——那些目录被授权后，模型的一次误操作就可能造成
//! 不可逆的后果（删掉密钥、格式化系统目录）。
//!
//! ## 规则表化
//!
//! 所有规则都写成数据（段名黑名单、系统路径表、文件名模式），不散落在
//! `if` 分支里。加一条规则 = 加一行表项，不用改逻辑。

use std::path::{Path, PathBuf};

/// 判定结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// 可以直接添加。
    Allow,
    /// 可能有隐私风险，需用户确认。
    Confirm { reason: String },
    /// 硬拒，不可添加。
    Reject { reason: String },
}

impl Verdict {
    /// 是否为「放行」。前端据此决定要不要弹确认框。
    pub fn is_allow(&self) -> bool {
        matches!(self, Verdict::Allow)
    }

    /// 是否为「硬拒」。前端据此禁用添加按钮。
    pub fn is_reject(&self) -> bool {
        matches!(self, Verdict::Reject { .. })
    }

    /// 是否需要用户确认。
    pub fn needs_confirm(&self) -> bool {
        matches!(self, Verdict::Confirm { .. })
    }

    /// 面向用户的说明。
    pub fn reason(&self) -> String {
        match self {
            Verdict::Allow => "可以直接添加".to_string(),
            Verdict::Confirm { reason } => reason.clone(),
            Verdict::Reject { reason } => reason.clone(),
        }
    }

    /// 供前端消费的字符串标签。
    pub fn level(&self) -> &'static str {
        match self {
            Verdict::Allow => "allow",
            Verdict::Confirm { .. } => "confirm",
            Verdict::Reject { .. } => "reject",
        }
    }
}

/// 硬拒的目录**段名**（任意层级出现即拒）。
///
/// 命中的是路径的某一段，不是整个路径。比如 `C:/Users/x/.ssh` 里
/// 有一段叫 `.ssh` 就拒绝；`C:/Users/x/myproject` 不受影响。
const DENIED_SEGMENTS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".password-store",
    "system volume information",
    "$recycle.bin",
    "windows",
    "system32",
    "syswow64",
    "program files",
    "program files (x86)",
    "programdata",
    "recovery",
];

/// 硬拒的**文件名模式**（小写比较）。密钥与凭据文件。
const DENIED_FILE_PATTERNS: &[&str] = &[
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "credentials",
    ".netrc",
    ".npmrc",
    ".pypirc",
    "authorized_keys",
    "known_hosts",
];

/// 扩展名形式拒绝的密钥文件（`.pem` / `.key` / `.p12` / `.pfx`）。
const DENIED_FILE_EXTENSIONS: &[&str] = &["pem", "key", "p12", "pfx", "jks", "keystore"];

/// 需要确认的**目录段名**（可能有隐私信息）。
///
/// 这些目录被授权后，模型能看到里面的聊天记录、合同、证件照……
/// 不是「不能碰」，而是「用户得知道自己在授权什么」。
const CONFIRM_SEGMENTS: &[&str] = &[
    "desktop",
    "documents",
    "downloads",
    "pictures",
    "videos",
    "music",
    "favorites",
    "contacts",
    "saved games",
    "oneDrive",
];

/// 判定一个路径能否加入白名单。
///
/// 判定顺序：**硬拒优先**。一个同时命中硬拒与警告的路径必须被拒——
/// 先判警告会让用户点一次确认就把 `C:/Windows/System32` 加进去。
///
/// 路径不存在时按「最深存在祖先」判定：用户可能想授权一个还没建的
/// 目录，但那没意义（模型也访问不了），所以只看它父级所处的位置。
pub fn classify(path: &Path) -> Verdict {
    // 盘符根：`C:/` —— 授权它等于授权整块磁盘
    if is_drive_root(path) {
        return Verdict::Reject {
            reason: "不能授权磁盘根目录：它包含整个磁盘的内容".into(),
        };
    }

    // 用户目录根：`C:/Users` —— 包含所有用户配置
    let segments = segments_of(path);
    if let Some(first) = segments.first() {
        if first.eq_ignore_ascii_case("users") && segments.len() == 1 {
            return Verdict::Reject {
                reason: "不能授权用户目录根：它包含所有用户的配置与凭据".into(),
            };
        }
    }

    // 段名黑名单（系统目录 / 密钥目录）
    for seg in &segments {
        let lower = seg.to_lowercase();
        if DENIED_SEGMENTS.contains(&lower.as_str()) {
            return Verdict::Reject {
                reason: format!("`{seg}` 是系统目录或密钥目录，不能授权给模型"),
            };
        }
    }

    // 文件名模式（密钥与凭据文件）
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if DENIED_FILE_PATTERNS.contains(&file_name.as_str()) {
        return Verdict::Reject {
            reason: format!("`{file_name}` 看起来是密钥或凭据文件，不能授权"),
        };
    }
    if let Some(ext) = Path::new(&file_name).extension().and_then(|e| e.to_str()) {
        if DENIED_FILE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
            return Verdict::Reject {
                reason: format!("`{file_name}` 是密钥文件（.{ext}），不能授权"),
            };
        }
    }

    // 隐私目录
    for seg in &segments {
        let lower = seg.to_lowercase();
        if CONFIRM_SEGMENTS.contains(&lower.as_str()) {
            return Verdict::Confirm {
                reason: format!(
                    "`{seg}` 可能包含隐私信息（聊天记录、证件、合同等）。\
                     授权后模型可以读取并修改其中的全部文件，请确认确实需要。"
                ),
            };
        }
    }

    Verdict::Allow
}

/// 路径的各段（不含盘符、不含根标记）。
fn segments_of(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            _ => None,
        })
        .collect()
}

/// 是否为磁盘根（`C:/`、`C:\`）。
fn is_drive_root(path: &Path) -> bool {
    let comps: Vec<_> = path.components().collect();
    // `C:/` 只有 Prefix + RootDir 两段；`C:` 只有 Prefix 一段
    matches!(comps.len(), 1 | 2)
        && comps
            .first()
            .map(|c| matches!(c, std::path::Component::Prefix(_)))
            .unwrap_or(false)
}

/// 归一化用户输入的路径：转绝对路径、统一正斜杠、去掉末尾斜杠。
///
/// 输入可能来自对话框（用户手输）或目录选择器（已是绝对路径）。
/// 两者都要能处理。
///
/// **反斜杠一律转成正斜杠，不报错。**
/// v0.6.2 原本遇到 `\` 直接拒绝，理由是「统一用正斜杠」——
/// 但 Windows 的目录选择器**返回的就是反斜杠路径**
/// （`C:\Users\x\Desktop`），于是「用选择器添加目录」这条主路径
/// 必然失败，用户看到的是「请使用正斜杠 /，不要用反斜杠 \」，
/// 而他根本没机会选择用哪种斜杠。这是 v0.6.3 用户实测报出的问题。
pub fn normalize(input: &str) -> Result<PathBuf, String> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err("路径不能为空".into());
    }
    // 反斜杠 → 正斜杠。Windows 上两者都是路径分隔符，等价。
    let raw = raw.replace('\\', "/");

    // 已是绝对路径（盘符形式）
    let p = PathBuf::from(&raw);
    if p.is_absolute() {
        return Ok(strip_trailing_slash(p));
    }

    // 相对路径：相对于当前工作目录补全。
    // 用户在对话框里手输相对路径时，多半是想指当前工作区下的东西。
    let cwd = std::env::current_dir().map_err(|e| format!("无法获取当前目录: {e}"))?;
    Ok(strip_trailing_slash(cwd.join(p)))
}

/// 去掉末尾斜杠。
///
/// **盘符根必须保留斜杠**：`C:/` 去掉斜杠就是 `C:`——那是**相对路径**
/// （当前盘符的目录），不是根。后果不只是显示难看：
/// `classify("C:")` 判不出「盘符根」这一档，于是「拒绝系统目录」的闸门
/// 会被绕过；再存进白名单也是错的路径。
fn strip_trailing_slash(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().trim_end_matches('/').to_string();
    if s.is_empty() {
        p
    } else if s.ends_with(':') {
        // 盘符根：补回斜杠
        PathBuf::from(format!("{s}/"))
    } else {
        PathBuf::from(s)
    }
}

/// 展示用的路径文本：统一正斜杠（Windows 习惯在前端展示时用 `/`）。
pub fn display(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一个 Windows 风格的路径用于判定（判定只看段名，不碰磁盘）。
    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn drive_root_is_rejected() {
        assert!(classify(&p("C:/")).is_reject());
        assert!(classify(&p("C:\\")).is_reject());
        assert!(classify(&p("D:/")).is_reject());
    }

    #[test]
    fn system_dirs_are_rejected() {
        for path in [
            "C:/Windows",
            "C:/Windows/System32",
            "C:/Program Files",
            "C:/Program Files (x86)",
            "C:/ProgramData",
            "C:/Users/x/AppData/Local/Temp/../../../../Windows",
        ] {
            let v = classify(&p(path));
            assert!(v.is_reject(), "应拒绝: {path} -> {v:?}");
        }
    }

    #[test]
    fn key_directories_are_rejected() {
        for path in [
            "C:/Users/x/.ssh",
            "C:/Users/x/.ssh/keys",
            "C:/Users/x/.gnupg",
            "C:/Users/x/.aws",
            "C:/Users/x/.kube",
            "C:/Users/x/AppData/Roaming/.docker",
        ] {
            let v = classify(&p(path));
            assert!(v.is_reject(), "应拒绝: {path} -> {v:?}");
        }
    }

    #[test]
    fn key_files_are_rejected() {
        for path in [
            "C:/Users/x/id_rsa",
            "C:/Users/x/.netrc",
            "C:/Users/x/.npmrc",
            "C:/Users/x/server.pem",
            "C:/Users/x/private.key",
            "C:/Users/x/keystore.p12",
        ] {
            let v = classify(&p(path));
            assert!(v.is_reject(), "应拒绝: {path} -> {v:?}");
        }
    }

    #[test]
    fn users_root_is_rejected() {
        assert!(classify(&p("C:/Users")).is_reject());
    }

    #[test]
    fn privacy_dirs_need_confirmation() {
        for path in [
            "C:/Users/x/Desktop",
            "C:/Users/x/Documents",
            "C:/Users/x/Downloads",
            "C:/Users/x/Pictures",
            "C:/Users/x/Music",
        ] {
            let v = classify(&p(path));
            assert!(v.needs_confirm(), "应需确认: {path} -> {v:?}");
            assert!(!v.is_reject(), "不应硬拒: {path}");
        }
    }

    #[test]
    fn privacy_dir_subpaths_also_need_confirmation() {
        let v = classify(&p("C:/Users/x/Documents/工作/合同.docx"));
        assert!(v.needs_confirm(), "{v:?}");
    }

    #[test]
    fn ordinary_dirs_are_allowed() {
        for path in [
            "C:/Users/x/AppData/Roaming/aura/skills/local",
            "D:/projects/myapp",
            "E:/data/datasets",
            "C:/Users/x/Documents-old",  // 只是名字相近，不含精确段名
            "C:/Users/x/myproject",
        ] {
            let v = classify(&p(path));
            assert!(v.is_allow(), "应放行: {path} -> {v:?}");
        }
    }

    /// 硬拒优先于警告：`C:/Windows/System32` 里没有隐私段名，
    /// 但反过来若某路径同时命中两者，必须拒绝。
    #[test]
    fn reject_wins_over_confirm() {
        // 段名匹配是精确的，"desktop" 与 "Desktop" 大小写不敏感地都命中
        let v = classify(&p("C:/Users/x/Desktop"));
        assert!(v.needs_confirm());
        // 但硬拒段名优先级更高
        let v = classify(&p("C:/Users/x/.ssh/Desktop"));
        assert!(v.is_reject(), "{v:?}");
    }

    #[test]
    fn segments_ignore_drive_and_root() {
        let segs = segments_of(&p("C:/Users/x/Documents"));
        assert_eq!(segs, vec!["Users", "x", "Documents"]);
    }

    #[test]
    fn normalize_rejects_empty_only() {
        assert!(normalize("").is_err());
        assert!(normalize("   ").is_err());
    }

    /// **反斜杠必须被接受**（不是拒绝）。
    ///
    /// Windows 的目录选择器返回的就是反斜杠路径，v0.6.2 把它当错误拒绝，
    /// 于是「用选择器添加目录」这条主路径必然失败。
    #[test]
    fn normalize_accepts_backslash_and_converts_to_forward_slash() {
        let abs = normalize("C:\\Users\\x\\Desktop").unwrap();
        assert!(abs.is_absolute());
        assert_eq!(abs.to_string_lossy(), "C:/Users/x/Desktop");
        // 盘符根也一样
        assert_eq!(normalize("C:\\").unwrap().to_string_lossy(), "C:/");
    }

    /// 盘符根去掉斜杠会变成 `C:`（相对路径），那会**绕过盘符根拒绝档**。
    /// 归一化后必须仍然是根。
    #[test]
    fn normalized_drive_root_is_still_rejected() {
        let root = normalize("C:\\").unwrap();
        assert_eq!(root.to_string_lossy(), "C:/");
        assert!(
            classify(&root).is_reject(),
            "归一化后的盘符根必须仍在拒绝档里"
        );
    }

    #[test]
    fn normalize_keeps_absolute_and_expands_relative() {
        let abs = normalize("C:/Users/x/Desktop").unwrap();
        assert!(abs.is_absolute());
        // 末尾斜杠被去掉
        assert!(!normalize("C:/Users/x/").unwrap().to_string_lossy().ends_with('/'));
        // 相对路径被补成绝对路径
        assert!(normalize("some/dir").unwrap().is_absolute());
    }

    #[test]
    fn display_uses_forward_slash() {
        assert_eq!(display(&PathBuf::from("C:\\Users\\x")), "C:/Users/x");
    }
}
