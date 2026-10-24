//! 技能源的 Provider 抽象（v0.6.2）
//!
//! ## 为什么要有这一层
//!
//! v0.6.1 的市场只认一种源：GitHub 仓库里的 `recommended.json`。
//! 端点回退、id 规范化、清单解析全写在 `market.rs` 里，与安装管线
//! （校验 → 解压 → 审查 → 原子安装）混在一起。
//!
//! 接入第二个源（SkillHub）时这层混排就撑不住了：两家的清单格式不同、
//! 下载方式不同、id 形态不同，但**安装管线完全相同**——下载完都是
//! 一个 zip，解压、审查、落盘的逻辑一个字都不用改。
//!
//! 所以拆成两层：
//!
//! ```text
//! providers/     源相关：清单拉取、格式解析、id 规范化、下载
//! market.rs      安装管线：integrity 校验 → 安全解压 → 审查 → 原子安装 → 保留集
//! ```
//!
//! ## 统一数据结构
//!
//! 每个 Provider 的 Adapter 负责把**它自己的** API 响应映射成
//! [`UnifiedSkill`]。映射是纯函数——不碰网络、不碰文件系统，可直接单测。
//!
//! ## id 与 slug 的分离
//!
//! [`UnifiedSkill::id`] 是**远端** id（provider 内唯一，用于回查下载），
//! [`UnifiedSkill::slug`] 是**本地**安装目录名（全局唯一，仅安全字符）。
//!
//! 必须分开的原因：SkillHub 的 id 形如
//! `K-Dense-AI/claude-scientific-skills/pydicom`——含斜杠与大写字母，
//! 而安装目录名只允许 `[a-z0-9._-]` 且不能是路径穿越。
//!
//! ## 完整性凭据
//!
//! [`Integrity`] 区分「上游给了哈希」与「上游没给哈希」。
//! 没有哈希不等于可以跳过校验——那种源走更严的流程（见 `market.rs`）。

pub mod github;
pub mod http;
pub mod registry;
pub mod skillhub;

use std::path::PathBuf;

/// 完整性凭据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Integrity {
    /// 上游提供 sha256 —— 安装时强制比对，不符即中止
    Sha256(String),
    /// 上游不提供哈希 —— 走更严的流程：额外人工确认 + 本地哈希链
    Unverified {
        /// 为什么没有哈希（展示给用户看）
        reason: String,
    },
}

impl Integrity {
    /// 是否经过上游哈希校验。
    pub fn is_verified(&self) -> bool {
        matches!(self, Integrity::Sha256(_))
    }

    /// sha256 值（若有）。
    pub fn sha256(&self) -> Option<&str> {
        match self {
            Integrity::Sha256(h) => Some(h),
            Integrity::Unverified { .. } => None,
        }
    }

    /// 面向用户的说明。
    pub fn describe(&self) -> String {
        match self {
            Integrity::Sha256(_) => "来源提供完整性校验（sha256）".to_string(),
            Integrity::Unverified { reason } => reason.clone(),
        }
    }
}

/// 统一的技能条目 —— Aura 内部唯一的市场数据结构。
///
/// 所有 Provider 的 Adapter 都必须映射到这个结构。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnifiedSkill {
    /// 远端 id：provider 内唯一，用于回查下载。
    /// SkillHub 形如 `owner/repo/path`。
    pub id: String,
    /// 本地安装目录名：全局唯一，仅 `[a-z0-9._-]`。
    pub slug: String,
    /// 展示名
    pub name: String,
    pub description: String,
    pub version: String,
    pub tags: Vec<String>,
    pub author: String,
    /// 完整性凭据
    pub integrity: Integrity,
    /// 来源标识（"official" / "github:owner/repo" / "skillhub"）
    pub provider_id: String,
    /// 来源展示名
    pub provider_label: String,
}

impl UnifiedSkill {
    /// 显示用的名字：没有名字就用 id。
    pub fn display_name(&self) -> &str {
        if self.name.trim().is_empty() {
            &self.id
        } else {
            &self.name
        }
    }
}

/// Provider 的类别。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    /// 官方源
    Official,
    /// 用户添加的 GitHub 仓库
    GitHub,
    /// 第三方 Hub（SkillHub）
    Hub,
}

impl ProviderKind {
    /// 面向用户的标签。
    pub fn label(&self) -> &'static str {
        match self {
            ProviderKind::Official => "官方",
            ProviderKind::GitHub => "GitHub",
            ProviderKind::Hub => "第三方",
        }
    }
}

/// 一页清单的查询参数。
#[derive(Debug, Clone, Default)]
pub struct ListQuery {
    /// 关键词。空 = 不筛选
    pub query: String,
    /// 页码（从 1 开始）
    pub page: usize,
    /// 每页条数
    pub limit: usize,
}

impl ListQuery {
    pub fn page(&self) -> usize {
        self.page.max(1)
    }

    pub fn limit(&self) -> usize {
        self.limit.clamp(1, 100)
    }
}

/// 清单查询结果。
#[derive(Debug, Default)]
pub struct ListPage {
    /// 条目
    pub skills: Vec<UnifiedSkill>,
    /// 总条数（源若不提供则为 0）
    pub total: usize,
    /// 总页数（源若不提供则为 0）
    pub total_pages: usize,
    /// 该源不支持分页（一次性返回全部）
    pub paged: bool,
}

/// 技能源提供者。
///
/// 抽成 trait 而不是枚举，是为了让「加一个新源」变成「写一个新文件 +
/// 在注册表里挂一行」，而不是「改一个巨大的 match」。
///
/// 方法是异步的：清单拉取与包下载都是网络操作。`async-trait` 让 trait
/// 保持 `dyn` 兼容（能装进 `Vec<Box<dyn SkillProvider>>`），
/// 而该 crate 已在依赖树里，声明为直接依赖不增加编译量。
#[async_trait::async_trait]
pub trait SkillProvider: Send + Sync {
    /// 稳定标识（存库用）
    fn id(&self) -> &str;
    /// 展示名
    fn label(&self) -> &str;
    /// 类别
    fn kind(&self) -> ProviderKind;
    /// 是否可由用户删除（官方源不可）
    fn removable(&self) -> bool {
        true
    }
    /// 拉取清单。
    ///
    /// `query` 对不支持搜索的源应被忽略（一次性返回全部）。
    async fn list(&self, query: &ListQuery) -> Result<ListPage, String>;
    /// 按远端 id 取单条
    async fn resolve(&self, id: &str) -> Result<UnifiedSkill, String>;
    /// 下载包字节。安装管线的其余部分由 `market.rs` 复用。
    async fn download(&self, skill: &UnifiedSkill) -> Result<Vec<u8>, String>;
}

/// 把远端 id 规范化为本地安装目录名（slug）。
///
/// 规则：
/// 1. 按 `/` 拆段，全部小写
/// 2. 非 `[a-z0-9]` 替换为 `-`，合并连续 `-`，去掉首尾 `-`
/// 3. 空结果回落 `skill`
/// 4. 超过 48 字符则截断并追加 6 位哈希（保证不同远端 id 不撞名）
///
/// **不保证全局唯一**——两个不同远端 id 可能规范化成同一个 slug。
/// 那种情况由安装时的「目标已存在」检查挡住（报错而非覆盖）。
pub fn slugify(remote_id: &str) -> String {
    let mut out = String::with_capacity(remote_id.len());
    for seg in remote_id.split('/') {
        if !out.is_empty() {
            out.push('-');
        }
        for ch in seg.chars() {
            if ch.is_ascii_alphanumeric() {
                out.push(ch.to_ascii_lowercase());
            } else {
                out.push('-');
            }
        }
    }
    // 合并连续 '-'
    let mut collapsed = String::with_capacity(out.len());
    let mut prev_dash = false;
    for ch in out.chars() {
        if ch == '-' {
            if !prev_dash {
                collapsed.push(ch);
            }
            prev_dash = true;
        } else {
            collapsed.push(ch);
            prev_dash = false;
        }
    }
    let mut slug = collapsed.trim_matches('-').to_string();
    if slug.is_empty() {
        slug = "skill".to_string();
    }
    if slug.len() > 48 {
        slug.truncate(48);
        // truncate 可能切在横线中间，尾部要去掉再补分隔符，
        // 否则会出现 "abc--123456" 这种双横线
        slug = slug.trim_end_matches('-').to_string();
        slug.push('-');
        slug.push_str(&short_hash(remote_id));
    }
    slug
}

/// 远端 id 的 6 位短哈希（用于 slug 冲突消解）。
pub fn short_hash(input: &str) -> String {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(input.as_bytes());
    hex(&digest)[..6].to_string()
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// 目录名的安全字符校验（安装前最后一道）。
pub fn valid_slug(slug: &str) -> bool {
    if slug.is_empty() || slug.len() > 64 {
        return false;
    }
    let first = slug.chars().next().unwrap();
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return false;
    }
    slug.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

/// 安装目录名（供 `market.rs` 使用）。
pub fn install_dir(root: &std::path::Path, slug: &str) -> PathBuf {
    root.join(slug)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_handles_skillhub_ids() {
        // SkillHub 的真实 id 形态
        assert_eq!(
            slugify("K-Dense-AI/claude-scientific-skills/pydicom"),
            "k-dense-ai-claude-scientific-skills-pydicom"
        );
    }

    #[test]
    fn slugify_lowercases_and_replaces() {
        assert_eq!(slugify("Owner/Repo Name"), "owner-repo-name");
        assert_eq!(slugify("a//b"), "a-b");
        assert_eq!(slugify("Foo__Bar"), "foo-bar");
    }

    #[test]
    fn slugify_falls_back_for_empty() {
        assert_eq!(slugify(""), "skill");
        assert_eq!(slugify("///"), "skill");
        assert_eq!(slugify("---"), "skill");
    }

    #[test]
    fn slugify_truncates_long_ids() {
        let long = format!("{}/{}", "a".repeat(60), "b".repeat(60));
        let slug = slugify(&long);
        assert!(slug.len() <= 55, "太长了: {}", slug.len());
        assert!(slug.ends_with(&short_hash(&long)));
    }

    #[test]
    fn slugify_is_deterministic() {
        let id = "K-Dense-AI/claude-scientific-skills/pydicom";
        assert_eq!(slugify(id), slugify(id));
    }

    #[test]
    fn valid_slug_rejects_unsafe() {
        assert!(valid_slug("demo"));
        assert!(valid_slug("a1-b_c.d"));
        assert!(!valid_slug(""));
        assert!(!valid_slug(".hidden"));
        assert!(!valid_slug("Upper"));
        assert!(!valid_slug("has space"));
        assert!(!valid_slug("has/slash"));
        assert!(!valid_slug(&"a".repeat(65)));
    }

    #[test]
    fn integrity_reports_verification_state() {
        let v = Integrity::Sha256("abc".into());
        assert!(v.is_verified());
        assert_eq!(v.sha256(), Some("abc"));

        let u = Integrity::Unverified {
            reason: "上游不提供哈希".into(),
        };
        assert!(!u.is_verified());
        assert_eq!(u.sha256(), None);
        assert!(u.describe().contains("不提供哈希"));
    }
}
