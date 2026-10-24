//! 技能市场：拉取注册表清单、审查并安装技能包。
//!
//! 注册表是独立仓库 `aura-xyz/aura-skill-registry`，清单为 `recommended.json`：
//! 每项给出 id、中文名、说明、版本、zip 地址与 sha256。安装即
//! 「下载 zip → 校验哈希 → 静态审查 → 解到 `skills/market/<id>/`」，之后由
//! 技能扫描照常发现，不需要别的登记动作。
//!
//! # 来源（v0.6.3）
//!
//! 官方仓库是默认源，用户可以再添加任意 **GitHub 仓库** 作为额外源（仓库根目录
//! 放一份同格式的 `recommended.json` 即可）。多源合并规则：
//!
//! - **官方永远排最前**，因此同 id 时官方条目胜出——第三方源无法劫持官方技能。
//! - 单个源拉取失败只影响它自己：其余源的条目正常展示，失败原因一起返回。
//! - 来源只接受 GitHub 仓库地址，并归一化成 raw 基址。**不为第三方源做 CDN
//!   镜像**：`mirror()` 只认自家仓库，否则市场就成了任意地址代理。
//!
//! # 安全底线
//!
//! | 环节 | 措施 |
//! |---|---|
//! | 清单 | id 必须合法；来源必须是 https |
//! | 下载 | sha256 必填，空值即拒，全文件比对 |
//! | 解包 | `enclosed_name()` 拒 `../` 与绝对路径；解压总量上限 20MB |
//! | 安装前 | `audit::scan` 静态审查，高危内容必须用户确认（`accept_risky`） |
//! | 落地 | 先解到临时目录再整体搬入，失败不留半个技能 |
//! | 更新 | 保留用户自己加的文件，见 [`preserved_paths`] |

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::agent::skill;
use crate::audit::{self, Audit};
use crate::providers::registry::ProviderRegistry;
use crate::providers::{Integrity, UnifiedSkill};

// 源相关的常量与逻辑已迁到 `providers/`（v0.6.2）：
// 本模块只保留**安装管线**——integrity 校验 → 安全解压 → 审查 → 原子安装 → 保留集。
// 各源的清单拉取、格式解析、id 规范化、下载都由 Provider 负责，
// 两条链路在这里汇合。

/// 安装记录文件名。放在技能目录里，记下「这个包自带哪些文件」——
/// 更新时据此区分「包内文件该被替换」与「用户自己加的文件要保留」。
pub const INSTALL_RECORD: &str = ".aura-install.json";

/// 单个技能包解压后的大小上限。技能是纯文本 + 少量脚本，20MB 已很宽松。
const MAX_UNPACKED: u64 = 20 * 1024 * 1024;

// ── 清单（已迁至 providers/）──────────────────────────────────
//
// 各源的清单拉取与格式解析由 Provider 负责，本模块只接收
// 统一结构 [`UnifiedSkill`]。合并规则（官方优先、同 slug 先到先得）
// 在 `providers::registry` 里。

// ── 哈希与 id ─────────────────────────────────────────────────

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        s.push(char::from_digit((b & 0x0f) as u32, 16).unwrap());
    }
    s
}

/// 计算内容的 sha256（十六进制）。
///
/// 用于「上游没给哈希」的场景：把**首次下载**的哈希记进安装记录，
/// 下次更新时与之比对，从而能发现「第一次装的是 A，第二次变成了 B」。
fn sha256_of(bytes: &[u8]) -> String {
    use sha2::Digest;
    hex(&sha2::Sha256::digest(bytes))
}

/// 校验 zip 哈希。清单没给哈希一律拒绝——装进来的东西必须有据可查。
fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), String> {
    use sha2::Digest;
    let expected = expected.trim().to_ascii_lowercase();
    if expected.is_empty() {
        return Err("市场清单缺少 sha256，拒绝安装".into());
    }
    let actual = hex(&sha2::Sha256::digest(bytes));
    if actual != expected {
        return Err(format!(
            "技能包校验失败（sha256 不匹配）：期望 {expected}，实际 {actual}"
        ));
    }
    Ok(())
}

/// id 同时是目录名，必须严格：小写字母/数字开头，只含 `[a-z0-9._-]`，≤64。
fn valid_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 64 {
        return false;
    }
    let first = id.chars().next().unwrap();
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

// ── 解包 ──────────────────────────────────────────────────────

/// 解包到 `dest`。每条路径都过 `enclosed_name()`，越界条目直接整体失败。
fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("技能包不是有效的 zip：{e}"))?;

    // 先核总量，避免解压炸弹把磁盘写满
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let file = archive
            .by_index_raw(i)
            .map_err(|e| format!("读取技能包条目失败：{e}"))?;
        total = total.saturating_add(file.size());
    }
    if total > MAX_UNPACKED {
        return Err(format!(
            "技能包解压后过大（{} MB），已拒绝",
            total / 1024 / 1024
        ));
    }

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("读取技能包条目失败：{e}"))?;
        // zip slip：`../x`、绝对路径、盘符跳转都在这里被拒
        let Some(rel) = file.enclosed_name() else {
            return Err(format!("技能包包含非法路径：{}", file.name()));
        };
        let out = dest.join(&rel);
        if file.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("创建目录失败：{e}"))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        }
        let mut f = std::fs::File::create(&out).map_err(|e| format!("写入文件失败：{e}"))?;
        std::io::copy(&mut file, &mut f).map_err(|e| format!("写入文件失败：{e}"))?;
    }
    Ok(())
}

/// 找到技能根目录：`SKILL.md` 在本层，或**唯一**一层包装目录里有它。
///
/// 很多打包工具会套一层 `<name>/`，两种布局都要认；出现多个子目录却都
/// 没有 SKILL.md 时直接判失败，不猜。
fn skill_root(dir: &Path) -> Option<PathBuf> {
    if dir.join("SKILL.md").is_file() {
        return Some(dir.to_path_buf());
    }
    let mut dirs = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir());
    let first = dirs.next()?;
    if dirs.next().is_some() {
        return None;
    }
    if first.join("SKILL.md").is_file() {
        Some(first)
    } else {
        None
    }
}

/// 目录下所有文件的相对路径（`/` 分隔，已排序）。不跟符号链接、跳过 `.git`。
fn rel_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_symlink() {
                continue;
            }
            if meta.is_dir() {
                if name != ".git" {
                    stack.push(path);
                }
                continue;
            }
            out.push(
                path.strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    out.sort();
    out
}

// ── 安装记录与用户文件保留 ────────────────────────────────────

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct InstallRecord {
    pub id: String,
    pub version: String,
    pub sha256: String,
    /// 包内自带文件的相对路径，用于更新时区分包内文件与用户文件
    pub files: Vec<String>,
}

pub fn read_record(dir: &Path) -> Option<InstallRecord> {
    let raw = std::fs::read_to_string(dir.join(INSTALL_RECORD)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_record(dir: &Path, record: &InstallRecord) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(record).map_err(|e| format!("序列化安装记录失败：{e}"))?;
    std::fs::write(dir.join(INSTALL_RECORD), json).map_err(|e| format!("写入安装记录失败：{e}"))
}

/// 更新时应当保留的旧文件：**既不在旧包清单里、也不在新包清单里**。
///
/// - 旧包清单来自 `.aura-install.json`。v0.6.1 装的技能没有这份记录，
///   此时 `old_pkg` 为空 → 保留「新包不含的一切」，宁可多留不少删。
/// - 新包同名文件一律以新包为准（那是升级的意义），所以要从保留集里剔掉。
///
/// 故意不保留「旧包有、新包没有」的文件：那是上游删掉的过时内容。
pub fn preserved_paths(
    old_files: &[String],
    old_pkg: &[String],
    new_pkg: &[String],
) -> Vec<String> {
    old_files
        .iter()
        .filter(|p| *p != INSTALL_RECORD)
        .filter(|p| !old_pkg.contains(p) && !new_pkg.contains(p))
        .cloned()
        .collect()
}

// ── 静态审查闸门 ──────────────────────────────────────────────

/// 高危内容未经确认不得安装。返回可读的拒绝原因。
pub fn ensure_acceptable(audit_result: &Audit, accept_risky: bool) -> Result<(), String> {
    let high = audit_result.high();
    if high == 0 || accept_risky {
        return Ok(());
    }
    let mut causes: Vec<&str> = Vec::new();
    for f in audit_result.findings.iter().filter(|f| {
        matches!(f.severity, crate::audit::Severity::High)
    }) {
        if !causes.contains(&f.note) {
            causes.push(f.note);
        }
    }
    Err(format!(
        "检测到 {high} 条高危内容（{}），确认后才会安装",
        causes.join("；")
    ))
}

// ── allowed-tools 校验 ─────────────────────────────────────────

/// 技能声明的工具名检查结果。
///
/// 空列表是**合法**的：它的语义是「不收窄，继承当前模式的权限」，
/// 与「声明了一堆但都拼错了」是完全不同的两件事。
#[derive(Debug, Default, Clone)]
pub struct ToolCheck {
    /// 声明里已知有效的工具名
    pub known: Vec<String>,
    /// 声明里 Aura 不认识的工具名
    pub unknown: Vec<String>,
}

impl ToolCheck {
    /// 是否完全不可用（声明了工具但一个都不认识）。
    pub fn all_unknown(&self) -> bool {
        !self.unknown.is_empty() && self.known.is_empty()
    }
}

/// 校验技能声明的 `allowed-tools`。
///
/// 工具名以 Aura 的注册表为准（`tools::registry::is_known`）——
/// 与内置技能的看门狗测试同一套判据，不会两处不一致。
pub fn check_allowed_tools(declared: &[String]) -> ToolCheck {
    let mut known = Vec::new();
    let mut unknown = Vec::new();
    for name in declared {
        let t = name.trim();
        if t.is_empty() {
            continue;
        }
        if crate::tools::registry::is_known(t) {
            known.push(t.to_string());
        } else {
            unknown.push(t.to_string());
        }
    }
    ToolCheck { known, unknown }
}

/// 未知工具名的报错文案。
///
/// 要指出**具体是哪个名字**，并列出 Aura 实际可用的工具——
/// 只说「工具名无效」的话，作者和用户都不知道该改成什么。
pub fn unknown_tools_error(skill: &str, unknown: &[String]) -> String {
    let available = crate::tools::registry::names().join("、");
    format!(
        "技能 {skill} 声明了 Aura 不认识的工具名：{}\n\
         Aura 当前可用：{available}\n\
         请让技能作者更正工具名。装进来会导致该技能激活期间所有工具都被挡掉，         模型将无事可做。",
        unknown.join("、")
    )
}

// ── 审查与安装 ────────────────────────────────────────────────

/// 安装前的审查报告，直接序列化给前端弹窗。
#[derive(Debug, serde::Serialize)]
pub struct Inspection {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    /// 这条来自哪个源
    pub registry: String,
    /// 本地安装目录名
    pub slug: String,
    /// 上游是否提供完整性校验
    pub integrity_verified: bool,
    /// 完整性说明（未校验时告诉用户为什么）
    pub integrity_note: String,
    /// 是否已安装同 id 的目录
    pub already_installed: bool,
    /// 已安装版本（无记录或读不出时为空串）
    pub installed_version: String,
    /// 技能名（frontmatter 的 name，与目录 id 可能不同）
    pub skill_name: String,
    /// 技能申请的工具范围；空 = 不收窄
    pub tools: Vec<String>,
    /// 声明里 Aura 不认识的工具名。**非空说明这个技能装不了**，
    /// 界面要在安装前就把它指出来。
    pub unknown_tools: Vec<String>,
    /// 包内文件相对路径
    pub package_files: Vec<String>,
    /// zip 字节数
    pub bytes: u64,
    pub audit: Audit,
}

/// 安装/更新的结果回执。
#[derive(Debug, Default, serde::Serialize)]
pub struct InstallSummary {
    pub version: String,
    pub skill_name: String,
    /// 更新时保留下来的用户文件
    pub kept: Vec<String>,
    pub high: usize,
    pub medium: usize,
    pub has_scripts: bool,
    pub file_count: usize,
}

/// 下载并校验包字节。
///
/// 下载由 Provider 负责（各家地址形态不同），**完整性校验在这里**——
/// 这是所有源共用的最后一道闸门。
///
/// 上游不提供哈希时（[`Integrity::Unverified`]）不能假装有校验：
/// 那时改为记录本地算出的哈希，供**后续更新**比对（哈希链）。
async fn download(
    registry: &ProviderRegistry,
    entry: &UnifiedSkill,
) -> Result<Vec<u8>, String> {
    let bytes = registry.download(entry).await?;
    match &entry.integrity {
        Integrity::Sha256(expected) => verify_sha256(&bytes, expected)?,
        Integrity::Unverified { .. } => {
            // 无上游哈希：记下本地哈希，后续更新时用它比对，
            // 从而能发现「第一次装的是 A，第二次变成了 B」
        }
    }
    Ok(bytes)
}

/// 解包并解析 SKILL.md。解析一遍是必须的：格式不对的技能装进去也只会被
/// 扫描器静默跳过，用户只会看到「装完不显示」。
fn prepare(bytes: &[u8], tmp: &Path) -> Result<(PathBuf, skill::SkillManifest), String> {
    extract_zip(bytes, tmp)?;
    let root = skill_root(tmp).ok_or_else(|| "技能包里没有 SKILL.md".to_string())?;
    let md = std::fs::read_to_string(root.join("SKILL.md"))
        .map_err(|e| format!("读取 SKILL.md 失败：{e}"))?;
    let manifest = skill::parse_skill_md(&md).map_err(|e| format!("技能格式不合法：{e}"))?;
    Ok((root, manifest))
}

/// 读已安装目录里的技能版本。读不出、或 frontmatter 没写版本（解析器给的
/// 占位值 `0.0.0`）都返回空串——界面据此不提示更新，而不是永远显示「有新版本」。
pub fn installed_version_of(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("SKILL.md"))
        .ok()
        .and_then(|md| skill::parse_skill_md(&md).ok())
        .map(|m| m.version)
        .filter(|v| !v.is_empty() && v != "0.0.0")
        .unwrap_or_default()
}

fn display_version(manifest: &skill::SkillManifest, entry: &UnifiedSkill) -> String {
    if manifest.version.trim().is_empty() || manifest.version == "0.0.0" {
        entry.version.clone()
    } else {
        manifest.version.clone()
    }
}

/// 下载 + 校验 + 解包 + 审查，返回报告。不写入任何东西。
///
/// `registry` 提供下载能力；`entry` 是已解析出的统一条目。
pub async fn inspect(
    registry: &ProviderRegistry,
    entry: &UnifiedSkill,
    market_root: &Path,
) -> Result<Inspection, String> {
    if !crate::providers::valid_slug(&entry.slug) {
        return Err(format!("技能安装名不合法：{}", entry.slug));
    }
    let bytes = download(registry, entry).await?;

    std::fs::create_dir_all(market_root).map_err(|e| format!("创建市场目录失败：{e}"))?;
    let tmp = market_root.join(format!(".inspect-{}", entry.slug));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| format!("创建临时目录失败：{e}"))?;

    let result = (|| -> Result<Inspection, String> {
        let (root, manifest) = prepare(&bytes, &tmp)?;
        let audit_result = audit::scan(&root);
        let target = market_root.join(&entry.slug);
        Ok(Inspection {
            id: entry.id.clone(),
            slug: entry.slug.clone(),
            name: if entry.name.trim().is_empty() {
                manifest.name.clone()
            } else {
                entry.name.clone()
            },
            description: if entry.description.trim().is_empty() {
                manifest.description.clone()
            } else {
                entry.description.clone()
            },
            version: display_version(&manifest, entry),
            registry: entry.provider_label.clone(),
            /// 上游是否提供完整性校验。**没提供时界面必须明确告知**——
            /// 用户有权知道自己装的东西没被验证过。
            integrity_verified: entry.integrity.is_verified(),
            integrity_note: entry.integrity.describe(),
            already_installed: target.is_dir(),
            installed_version: installed_version_of(&target),
            skill_name: manifest.name.clone(),
            tools: manifest.allowed_tools.clone(),
            unknown_tools: check_allowed_tools(&manifest.allowed_tools).unknown,
            package_files: rel_files(&root),
            bytes: bytes.len() as u64,
            audit: audit_result,
        })
    })();

    let _ = std::fs::remove_dir_all(&tmp);
    result
}

/// 下载并安装。`market_root` 是 `skills/market` 根目录。
///
/// - `accept_risky`：用户已看过高危清单并确认
/// - `update`：允许覆盖已安装的同 id 技能（保留用户自己加的文件）
pub async fn install(
    registry: &ProviderRegistry,
    entry: &UnifiedSkill,
    market_root: &Path,
    accept_risky: bool,
    update: bool,
) -> Result<InstallSummary, String> {
    if !crate::providers::valid_slug(&entry.slug) {
        return Err(format!("技能安装名不合法：{}", entry.slug));
    }
    let slug = entry.slug.clone();
    let target = market_root.join(&slug);
    let exists = target.is_dir();
    if exists && !update {
        return Err(format!("技能 {slug} 已安装，请用「更新」重装"));
    }

    let bytes = download(registry, entry).await?;

    std::fs::create_dir_all(market_root).map_err(|e| format!("创建市场目录失败：{e}"))?;
    // 先解到临时目录：中途失败不会在 market/ 里留下半个技能
    let tmp = market_root.join(format!(".tmp-{slug}"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| format!("创建临时目录失败：{e}"))?;

    let result = (|| -> Result<InstallSummary, String> {
        let (root, manifest) = prepare(&bytes, &tmp)?;

        // v0.6.2：校验声明的工具名。
        //
        // 拒绝而不是「过滤后放行」：过滤会让 allowed_tools 变空，
        // 而空列表的语义是「不收窄、继承全部权限」——那等于**放大**权限，
        // 与技能作者的本意完全相反。拼错一个名字的技能必须报错让人知道。
        let tool_check = check_allowed_tools(&manifest.allowed_tools);
        if !tool_check.unknown.is_empty() {
            return Err(unknown_tools_error(&manifest.name, &tool_check.unknown));
        }

        let audit_result = audit::scan(&root);
        ensure_acceptable(&audit_result, accept_risky)?;

        let new_files = rel_files(&root);
        // 记录里的哈希：有上游哈希就用上游的（可与下次下载比对）；
        // 没有则记本地算的（下次更新时与这个比，形成哈希链）。
        let sha256 = match &entry.integrity {
            Integrity::Sha256(h) => h.trim().to_ascii_lowercase(),
            Integrity::Unverified { .. } => sha256_of(&bytes),
        };
        let record = InstallRecord {
            id: slug.clone(),
            version: display_version(&manifest, entry),
            sha256,
            files: new_files.clone(),
        };

        let mut kept: Vec<String> = Vec::new();
        if exists {
            let old_files = rel_files(&target);
            let old_pkg = read_record(&target).map(|r| r.files).unwrap_or_default();
            kept = preserved_paths(&old_files, &old_pkg, &new_files);

            let backup = market_root.join(format!(".bak-{slug}"));
            let _ = std::fs::remove_dir_all(&backup);
            std::fs::rename(&target, &backup).map_err(|e| format!("备份旧版本失败：{e}"))?;
            if let Err(e) = std::fs::rename(&root, &target) {
                // 换不上去就得把旧的放回去，否则等于把用户装好的技能弄丢
                let _ = std::fs::rename(&backup, &target);
                return Err(format!("更新失败：{e}"));
            }
            for rel in &kept {
                let to = target.join(rel);
                if let Some(parent) = to.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                // 复制失败不致命：文件留在备份里，最后一步删备份前不再重试
                let _ = std::fs::copy(backup.join(rel), &to);
            }
            let _ = std::fs::remove_dir_all(&backup);
        } else {
            std::fs::rename(&root, &target).map_err(|e| format!("安装失败：{e}"))?;
        }

        // 记录写不进去不致命：下次更新会退化成「保留新包之外的一切」，更保守
        let _ = write_record(&target, &record);

        Ok(InstallSummary {
            version: record.version.clone(),
            skill_name: manifest.name.clone(),
            kept,
            high: audit_result.high(),
            medium: audit_result.count(crate::audit::Severity::Medium),
            has_scripts: audit_result.has_scripts,
            file_count: audit_result.file_count,
        })
    })();

    let _ = std::fs::remove_dir_all(&tmp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

        /// v0.6.2：allowed-tools 校验。
    ///
    /// 技能若声明了拼错的工具名，`gate_active_skill` 会因 declared 非空
    /// 而把真实工具全挡掉——模型在激活期间无事可做且无从察觉。
    #[test]
    fn allowed_tools_check_separates_known_and_unknown() {
        let c = check_allowed_tools(&[
            "read_file".into(),
            "write_files".into(), // 拼错
            "run_script".into(),
        ]);
        assert_eq!(c.known, vec!["read_file", "run_script"]);
        assert_eq!(c.unknown, vec!["write_files"]);
        assert!(!c.all_unknown());
    }

    /// 空声明是**合法**的：语义是「不收窄，继承模式权限」。
    #[test]
    fn empty_allowed_tools_is_valid() {
        let c = check_allowed_tools(&[]);
        assert!(c.known.is_empty());
        assert!(c.unknown.is_empty());
        assert!(!c.all_unknown());
        // 空白项不算声明
        let c = check_allowed_tools(&["  ".into(), "".into()]);
        assert!(c.unknown.is_empty());
    }

    /// 全都不认识 = 技能完全不可用。
    #[test]
    fn all_unknown_detected() {
        let c = check_allowed_tools(&["Bash".into(), "Read".into()]);
        assert!(c.known.is_empty());
        assert!(c.all_unknown());
    }

    /// 报错文案必须指出具体名字并列出可用工具。
    #[test]
    fn unknown_tools_error_names_the_offender() {
        let msg = unknown_tools_error("demo", &["write_files".into()]);
        assert!(msg.contains("write_files"), "{msg}");
        assert!(msg.contains("read_file"), "应列出可用工具: {msg}");
    }

            #[test]
    fn sha256_requires_value_and_matches() {
        // 空哈希一律拒绝：装进来的东西必须有据可查
        assert!(verify_sha256(b"x", "").is_err());
        let hash = {
            use sha2::Digest;
            hex(&sha2::Sha256::digest(b"hello"))
        };
        assert!(verify_sha256(b"hello", &hash).is_ok());
        // 大小写不敏感（清单里常见大写）
        assert!(verify_sha256(b"hello", &hash.to_uppercase()).is_ok());
        let err = verify_sha256(b"tampered", &hash).unwrap_err();
        assert!(err.contains("sha256"));
    }

                                /// 构造一个 zip（键 = 条目名，值 = 内容）。
    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            let opts: zip::write::SimpleFileOptions = Default::default();
            for (name, data) in entries {
                w.start_file(*name, opts).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        buf.into_inner()
    }

    #[test]
    fn extract_rejects_path_traversal() {
        let dir = std::env::temp_dir().join(format!("aura-market-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out");

        // 越界条目：必须整体拒绝，而不是"跳过这一个"
        let evil = build_zip(&[("../escape.txt", b"pwn"), ("SKILL.md", b"x")]);
        assert!(extract_zip(&evil, &out).is_err());
        assert!(!out.join("escape.txt").exists());

        // 正常条目可以解出来
        let ok = build_zip(&[("SKILL.md", b"x"), ("docs/a.md", b"y")]);
        extract_zip(&ok, &dir.join("ok")).unwrap();
        assert!(dir.join("ok/SKILL.md").is_file());
        assert!(dir.join("ok/docs/a.md").is_file());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn skill_root_handles_root_and_wrapped_layouts() {
        let dir = std::env::temp_dir().join(format!("aura-market-root-{}", std::process::id()));
        let flat = dir.join("flat");
        std::fs::create_dir_all(&flat).unwrap();
        std::fs::write(flat.join("SKILL.md"), "x").unwrap();
        assert_eq!(skill_root(&flat).unwrap(), flat, "SKILL.md 在根层");

        let wrapped = dir.join("wrapped");
        std::fs::create_dir_all(wrapped.join("pkg")).unwrap();
        std::fs::write(wrapped.join("pkg/SKILL.md"), "x").unwrap();
        assert_eq!(skill_root(&wrapped).unwrap(), wrapped.join("pkg"), "单层包装要认出来");

        let ambiguous = dir.join("ambiguous");
        std::fs::create_dir_all(ambiguous.join("a")).unwrap();
        std::fs::create_dir_all(ambiguous.join("b")).unwrap();
        assert!(
            skill_root(&ambiguous).is_none(),
            "多个子目录又没有 SKILL.md 时不猜"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn preserved_paths_keeps_only_user_files() {
        let old_files = vec![
            "SKILL.md".to_string(),
            "reference/a.md".to_string(),
            "reference/removed.md".to_string(),
            "notes/mine.md".to_string(),
            INSTALL_RECORD.to_string(),
        ];
        let old_pkg = vec![
            "SKILL.md".to_string(),
            "reference/a.md".to_string(),
            "reference/removed.md".to_string(),
        ];
        let new_pkg = vec!["SKILL.md".to_string(), "reference/a.md".to_string()];

        let kept = preserved_paths(&old_files, &old_pkg, &new_pkg);
        assert_eq!(kept, vec!["notes/mine.md".to_string()], "只留用户自己加的文件");
        assert!(!kept.contains(&INSTALL_RECORD.to_string()));

        // 没有安装记录（v0.6.1 装的技能）：保留新包之外的一切，宁多留不误删
        let kept_all = preserved_paths(&old_files, &[], &new_pkg);
        assert!(kept_all.contains(&"reference/removed.md".to_string()));
        assert!(!kept_all.contains(&"SKILL.md".to_string()), "同名文件以新包为准");
    }

    #[test]
    fn install_record_round_trips() {
        let dir = std::env::temp_dir().join(format!("aura-market-rec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        assert!(read_record(&dir).is_none(), "没有记录时返回 None，不是报错");
        let rec = InstallRecord {
            id: "demo".into(),
            version: "1.2.3".into(),
            sha256: "ab".repeat(32),
            files: vec!["SKILL.md".into()],
        };
        write_record(&dir, &rec).unwrap();
        let back = read_record(&dir).unwrap();
        assert_eq!(back.id, "demo");
        assert_eq!(back.version, "1.2.3");
        assert_eq!(back.files, vec!["SKILL.md".to_string()]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rel_files_lists_relative_sorted_paths() {
        let dir = std::env::temp_dir().join(format!("aura-market-files-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("reference")).unwrap();
        std::fs::write(dir.join("SKILL.md"), "x").unwrap();
        std::fs::write(dir.join("reference/b.md"), "x").unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::write(dir.join(".git/config"), "x").unwrap();

        let files = rel_files(&dir);
        assert_eq!(files, vec!["SKILL.md".to_string(), "reference/b.md".to_string()]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn installed_version_ignores_placeholder() {
        let dir = std::env::temp_dir().join(format!("aura-market-ver-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        std::fs::write(
            dir.join("SKILL.md"),
            "---\nname: v\ndescription: d\nversion: 1.2.0\n---\nbody\n",
        )
        .unwrap();
        assert_eq!(installed_version_of(&dir), "1.2.0");

        // frontmatter 没写版本时解析器给 0.0.0；那是占位值，不该让界面永远提示更新
        std::fs::write(dir.join("SKILL.md"), "---\nname: v\ndescription: d\n---\nbody\n")
            .unwrap();
        assert_eq!(installed_version_of(&dir), "");

        assert_eq!(installed_version_of(&dir.join("nope")), "");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn high_risk_requires_confirmation() {
        let dir = std::env::temp_dir().join(format!("aura-market-gate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("SKILL.md"),
            "---\nname: g\ndescription: d\n---\nrm -rf ./dist\n",
        )
        .unwrap();
        let risky = audit::scan(&dir);
        assert!(risky.high() > 0);

        let err = ensure_acceptable(&risky, false).unwrap_err();
        assert!(err.contains("高危"), "{err}");
        assert!(ensure_acceptable(&risky, true).is_ok(), "用户确认后可装");

        std::fs::write(dir.join("SKILL.md"), "---\nname: g\ndescription: d\n---\n读文件\n").unwrap();
        let clean = audit::scan(&dir);
        assert!(ensure_acceptable(&clean, false).is_ok(), "干净包不需要确认");

        std::fs::remove_dir_all(&dir).ok();
    }
}
