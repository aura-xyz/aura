//! SkillHub 源（v0.6.2）
//!
//! 第三方技能 hub：`skills.palebluedot.live`。
//!
//! ## 与官方源的三个根本差异
//!
//! | 维度 | 官方 registry | SkillHub |
//! |---|---|---|
//! | 完整性 | 清单带 sha256 | **不带**（响应头也没有 ETag） |
//! | id 形态 | `mcp-builder` | `owner/repo/path`（含斜杠与大写） |
//! | 清单规模 | 几十条，一次拉完 | **8 万条**，必须分页 + 搜索 |
//!
//! 这三点各自对应 [`providers::Integrity`]、[`providers::slugify`]、
//! 分页查询。没有 Provider 抽象的话，这三点会直接污染安装管线。
//!
//! ## 实测细节
//!
//! - 列表端点：`GET /api/skills?q=<关键词>&limit=&page=`
//!   —— 参数是 `q` 不是 `search`（后者返回 400）
//! - 详情端点：`GET /api/skills/{owner}/{repo}/{path}`
//! - 下载端点：`GET /api/skill-files/zip?id={owner}/{repo}/{path}`
//! - 包结构：`{skill-name}/SKILL.md`（顶层目录包裹，与官方包一致）

use super::http;
use super::{Integrity, ListPage, ListQuery, ProviderKind, SkillProvider, UnifiedSkill};
use std::time::Duration;

/// SkillHub 的站点根地址。
pub const BASE: &str = "https://skills.palebluedot.live";

/// 源标识。
pub const PROVIDER_ID: &str = "skillhub";

/// 展示名。
pub const LABEL: &str = "SkillHub";

/// 单次请求的超时。比官方源短一些：第三方源慢了就该让用户重试，
/// 不该让整个市场页等着。
const TIMEOUT: Duration = Duration::from_secs(15);

/// API 返回的一条技能。
///
/// 字段名照抄 API，不做重命名——Adapter 负责映射，这里保持「所见即所得」，
/// 便于对照官方文档核对。
#[derive(Debug, Clone, serde::Deserialize)]
pub struct HubEntry {
    /// `owner/repo/path`
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub github_owner: Option<String>,
    #[serde(default)]
    pub github_repo: Option<String>,
    #[serde(default)]
    pub skill_path: Option<String>,
    #[serde(default)]
    pub github_stars: Option<u64>,
    #[serde(default)]
    pub download_count: Option<u64>,
    /// 上游自评的安全分（0-100）
    #[serde(default)]
    pub security_score: Option<i64>,
    /// 上游自评的安全状态（pass / warn / fail）
    #[serde(default)]
    pub security_status: Option<String>,
    /// 上游标记的恶意与否
    #[serde(default)]
    pub is_malicious: Option<bool>,
    #[serde(default)]
    pub ai_score: Option<i64>,
    #[serde(default)]
    pub review_status: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct HubList {
    #[serde(default)]
    skills: Vec<HubEntry>,
    #[serde(default)]
    pagination: Option<HubPagination>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct HubPagination {
    #[serde(default)]
    page: usize,
    #[serde(default)]
    limit: usize,
    #[serde(default)]
    total: usize,
    /// API 用驼峰（`totalPages`），不是下划线。
    #[serde(default, rename = "totalPages")]
    total_pages: usize,
}

/// 把 Hub 条目映射成统一结构。
///
/// **纯函数**：不碰网络，可直接单测。
///
/// 上游的 `security_score` / `ai_score` 等自评数据**不参与**完整性判定——
/// 那是第三方的评分，不是 Aura 的结论。它只写进描述里供用户参考。
pub fn adapt_entry(entry: &HubEntry) -> UnifiedSkill {
    let slug = super::slugify(&entry.id);

    // 把上游自评信息附在描述后面，让用户在安装前能看到。
    let mut description = entry.description.trim().to_string();
    let mut notes: Vec<String> = Vec::new();
    if let Some(status) = &entry.security_status {
        if !status.is_empty() {
            notes.push(format!("上游安全状态：{status}"));
        }
    }
    if let Some(score) = entry.security_score {
        notes.push(format!("上游安全分：{score}"));
    }
    if entry.is_malicious == Some(true) {
        notes.push("上游标记为可疑内容".to_string());
    }
    if !notes.is_empty() {
        if !description.is_empty() {
            description.push('\n');
        }
        description.push_str(&notes.join("；"));
    }

    let author = match (&entry.github_owner, &entry.github_repo) {
        (Some(o), Some(r)) if !o.is_empty() && !r.is_empty() => format!("{o}/{r}"),
        _ => String::new(),
    };

    UnifiedSkill {
        id: entry.id.clone(),
        slug,
        name: entry.name.trim().to_string(),
        description,
        version: entry.version.clone().unwrap_or_default().trim().to_string(),
        tags: Vec::new(),
        author,
        // 关键：上游不提供包哈希。不能假装有——走 Unverified 更严的流程。
        integrity: Integrity::Unverified {
            reason: "SkillHub 不提供包的 sha256，无法验证完整性；安装前会做完整静态审查"
                .to_string(),
        },
        provider_id: PROVIDER_ID.to_string(),
        provider_label: LABEL.to_string(),
    }
}

/// SkillHub 源。
pub struct SkillHubProvider {
    base: String,
}

impl Default for SkillHubProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl SkillHubProvider {
    pub fn new() -> Self {
        Self {
            base: BASE.to_string(),
        }
    }

    fn client(&self) -> Result<reqwest::Client, String> {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(6))
            .timeout(TIMEOUT)
            .user_agent("aura-skill-market")
            .build()
            .map_err(|e| format!("初始化网络客户端失败：{e}"))
    }

    /// 列表地址。
    ///
    /// 参数是 `q` 而不是 `search`——实测 `search` 返回 400。
    fn list_url(&self, query: &ListQuery) -> String {
        let mut url = format!(
            "{}/api/skills?limit={}&page={}",
            self.base,
            query.limit(),
            query.page()
        );
        let q = query.query.trim();
        if !q.is_empty() {
            url.push_str("&q=");
            url.push_str(&urlencode(q));
        }
        url
    }

    /// 下载地址。
    fn zip_url(&self, id: &str) -> String {
        format!("{}/api/skill-files/zip?id={}", self.base, urlencode(id))
    }
}

/// 极简 URL 编码（只处理查询串里需要的字符）。
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[async_trait::async_trait]
impl SkillProvider for SkillHubProvider {
    fn id(&self) -> &str {
        PROVIDER_ID
    }

    fn label(&self) -> &str {
        LABEL
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::Hub
    }

    async fn list(&self, query: &ListQuery) -> Result<ListPage, String> {
        let client = self.client()?;
        let url = self.list_url(query);
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| http::describe_err(&e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status().as_u16()));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| http::describe_err(&e))?;
        let parsed: HubList =
            serde_json::from_slice(&bytes).map_err(|e| format!("清单格式不对：{e}"))?;
        let pagination = parsed.pagination.unwrap_or_default();
        Ok(ListPage {
            skills: parsed.skills.iter().map(adapt_entry).collect(),
            total: pagination.total,
            total_pages: pagination.total_pages,
            paged: true,
        })
    }

    async fn resolve(&self, id: &str) -> Result<UnifiedSkill, String> {
        let client = self.client()?;
        let url = format!("{}/api/skills/{}", self.base, id);
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| http::describe_err(&e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status().as_u16()));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| http::describe_err(&e))?;
        let entry: HubEntry =
            serde_json::from_slice(&bytes).map_err(|e| format!("条目格式不对：{e}"))?;
        Ok(adapt_entry(&entry))
    }

    async fn download(&self, skill: &UnifiedSkill) -> Result<Vec<u8>, String> {
        let client = self.client()?;
        let url = self.zip_url(&skill.id);
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| http::describe_err(&e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status().as_u16()));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| http::describe_err(&e))?;
        Ok(bytes.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> HubEntry {
        HubEntry {
            id: "K-Dense-AI/claude-scientific-skills/pydicom".into(),
            name: "pydicom".into(),
            description: "处理 DICOM 医学影像".into(),
            version: Some("1.0.0".into()),
            license: Some("MIT".into()),
            github_owner: Some("K-Dense-AI".into()),
            github_repo: Some("claude-scientific-skills".into()),
            skill_path: Some("scientific-skills/pydicom".into()),
            github_stars: Some(8698),
            download_count: Some(100),
            security_score: Some(100),
            security_status: Some("pass".into()),
            is_malicious: Some(false),
            ai_score: Some(66),
            review_status: Some("ai-reviewed".into()),
        }
    }

    /// Adapter 把 Hub 条目映射成统一结构。
    #[test]
    fn adapt_entry_maps_fields() {
        let u = adapt_entry(&entry());
        assert_eq!(u.id, "K-Dense-AI/claude-scientific-skills/pydicom");
        assert_eq!(u.name, "pydicom");
        assert_eq!(u.version, "1.0.0");
        assert_eq!(u.author, "K-Dense-AI/claude-scientific-skills");
        assert_eq!(u.provider_id, PROVIDER_ID);
        assert_eq!(u.provider_label, LABEL);
    }

    /// id 含斜杠与大写 → slug 必须被规范化成安全的目录名。
    #[test]
    fn adapt_entry_normalizes_slug() {
        let u = adapt_entry(&entry());
        assert_eq!(u.slug, "k-dense-ai-claude-scientific-skills-pydicom");
        assert!(super::super::valid_slug(&u.slug));
    }

    /// 上游不提供哈希 → 必须是 Unverified，不能假装有。
    #[test]
    fn adapt_entry_is_never_verified() {
        let u = adapt_entry(&entry());
        assert!(!u.integrity.is_verified());
        assert!(u.integrity.describe().contains("不提供"));
    }

    /// 上游自评信息写进描述，但**不参与**完整性判定。
    #[test]
    fn upstream_scores_are_informational_only() {
        let u = adapt_entry(&entry());
        assert!(u.description.contains("上游安全状态：pass"));
        assert!(u.description.contains("上游安全分：100"));
        // 判定仍然是未校验
        assert!(!u.integrity.is_verified());
    }

    /// 上游标记为恶意时，描述里必须出现提示。
    #[test]
    fn malicious_flag_is_surfaced() {
        let mut e = entry();
        e.is_malicious = Some(true);
        let u = adapt_entry(&e);
        assert!(u.description.contains("可疑"));
    }

    /// 列表地址：参数是 `q` 不是 `search`（实测 `search` 返回 400）。
    #[test]
    fn list_url_uses_q_parameter() {
        let p = SkillHubProvider::new();
        let q = ListQuery {
            query: "pdf".into(),
            page: 2,
            limit: 30,
        };
        let url = p.list_url(&q);
        assert!(url.contains("q=pdf"), "{url}");
        assert!(url.contains("page=2"), "{url}");
        assert!(url.contains("limit=30"), "{url}");
        assert!(!url.contains("search="), "{url}");
    }

    #[test]
    fn list_url_without_query_has_no_q() {
        let p = SkillHubProvider::new();
        let url = p.list_url(&ListQuery::default());
        assert!(!url.contains("q="), "{url}");
        assert!(url.contains("page=1"), "{url}");
    }

    #[test]
    fn zip_url_encodes_id() {
        let p = SkillHubProvider::new();
        let url = p.zip_url("K-Dense-AI/claude-scientific-skills/pydicom");
        assert!(url.starts_with("https://skills.palebluedot.live/api/skill-files/zip?id="));
        // 斜杠必须被编码
        assert!(!url["https://skills.palebluedot.live/api/skill-files/zip?id=".len()..]
            .contains('/'));
        assert!(url.contains("%2F"));
    }

    #[test]
    fn urlencode_handles_specials() {
        assert_eq!(urlencode("a b"), "a%20b");
        assert_eq!(urlencode("a/b"), "a%2Fb");
        assert_eq!(urlencode("a-b_c.d~e"), "a-b_c.d~e");
    }

    /// 解析真实形状的列表响应。
    #[test]
    fn parses_list_response() {
        let json = r#"{"skills":[{"id":"o/r/s","name":"n","description":"d"}],
            "pagination":{"page":1,"limit":2,"total":80381,"totalPages":40191}}"#;
        let parsed: HubList = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.skills.len(), 1);
        let p = parsed.pagination.unwrap();
        assert_eq!(p.total, 80381);
        assert_eq!(p.total_pages, 40191);
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// 真实拉一次 SkillHub 清单。
    ///
    /// 这条测试会走网络，因此**默认跳过**（`#[ignore]`）——
    /// 单元测试不该依赖外网。但它必须存在：Adapter 的字段名、
    /// 分页参数、id 形态这些只有对着真实 API 才能验证对错。
    ///
    /// 手工验证：`cargo test --lib live_tests -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn live_list_returns_entries() {
        let p = SkillHubProvider::new();
        let page = p
            .list(&ListQuery {
                query: String::new(),
                page: 1,
                limit: 5,
            })
            .await
            .expect("SkillHub 应可访问");
        assert!(!page.skills.is_empty(), "应有条目");
        assert!(page.paged);
        assert!(page.total > 0, "total 应有值，实际 {}", page.total);
        // slug 必须是合法的目录名
        for s in &page.skills {
            assert!(
                super::super::valid_slug(&s.slug),
                "slug 不合法: {}",
                s.slug
            );
        }
    }

    /// 真实下载一个技能包，确认 zip 结构与 SKILL.md 位置。
    #[tokio::test]
    #[ignore]
    async fn live_download_produces_valid_zip() {
        let p = SkillHubProvider::new();
        let page = p
            .list(&ListQuery {
                query: "pydicom".into(),
                page: 1,
                limit: 3,
            })
            .await
            .expect("SkillHub 应可访问");
        let skill = page.skills.first().expect("应有匹配条目");
        let bytes = p.download(skill).await.expect("应能下载");
        assert!(bytes.len() > 100, "包太小: {}", bytes.len());
        // 是 zip（PK 魔数）
        assert_eq!(&bytes[..2], b"PK");
    }
}
