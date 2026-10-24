//! 工具访问域（v0.6.2）
//!
//! 此前所有工具只认**一个**根：工作区。`resolve_path` 把相对路径拼到
//! 工作区上，`ensure_inside` 要求目标 `starts_with(root)`。
//!
//! v0.6.2 要支持「用户授权的额外目录」（路径白名单，见 `paths.rs`），
//! 模型在这些目录里应当像在工作区一样读写。于是「一个根」升级为
//! 「一组允许的根」，判定入口收敛到 [`AccessScope::allows`] 一处。
//!
//! ## 两条不能混淆的路径语义
//!
//! | 写法 | 含义 | 判定 |
//! |---|---|---|
//! | `src/main.rs` | 工作区相对 | 工作区 |
//! | `/src/main.rs` | **工作区根**（不是文件系统根） | 工作区 |
//! | `C:/Users/x/AppData/...` | Windows 盘符绝对路径 | 落在任一允许根内 |
//!
//! 前导 `/` 刻意**不是** Unix 绝对路径：工具示例教模型「工作区根写 /」，
//! 若把它当文件系统根，`/etc/passwd` 就会指向真实系统文件。Unix 风格的
//! `/etc/passwd` 在这里等于「工作区下的 etc/passwd」，越界由
//! [`AccessScope::allows`] 兜住。
//!
//! 盘符形式（`C:/...`）才是真绝对路径：它**不以 `/` 开头**，
//! 因此不会与「前导 / = 工作区根」这条约定打架。
//!
//! ## 为什么判定前要 canonicalize
//!
//! `canonicalize` 会解掉 `..`、符号链接与 Windows 8.3 短名，
//! 判定必须在它之后做，否则 `<工作区>/link -> C:/Windows` 这种
//! 逃逸就能绕过 `starts_with`。
//!
//! 代价是 Windows 上 canonical 结果带 `\\?\` 前缀。它只用于**比较**，
//! 不用于展示——展示仍走原始路径。

use std::path::{Path, PathBuf};

/// 工具可访问的路径集合。
///
/// 构造时即 canonicalize 全部根：判定是热路径（每次工具调用都要走），
/// 而 canonicalize 是系统调用，放进构造函数只付一次。
#[derive(Clone, Debug)]
pub struct AccessScope {
    /// 工作区根（**原始**路径，不带 `\\?\` 前缀）。
    ///
    /// 用于相对路径的拼接基准、命令的工作目录、以及展示。
    pub workspace: PathBuf,
    /// 允许访问的根（已 canonicalize）：工作区 + 用户授权目录。
    roots: Vec<PathBuf>,
}

impl AccessScope {
    /// 构造访问域。
    ///
    /// `extra` 是用户授权的额外目录（路径白名单）。**单个 extra 不可用
    /// （已被删除、无权限）只跳过它**，不影响其余根——一条失效的白名单
    /// 不该让整个工作区都不可用。
    ///
    /// 但**工作区不可用是硬错误**：那是所有路径的基准，缺了它
    /// 工具就只能报「越界」，用户会看到一堆莫名其妙的拦截。
    pub fn new(workspace: PathBuf, extra: Vec<PathBuf>) -> Result<Self, String> {
        let workspace_c = workspace
            .canonicalize()
            .map_err(|e| format!("工作区不可用: {}", e))?;
        let mut roots = vec![workspace_c];
        for r in extra {
            // 去重：白名单里重复加同一个目录没有意义，
            // 但用户完全可能这么做，不该因此报错。
            if let Ok(c) = r.canonicalize() {
                if !roots.contains(&c) {
                    roots.push(c);
                }
            }
        }
        Ok(Self { workspace, roots })
    }

    /// 只含工作区。等价于 v0.6.1 的行为。
    pub fn workspace_only(workspace: PathBuf) -> Result<Self, String> {
        Self::new(workspace, Vec::new())
    }

    /// 目标路径（**已 canonicalize**）是否落在允许范围内。
    ///
    /// 唯一判定入口。任何绕过它的路径检查都是 bug。
    pub fn allows(&self, canonical: &Path) -> bool {
        self.roots.iter().any(|r| canonical.starts_with(r))
    }

    /// 允许访问的根（已 canonicalize）。仅用于展示与测试。
    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }
}

/// 判断是否 Windows 盘符绝对路径（`C:/...`）。
///
/// 三个条件缺一不可：
/// - 长度 ≥ 3：`C:` 本身不是路径
/// - 第二字节是 `:`：盘符
/// - 第三字节是 `/`：`C:foo` 在 Windows 上是「当前驱动器目录下的 foo」，
///   属于相对路径的怪异写法，不是绝对路径
///
/// 前导 `/` 无需单独排除：`/C:/foo` 的第二字节是 `C` 而非 `:`，
/// 本来就落选——前导 `/` 的语义已被「工作区根」占用，不会被盘符劫持。
pub fn is_drive_absolute(path: &str) -> bool {
    let b = path.as_bytes();
    b.len() >= 3 && b[1] == b':' && b[2] == b'/'
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::*;

    /// 构造只含工作区的访问域；目录不存在时先创建。
    ///
    /// 测试里到处都要「一个能用的工作区」，而 [`AccessScope::new`] 要求
    /// 工作区可 canonicalize（必须已存在）。这个辅助把「建目录 + 构造」
    /// 合成一步，避免每个用例都写三行样板。
    pub fn scope(workspace: PathBuf) -> AccessScope {
        std::fs::create_dir_all(&workspace).expect("测试工作区应可创建");
        AccessScope::workspace_only(workspace).expect("测试工作区应可用")
    }

    /// 构造含额外授权根的访问域；工作区与额外根都会先创建。
    pub fn scope_with(workspace: PathBuf, extra: Vec<PathBuf>) -> AccessScope {
        std::fs::create_dir_all(&workspace).expect("测试工作区应可创建");
        for e in &extra {
            std::fs::create_dir_all(e).expect("测试授权目录应可创建");
        }
        AccessScope::new(workspace, extra).expect("测试访问域应可用")
    }
}
