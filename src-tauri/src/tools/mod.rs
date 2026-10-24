pub mod exec;
pub mod fs_ops;
pub mod registry;
pub mod scope;
pub mod search;
pub mod write_ops;

use std::path::{Path, PathBuf};

use serde_json::Value;

pub use registry::{is_known, ToolKind};
pub use scope::AccessScope;

#[derive(Debug)]
pub struct ToolOutput {
    pub label: String,
    pub result: String,
}

#[derive(Debug)]
pub struct ToolFail {
    pub label: String,
    pub error: String,
}

/// 生成 UI 动作文案。工具列表见 `registry::TOOLS`。
pub fn tool_label(name: &str, args: &Value) -> String {
    registry::find(name)
        .map(|t| (t.label)(args))
        .unwrap_or_else(|| name.to_string())
}

/// 把模型给的路径解析成实际路径。
///
/// 三种语义（详见 [`scope`] 模块的说明）：
///
/// | 写法 | 含义 |
/// |---|---|
/// | `src/main.rs` | 工作区相对 |
/// | `/src/main.rs` | 工作区根目录（**不是**文件系统根） |
/// | `C:/Users/x/...` | Windows 盘符绝对路径 |
///
/// 盘符绝对路径在这里**只做解析，不做放行**——放行由
/// [`ensure_allowed`] 统一判定。这里若提前拒绝，模型就永远无法访问
/// 用户授权的目录（v0.6.2 的路径白名单）。
pub fn resolve_path(scope: &AccessScope, path: &str) -> Result<PathBuf, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("路径不能为空".into());
    }
    if path.contains('\\') {
        return Err("路径必须使用正斜杠 /，不能使用反斜杠".into());
    }

    // Windows 盘符绝对路径：真绝对路径，交给下游闸门判定是否在允许范围内。
    // 必须在剥前导 `/` **之前**判断——`/C:/foo` 不是盘符路径（第二字节是
    // `C` 而非 `:`），仍按工作区相对处理。
    if scope::is_drive_absolute(path) {
        // 首段是盘符本身（`C:`），允许；其余段沿用与相对路径相同的规则：
        // 禁 `..`（避免回溯逻辑遇到未解析的 `..`）、
        // 禁冒号（NTFS 数据流后缀 `file.txt:stream` 是隐蔽的写入通道）。
        let rest = &path[3..];
        for seg in rest.split('/') {
            match seg {
                "" | "." => {}
                ".." => return Err("禁止使用 ..，不能越出允许访问的范围".into()),
                s if s.contains(':') => {
                    return Err("路径段不能包含冒号（:）——它会被解释成盘符或数据流".into())
                }
                _ => {}
            }
        }
        return Ok(PathBuf::from(path));
    }

    // 前导 `/` 视为「工作区根目录」，而非系统绝对路径。
    //
    // 此前只把**恰好等于** `/` 的路径当作根目录白名单，其余以 `/` 开头的
    // 一律拒绝。但工具示例明确教模型「工作区根目录写 /」，模型据此推断
    // `/index.html` = 根下文件并被拒——规范自相矛盾，模型并没有错。
    //
    // 安全性不受影响：这里剥离后仍从工作区出发逐段 push，产出的永远是
    // `<workspace>/<若干段>`；真正的越界由下游 [`ensure_allowed`] /
    // [`resolve_path_for_write`] 两道 `canonicalize + allows` 闸门拦截。
    let path = path.trim_start_matches('/');
    if path.is_empty() {
        return Ok(scope.workspace.clone());
    }
    let mut resolved = scope.workspace.clone();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => return Err("禁止使用 ..，不能越出允许访问的范围".into()),
            // 段内带冒号 = Windows 盘符前缀或 NTFS 数据流后缀。
            //
            // `PathBuf::push` 遇到带盘符的段（如 `C:`）会**替换整个路径**，
            // 于是 `/C:/Windows` 剥掉前导 `/` 后 push("C:") 就把工作区根
            // 换成了盘符相对路径，结果落在 `C:Windows`——逃出工作区。
            //
            // 这不是新引入的问题：旧代码只检查整串路径的第二个字节是不是
            // 冒号，`a/C:/Windows` 这种中间段带盘符的写法同样能绕过。
            // 判定必须落在**每一段**上。
            s if s.contains(':') => {
                return Err("路径段不能包含冒号（:）——它会被解释成盘符或数据流".into())
            }
            s => resolved.push(s),
        }
    }
    Ok(resolved)
}

/// 判定目标路径是否落在允许访问的范围内。
///
/// 唯一的放行入口：工作区 + 用户授权目录（路径白名单）。
/// 判定前必须 `canonicalize`——否则 `<工作区>/link -> C:/Windows`
/// 这种符号链接逃逸就能绕过 `starts_with`。
pub fn ensure_allowed(scope: &AccessScope, target: &Path) -> Result<PathBuf, String> {
    let target_c = target
        .canonicalize()
        .map_err(|e| format!("路径不存在或无法访问: {}", e))?;
    if !scope.allows(&target_c) {
        return Err("路径越出允许访问的范围（工作区与已授权目录），已拦截".into());
    }
    Ok(target_c)
}

/// 写入场景的路径解析：目标文件/目录可能**尚不存在**。
///
/// [`ensure_allowed`] 依赖 `canonicalize()`，对不存在的路径直接失败，
/// 因此无法用于 `write_file` 这类创建新文件的工具。这里改为：
/// 1. 复用 [`resolve_path`] 的字符串级拦截（禁 `..`、反斜杠）
/// 2. 逐段向上回溯，找到最深的存在祖先
/// 3. 对该祖先做 `canonicalize` + [`AccessScope::allows`] 校验——这一步防住
///    「工作区内某符号链接指向外部目录，再在其下新建文件」的逃逸
/// 4. 把剩余段按原顺序拼回
///
/// 返回的路径未做 `canonicalize`，调用方需自行确保父目录已创建。
pub fn resolve_path_for_write(scope: &AccessScope, path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_path(scope, path)?;

    // 已是工作区根或其现存子路径时，直接复用常规校验
    if resolved.exists() {
        return ensure_allowed(scope, &resolved);
    }

    // 自下而上剥离不存在的段，记录待拼回的后缀
    let mut existing = resolved.clone();
    let mut trailing: Vec<std::ffi::OsString> = Vec::new();
    loop {
        let Some(name) = existing.file_name().map(|s| s.to_os_string()) else {
            break;
        };
        let Some(parent) = existing.parent().map(|p| p.to_path_buf()) else {
            break;
        };
        trailing.push(name);
        existing = parent;
        if existing.exists() {
            break;
        }
    }

    let existing_c = existing
        .canonicalize()
        .map_err(|e| format!("路径不可访问: {}", e))?;
    if !scope.allows(&existing_c) {
        return Err("路径越出允许访问的范围（工作区与已授权目录），已拦截".into());
    }

    let mut final_path = existing_c;
    for seg in trailing.iter().rev() {
        final_path.push(seg);
    }
    Ok(final_path)
}

/// 原子写入：先写同目录临时文件，再 `rename` 覆盖目标。
///
/// 同目录保证 rename 在同一文件系统内是原子的；直接写目标文件的风险是
/// 写入中途崩溃/磁盘满会留下半截文件，rename 则要么完整替换要么保持原样。
///
/// 并发写入保护：写入类工具由 `run_turn` 单循环串行调用，同一文件不会
/// 出现两个并发写者；原子写保证任一时刻磁盘上的文件都是完整版本，不会
/// 出现「写了一半」的脏文件。
pub fn atomic_write(target: &Path, content: &str) -> Result<(), String> {
    let dir = target
        .parent()
        .ok_or_else(|| "目标路径缺少父目录".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let file_name = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("tmp");
    // 进程内唯一，避免并发写入同一目录时互相覆盖临时文件
    let tmp = dir.join(format!(
        ".aura-{}-{}.tmp",
        file_name,
        std::process::id()
    ));

    let write_result = std::fs::write(&tmp, content);
    if let Err(e) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("写入失败: {}", e));
    }
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("替换目标文件失败: {}", e));
    }
    Ok(())
}

pub(crate) fn display_path(path: &str) -> String {
    // 盘符绝对路径原样展示：它本来就是完整路径，剥掉前导 `/` 反而
    // 会让「C:/Users/x/AppData/...」显示成奇怪的样子。
    if scope::is_drive_absolute(path.trim()) {
        return path.trim().to_string();
    }
    // 前导 `/` 已被 resolve_path 视为根目录，展示时去掉以免
    // 让 `Read /index.html` 看起来像在访问系统绝对路径
    let p = path.trim().trim_start_matches("./").trim_start_matches('/');
    if p.is_empty() || p == "." {
        "/".to_string()
    } else {
        p.trim_end_matches('/').to_string()
    }
}

/// 异步执行工具。
///
/// 工具本体仍是同步函数（文件 IO 不值得引入异步复杂度），但通过
/// `spawn_blocking` 移交阻塞线程池执行：`run_script` 这类要跑子进程的
/// 工具若直接同步调用，会阻塞 tokio worker，导致 SSE 流式输出中断、
/// 界面假死、停止按钮失灵。
pub async fn execute(
    scope: AccessScope,
    name: String,
    args: Value,
) -> Result<ToolOutput, ToolFail> {
    let label = tool_label(&name, &args);
    let result = match registry::find(&name) {
        Some(spec) => {
            let run = spec.run;
            match tokio::task::spawn_blocking(move || run(&scope, &args)).await {
                Ok(r) => r,
                Err(e) => Err(format!("工具执行异常: {}", e)),
            }
        }
        None => Err(format!("未知工具: {}", name)),
    };
    result.map_err(|error| ToolFail { label, error })
}

#[cfg(test)]
mod tests {
    use super::*;
    use scope::testutil::{scope as test_scope, scope_with as test_scope_with};

    fn root() -> PathBuf {
        std::env::temp_dir().join("aura_tools_test_root")
    }

    /// 只含工作区的访问域（白名单为空，等价于 v0.6.1）。
    fn sc(r: &Path) -> AccessScope {
        test_scope(r.to_path_buf())
    }

    #[test]
    fn root_slash_maps_to_workspace() {
        let r = root();
        assert_eq!(resolve_path(&sc(&r), "/").unwrap(), r);
    }

    #[test]
    fn relative_path_resolves() {
        let r = root();
        let p = resolve_path(&sc(&r), "src/main.rs").unwrap();
        assert_eq!(p, r.join("src").join("main.rs"));
    }

    #[test]
    fn rejects_traversal_and_backslash() {
        let r = root();
        let s = sc(&r);
        assert!(resolve_path(&s, "../etc").is_err());
        assert!(resolve_path(&s, "a/../../b").is_err());
        assert!(resolve_path(&s, "a\\b").is_err());
        assert!(resolve_path(&s, "").is_err());
    }

    /// 前导 `/` 现在表示工作区根目录。
    ///
    /// 模型被明确教过「根目录写 /」，据此推断 `/index.html` 指向根下文件
    /// 是合理推断，拒它是规范自相矛盾。这里固定新语义。
    #[test]
    fn leading_slash_resolves_inside_workspace() {
        let r = root();
        let s = sc(&r);
        assert_eq!(resolve_path(&s, "/").unwrap(), r);
        assert_eq!(resolve_path(&s, "/index.html").unwrap(), r.join("index.html"));
        assert_eq!(
            resolve_path(&s, "/src/main.rs").unwrap(),
            r.join("src").join("main.rs")
        );
        // 多个前导斜杠同样按根目录处理
        assert_eq!(resolve_path(&s, "//index.html").unwrap(), r.join("index.html"));
    }

    /// 宽容处理不等于放弃沙盒：`/etc/passwd` 解析到工作区内，
    /// 但它不存在，真正的访问仍由 `ensure_allowed` 拦下。
    #[test]
    fn leading_slash_still_cannot_escape_workspace() {
        let (ws, outside, base) = sandbox_fixture("leading_slash");
        let s = sc(&ws);
        // 解析结果始终在 root 之下
        let p = resolve_path(&s, "/etc/passwd").unwrap();
        assert!(p.starts_with(&ws));
        // 工作区内不存在该文件 → ensure_allowed 拒绝
        assert!(ensure_allowed(&s, &p).is_err());
        let _ = std::fs::remove_dir_all(&base);
        let _ = outside;
    }

    /// v0.6.2：盘符绝对路径不再被字符串层拒绝，改为交给 `ensure_allowed`。
    ///
    /// 这是路径白名单的前提——模型要能访问 `C:/Users/x/AppData/.../skills/local`，
    /// 就必须能写出盘符路径。但**解析通过不等于放行**：落在允许范围外的
    /// 盘符路径仍会被 `ensure_allowed` 拦下。
    #[test]
    fn drive_absolute_is_parsed_not_rejected() {
        let r = root();
        let s = sc(&r);
        // 解析层不再报错
        let p = resolve_path(&s, "C:/Windows").unwrap();
        assert_eq!(p, PathBuf::from("C:/Windows"));
        // 但判定层仍然拦下（工作区里当然没有 C:/Windows）
        assert!(ensure_allowed(&s, &p).is_err());
    }

    /// 盘符绝对路径里的 `..` 与冒号后缀都要拒绝。
    ///
    /// `..` 若留着不解析，写路径的「最深存在祖先」回溯会拿到未解析的路径；
    /// 冒号是 NTFS 数据流后缀（`file.txt:stream`），是一条隐蔽的写入通道。
    #[test]
    fn drive_absolute_rejects_traversal_and_stream_suffix() {
        let r = root();
        let s = sc(&r);
        assert!(resolve_path(&s, "C:/Users/x/../Windows").is_err());
        assert!(resolve_path(&s, "C:/Users/x/./y").is_ok());
        assert!(resolve_path(&s, "C:/Users/x/file.txt:stream").is_err());
    }

    /// 盘符识别的边界：小写盘符要认，`C:foo`（无斜杠）不算绝对路径。
    #[test]
    fn drive_absolute_detection_is_strict() {
        assert!(scope::is_drive_absolute("C:/Windows"));
        assert!(scope::is_drive_absolute("c:/windows"));
        assert!(scope::is_drive_absolute("D:/x/y"));
        // 无斜杠的盘符相对写法不是绝对路径
        assert!(!scope::is_drive_absolute("C:foo"));
        assert!(!scope::is_drive_absolute("C:"));
        // 前导 / 的写法不是盘符路径（第二字节不是冒号）
        assert!(!scope::is_drive_absolute("/C:/foo"));
        // UNC 不是盘符
        assert!(!scope::is_drive_absolute("//server/share"));
    }

    /// v0.6.2 关键不变量：`/C:/foo` 绝不能变成系统路径。
    ///
    /// 前导 `/` 的语义是「工作区根」，不能被盘符形式劫持。
    /// 这条必须钉死——将来若有人「顺手统一」`/` 与盘符的处理，
    /// `/etc/passwd` 就会变成真的系统文件。
    ///
    /// 曾经的真实漏洞：剥掉前导 `/` 后 `C:/Windows` 按 `/` 切成
    /// `["C:", "Windows"]`，而 `PathBuf::push("C:")` 在 Windows 上会
    /// **替换整个路径**，结果落到 `C:Windows`——逃出工作区。
    /// 现在含冒号的段一律拒绝。
    #[test]
    fn leading_slash_cannot_be_hijacked_by_drive_letter() {
        let r = root();
        let s = sc(&r);
        // 直接拒绝（而不是解析成一个可疑路径）
        let err = resolve_path(&s, "/C:/Windows").unwrap_err();
        assert!(err.contains("冒号"), "err: {}", err);
        // 中间段带盘符同样拒绝（旧代码会漏掉这一种）
        assert!(resolve_path(&s, "a/C:/Windows").is_err());
        assert!(resolve_path(&s, "/a/C:/Windows").is_err());
    }

    #[test]
    fn rejects_more_traversal_variants() {
        let r = root();
        let s = sc(&r);
        // 纯 .. 与深层越界
        assert!(resolve_path(&s, "..").is_err());
        assert!(resolve_path(&s, "a/b/../../../c").is_err());
        assert!(resolve_path(&s, "./../x").is_err());
        assert!(resolve_path(&s, "a/./..").is_err());
        // UNC 反斜杠形式仍拒绝
        assert!(resolve_path(&s, "\\\\server\\share").is_err());
        // 前导斜杠已按根目录处理（见 leading_slash_resolves_inside_workspace），
        // 因此 //server/share 会解析到工作区内而非被当作 UNC
        assert!(resolve_path(&s, "//server/share").is_ok());
        // 含冒号的段一律拒绝：`file:///c:/x` 里的 `c:` 会被当盘符前缀
        assert!(resolve_path(&s, "file:///c:/x").is_err());
    }

    #[test]
    fn accepts_normal_relative_variants() {
        let r = root();
        let s = sc(&r);
        // 空段与 . 段应被规范化，不构成越界
        let a = resolve_path(&s, "a//b").unwrap();
        let b = resolve_path(&s, "a/b").unwrap();
        assert_eq!(a, b);
        let c = resolve_path(&s, "./src/./main.rs").unwrap();
        assert_eq!(c, r.join("src").join("main.rs"));
    }

    fn sandbox_fixture(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("aura_sandbox_{}", name));
        let _ = std::fs::remove_dir_all(&base);
        let ws = base.join("ws");
        let outside = base.join("outside");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(ws.join("inside.txt"), "inside").unwrap();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        (ws, outside, base)
    }

    #[test]
    fn ensure_allowed_allows_root_and_inside_files() {
        let (ws, _outside, base) = sandbox_fixture("allow");
        let s = sc(&ws);
        assert!(ensure_allowed(&s, &ws).is_ok());
        assert!(ensure_allowed(&s, &ws.join("inside.txt")).is_ok());
        // 大小写混拼：canonicalize 统一为磁盘真实大小写
        let upper = PathBuf::from(ws.to_string_lossy().to_uppercase());
        assert!(ensure_allowed(&s, &upper).is_ok());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn ensure_allowed_blocks_outside_paths() {
        let (ws, outside, base) = sandbox_fixture("outside");
        let s = sc(&ws);
        assert!(ensure_allowed(&s, &outside).is_err());
        assert!(ensure_allowed(&s, &outside.join("secret.txt")).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// v0.6.2：白名单目录内的路径被放行，目录外的一律拒绝。
    ///
    /// 这是需求 1 的核心行为：授权目录要「像工作区一样」可访问，
    /// 而授权范围之外依然必须拦住。
    #[test]
    fn allowlisted_root_is_accessible() {
        let base = std::env::temp_dir().join("aura_sandbox_allowlist");
        let _ = std::fs::remove_dir_all(&base);
        let ws = base.join("ws");
        let granted = base.join("granted");
        let denied = base.join("denied");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::create_dir_all(&granted).unwrap();
        std::fs::create_dir_all(&denied).unwrap();
        std::fs::write(granted.join("skill.md"), "SKILL").unwrap();
        std::fs::write(denied.join("secret.txt"), "secret").unwrap();

        let s = test_scope_with(ws.clone(), vec![granted.clone()]);

        // 授权目录内的文件放行
        assert!(ensure_allowed(&s, &granted.join("skill.md")).is_ok());
        // 授权目录本身放行
        assert!(ensure_allowed(&s, &granted).is_ok());
        // 未授权目录仍然拒绝
        assert!(ensure_allowed(&s, &denied.join("secret.txt")).is_err());
        // 工作区仍然放行
        assert!(ensure_allowed(&s, &ws).is_ok());

        let _ = std::fs::remove_dir_all(&base);
    }

    /// 白名单只放行**该目录及其子目录**，不会因为加了 `C:/Users/x/Docs`
    /// 就顺带放行 `C:/Users/x/Docs/../.ssh`。
    #[test]
    fn allowlist_does_not_leak_sibling_dirs() {
        let base = std::env::temp_dir().join("aura_sandbox_allowlist_leak");
        let _ = std::fs::remove_dir_all(&base);
        let ws = base.join("ws");
        let granted = base.join("granted");
        let sibling = base.join("sibling");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::create_dir_all(&granted).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("secret.txt"), "secret").unwrap();

        let s = test_scope_with(ws, vec![granted.clone()]);
        // 兄弟目录不在授权范围内
        assert!(ensure_allowed(&s, &sibling.join("secret.txt")).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn write_path_allows_new_files_and_missing_dirs() {
        let (ws, _outside, base) = sandbox_fixture("write_ok");
        let s = sc(&ws);
        // Windows 下 canonicalize 会加 `\\?\` 前缀，比较前统一剥离
        let norm = |p: &Path| -> String {
            p.to_string_lossy()
                .trim_start_matches(r"\\?\")
                .replace('\\', "/")
        };
        let ws_norm = norm(&ws);

        // 新文件：父目录存在
        assert_eq!(norm(&resolve_path_for_write(&s, "new.txt").unwrap()), format!("{}/new.txt", ws_norm));
        // 深层不存在的目录
        assert_eq!(
            norm(&resolve_path_for_write(&s, "a/b/c/deep.txt").unwrap()),
            format!("{}/a/b/c/deep.txt", ws_norm)
        );
        // 已存在文件走常规校验
        let p = resolve_path_for_write(&s, "inside.txt").unwrap();
        assert!(p.ends_with("inside.txt"));
        // 工作区根
        assert_eq!(
            norm(&resolve_path_for_write(&s, "/").unwrap()),
            norm(&ws.canonicalize().unwrap())
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn write_path_rejects_traversal_and_backslash() {
        let (ws, _outside, base) = sandbox_fixture("write_reject");
        let s = sc(&ws);
        assert!(resolve_path_for_write(&s, "../evil.txt").is_err());
        assert!(resolve_path_for_write(&s, "a/../../evil.txt").is_err());
        assert!(resolve_path_for_write(&s, "a\\b").is_err());
        // 前导斜杠不再直接报错。返回的是 canonicalize 后的路径，
        // 与传入的 ws 可能字面不同（如大小写、短路径展开），故先取其盘符前缀
        assert!(resolve_path_for_write(&s, "/evil.txt").is_ok());
        // 关键：写路径解析必须在工作区内创建/命中，不得落到外部

        // 关键：写路径解析必须在工作区内创建/命中，不得落到外部
        let (other, _outside2, base2) = sandbox_fixture("write_reject_ok");
        let other_scope = sc(&other);
        assert!(resolve_path_for_write(&other_scope, "/sub/evil.txt")
            .unwrap()
            .starts_with(std::fs::canonicalize(&other).unwrap()));
        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::remove_dir_all(&base2);
    }

    /// v0.6.2：写路径也不能写到授权范围之外。
    #[test]
    fn write_path_blocks_drive_absolute_outside_scope() {
        let (ws, _outside, base) = sandbox_fixture("write_drive");
        let s = sc(&ws);
        // 盘符绝对路径现在能通过解析层，但判定层必须拦下
        let err = resolve_path_for_write(&s, "C:/Windows/System32/evil.txt").unwrap_err();
        assert!(err.contains("越出") || err.contains("拦截"), "err: {}", err);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn write_path_blocks_symlink_escape_for_new_files() {
        use std::os::windows::fs::symlink_dir;
        let (ws, outside, base) = sandbox_fixture("write_symlink");
        let s = sc(&ws);
        let link = ws.join("escape_link");
        match symlink_dir(&outside, &link) {
            Ok(()) => {
                // 关键场景：链接指向工作区外，且目标文件尚不存在。
                // ensure_allowed 在此处会因 canonicalize 失败而误判，
                // resolve_path_for_write 必须通过「最深存在祖先」正确拦截。
                let err = resolve_path_for_write(&s, "escape_link/new.txt")
                    .expect_err("符号链接逃逸必须被拦截");
                assert!(
                    err.contains("越出") || err.contains("拦截"),
                    "err: {}",
                    err
                );
                // 更深层同样拦截
                assert!(resolve_path_for_write(&s, "escape_link/a/b/c.txt").is_err());
            }
            Err(e) => {
                eprintln!("skip symlink test (需要开发者模式或管理员权限): {}", e);
            }
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn atomic_write_creates_file_and_replaces_content() {
        let (ws, _outside, base) = sandbox_fixture("atomic");
        let target = ws.join("out.txt");

        atomic_write(&target, "第一版").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "第一版");

        // 覆写
        atomic_write(&target, "第二版内容更长").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "第二版内容更长");

        // 不应残留临时文件
        let leftovers: Vec<_> = std::fs::read_dir(&ws)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".aura-"))
            .collect();
        assert!(leftovers.is_empty(), "残留临时文件: {:?}", leftovers);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn atomic_write_creates_missing_dirs() {
        let (ws, _outside, base) = sandbox_fixture("atomic_dirs");
        let target = ws.join("x").join("y").join("out.txt");
        atomic_write(&target, "内容").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "内容");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn ensure_allowed_blocks_symlink_escape() {
        use std::os::windows::fs::symlink_dir;
        let (ws, outside, base) = sandbox_fixture("symlink");
        let s = sc(&ws);
        let link = ws.join("escape_link");
        match symlink_dir(&outside, &link) {
            Ok(()) => {
                // 字符串解析层面仍在沙盒内，canonicalize 解析真实目标后必须拦截
                let resolved = resolve_path(&s, "escape_link").unwrap();
                let err = ensure_allowed(&s, &resolved).unwrap_err();
                assert!(err.contains("越出") || err.contains("拦截"), "err: {}", err);
                // 工具层同样拦截
                let args = serde_json::json!({ "path": "escape_link" });
                let err = fs_ops::list_files(&s, &args)
                    .err()
                    .expect("list_files 必须拦截符号链接逃逸");
                assert!(err.contains("越出") || err.contains("拦截"), "err: {}", err);
            }
            Err(e) => {
                eprintln!("skip symlink test (需要开发者模式或管理员权限): {}", e);
            }
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    /// v0.6.2：白名单路径的展示必须是完整绝对路径。
    ///
    /// 剥掉前导 `/` 会让 `C:/Users/x/AppData/...` 显示成
    /// `C:/Users/x/AppData/...`（恰好一样）但 `/Users/...` 会被误剥——
    /// 用户在界面上要能看清自己授权的是哪个目录。
    #[test]
    fn display_path_keeps_drive_absolute_intact() {
        assert_eq!(display_path("C:/Users/x/AppData/Local"), "C:/Users/x/AppData/Local");
        assert_eq!(display_path("/src/main.rs"), "src/main.rs");
        assert_eq!(display_path("/"), "/");
    }
}
