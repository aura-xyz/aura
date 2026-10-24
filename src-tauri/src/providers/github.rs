//! GitHub registry 源（v0.6.2）
//!
//! 承接 v0.6.1 的全部官方源逻辑：raw → jsDelivr → Contents API 三级回退、
//! `recommended.json` 解析、仓库地址归一化、CDN 镜像。
//!
//! 行为与 v0.6.1 **完全一致**——只是从 `market.rs` 搬到了 Provider 层，
//! 让 `market.rs` 只剩安装管线。

use super::http;
use super::{Integrity, ListPage, ListQuery, ProviderKind, SkillProvider, UnifiedSkill};
/// 官方源在界面上的名字。合并时按名字区分来源。
pub const OFFICIAL_NAME: &str = "官方";

const REPO_RAW: &str = "https://raw.githubusercontent.com/aura-xyz/aura-skill-registry/main/";
const REPO_CDN: &str = "https://cdn.jsdelivr.net/gh/aura-xyz/aura-skill-registry@main/";
pub const REGISTRY_JSON: &str = "recommended.json";

/// 一个注册表来源。`url` 已归一化为 raw 基址（末尾带 `/`）。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RegistrySource {
    pub name: String,
    pub url: String,
}

pub fn official_source() -> RegistrySource {
    RegistrySource {
        name: OFFICIAL_NAME.to_string(),
        url: REPO_RAW.to_string(),
    }
}

/// 合法的一段仓库路径（owner 或 repo）。
fn valid_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s != "."
        && s != ".."
        && !s.starts_with('.')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// 把用户输入的 GitHub 仓库地址归一化成 raw 基址。
///
/// 只认 `github.com/<owner>/<repo>`：raw 路径是可以推导的，而 GitLab / Gitee
/// 的 raw 规则各不相同，硬猜只会得到「装了但拉不到」的困惑。
pub fn normalize_repo(input: &str) -> Result<String, String> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err("仓库地址不能为空".into());
    }
    if raw.chars().any(|c| c.is_whitespace()) {
        return Err("仓库地址不能包含空格".into());
    }
    let no_scheme = raw
        .strip_prefix("https://")
        .or_else(|| raw.strip_prefix("http://"))
        .unwrap_or(raw);
    let path = no_scheme
        .strip_prefix("github.com/")
        .ok_or("目前只支持 GitHub 仓库，请填 github.com/owner/repo")?;
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);

    let mut parts = path.split('/');
    let owner = parts.next().unwrap_or("");
    let repo = parts.next().unwrap_or("");
    if parts.next().is_some() {
        return Err("请填仓库根地址，不要带 /tree、/blob 之类的子路径".into());
    }
    if !valid_segment(owner) || !valid_segment(repo) {
        return Err("仓库地址格式应为 github.com/owner/repo".into());
    }
    Ok(format!(
        "https://raw.githubusercontent.com/{owner}/{repo}/HEAD/"
    ))
}

/// 从用户输入里取出仓库名，作为源的展示名。
pub fn repo_label(input: &str) -> Result<String, String> {
    let raw = input.trim().trim_end_matches('/');
    let raw = raw.strip_suffix(".git").unwrap_or(raw);
    let name = raw.rsplit('/').next().unwrap_or("").trim();
    if !valid_segment(name) {
        return Err("无法从地址里取出仓库名".into());
    }
    Ok(name.to_string())
}

/// raw 基址 → GitHub Contents API 地址。
///
/// 给「raw 与 CDN 都不通」准备的第三条路：`api.github.com` 是另一台主机，
/// 国内加速规则基本都覆盖它，而 raw 与 jsDelivr 未必。
/// 代价是 60 次/小时的无鉴权限额，所以**只当兜底**。
fn api_contents_url(raw_base: &str) -> Option<String> {
    let rest = raw_base.strip_prefix("https://raw.githubusercontent.com/")?;
    let mut parts = rest.split('/');
    let owner = parts.next().filter(|s| !s.is_empty())?;
    let repo = parts.next().filter(|s| !s.is_empty())?;
    Some(format!(
        "https://api.github.com/repos/{owner}/{repo}/contents/{REGISTRY_JSON}"
    ))
}

/// 只把**自家**仓库的 raw 地址改写到 jsDelivr。
///
/// 第三方 URL 原样透传——否则市场就成了任意地址代理。
fn mirror(url: &str) -> Option<String> {
    let rest = url.strip_prefix(REPO_RAW)?;
    Some(format!("{REPO_CDN}{rest}"))
}

/// 某来源的**快线**候选地址：并发抢答。
///
/// Contents API 不在其中——它有 60 次/小时的无鉴权限额，不能每次开市场都打一遍。
fn registry_urls(src: &RegistrySource) -> Vec<String> {
    let mut urls = vec![format!("{}{}", src.url, REGISTRY_JSON)];
    if src.url.ends_with("/HEAD/") {
        // HEAD 是默认分支的别名；个别代理会改写它，补一条 main 兜底
        urls.push(format!(
            "{}main/{}",
            src.url.trim_end_matches("HEAD/"),
            REGISTRY_JSON
        ));
    }
    if let Some(m) = mirror(&urls[0]) {
        urls.push(m);
    }
    urls
}

/// Contents API 把文件内容 base64 塞在 JSON 里，这里还原成原始字节。
fn decode_contents_api(bytes: &[u8]) -> Result<Vec<u8>, String> {
    #[derive(serde::Deserialize)]
    struct Contents {
        content: String,
        #[serde(default)]
        encoding: String,
    }
    let parsed: Contents =
        serde_json::from_slice(bytes).map_err(|e| format!("清单响应不是文件内容：{e}"))?;
    if !parsed.encoding.is_empty() && parsed.encoding != "base64" {
        return Err(format!("不支持的内容编码：{}", parsed.encoding));
    }
    let raw: String = parsed.content.chars().filter(|c| !c.is_whitespace()).collect();
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(raw.as_bytes())
        .map_err(|e| format!("清单内容解码失败：{e}"))
}

/// 清单里的一条（registry 格式）。
#[derive(Debug, Clone, serde::Deserialize)]
struct RegistryEntry {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    version: String,
    /// 技能包 zip 地址：绝对 https，或相对注册表基址的路径
    source: String,
    /// zip 的 sha256。缺省即拒绝安装
    #[serde(default)]
    sha256: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    author: String,
}

#[derive(Debug, Default, serde::Deserialize)]
struct Registry {
    #[serde(default)]
    skills: Vec<RegistryEntry>,
}

/// 把 registry 条目映射成统一结构。
///
/// **纯函数**：不碰网络、不碰文件系统，可直接单测。
fn adapt_entry(entry: &RegistryEntry, src: &RegistrySource) -> UnifiedSkill {
    let slug = super::slugify(&entry.id);
    UnifiedSkill {
        id: entry.id.clone(),
        slug,
        name: entry.name.clone(),
        description: entry.description.clone(),
        version: entry.version.clone(),
        tags: entry.tags.clone(),
        author: entry.author.clone(),
        integrity: if entry.sha256.trim().is_empty() {
            Integrity::Unverified {
                reason: "该来源的清单没有提供 sha256，无法验证包完整性".into(),
            }
        } else {
            Integrity::Sha256(entry.sha256.trim().to_ascii_lowercase())
        },
        provider_id: format!("github:{}", src.name),
        provider_label: src.name.clone(),
    }
}

/// registry 格式的 id 白名单。
///
/// 只接受 `[a-z0-9._-]`，且长度受限——id 同时是安装目录名，
/// 不能是路径穿越。
pub fn valid_id(id: &str) -> bool {
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

/// 把清单里的 `source` 解析成绝对下载地址。
///
/// 只接受 **https 绝对地址** 或 **相对注册表基址的纯路径**。挡住两类事故：
/// 注册表塞一个 `file://` / 本地盘路径，或者塞 `http://` 明文地址
/// （下载的可是即将被执行的脚本）。
pub fn resolve_source(base: &str, source: &str) -> Result<String, String> {
    let s = source.trim();
    if s.is_empty() {
        return Err("清单条目缺少 source".into());
    }
    if let Some(rest) = s.strip_prefix("https://") {
        if rest.is_empty() {
            return Err(format!("技能包地址不完整：{s}"));
        }
        return Ok(s.to_string());
    }
    if s.contains("://") {
        return Err(format!("技能包地址必须是 https：{s}"));
    }
    if s.starts_with('/') || s.starts_with('\\') || s.contains('\\') || s.contains("..") {
        return Err(format!("技能包路径不合法：{s}"));
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'))
    {
        return Err(format!("技能包路径含非法字符：{s}"));
    }
    Ok(format!("{base}{s}"))
}

/// GitHub registry 源。
pub struct GitHubProvider {
    src: RegistrySource,
    /// 官方源不可删
    official: bool,
}

impl GitHubProvider {
    pub fn new(src: RegistrySource) -> Self {
        let official = src.url == REPO_RAW;
        Self { src, official }
    }

    /// 拉取并解析清单（原始 registry 条目，保留 `source` 供下载用）。
    async fn fetch_registry(&self) -> Result<Vec<RegistryEntry>, String> {
        let urls = registry_urls(&self.src);
        // 清单只有几 KB，直接并发抢答；失败原因汇总成「连接超时 / HTTP 404」这种短句
        let bytes = match http::fetch_race(&urls).await {
            Ok(b) => b,
            // 快线全挂才动 Contents API：它是另一台主机（国内加速多覆盖），
            // 但有限额，不能当常规通道用
            Err(first) => match api_contents_url(&self.src.url) {
                Some(api) => match http::fetch_first(&[api]).await {
                    Ok(b) => b,
                    Err(second) => return Err(format!("{first} / {second}")),
                },
                None => return Err(first),
            },
        };
        let parsed: Registry =
            serde_json::from_slice(&bytes).map_err(|e| format!("清单格式不对：{e}"))?;
        Ok(parsed.skills)
    }

    /// 条目的包下载地址。
    fn download_urls(&self, entry: &RegistryEntry) -> Result<Vec<String>, String> {
        let primary = resolve_source(&self.src.url, &entry.source)?;
        let mut urls = vec![primary.clone()];
        if let Some(m) = mirror(&primary) {
            urls.push(m);
        }
        Ok(urls)
    }
}

#[async_trait::async_trait]
impl SkillProvider for GitHubProvider {
    fn id(&self) -> &str {
        if self.official {
            "official"
        } else {
            &self.src.name
        }
    }

    fn label(&self) -> &str {
        &self.src.name
    }

    fn kind(&self) -> ProviderKind {
        if self.official {
            ProviderKind::Official
        } else {
            ProviderKind::GitHub
        }
    }

    fn removable(&self) -> bool {
        !self.official
    }

    /// registry 是一次性返回全部的，不支持分页也不支持搜索。
    async fn list(&self, _query: &ListQuery) -> Result<ListPage, String> {
        let entries = self.fetch_registry().await?;
        let skills = entries
            .iter()
            .filter(|e| valid_id(&e.id))
            .map(|e| adapt_entry(e, &self.src))
            .collect();
        Ok(ListPage {
            skills,
            total: 0,
            total_pages: 0,
            paged: false,
        })
    }

    async fn resolve(&self, id: &str) -> Result<UnifiedSkill, String> {
        if !valid_id(id) {
            return Err(format!("技能 id 不合法：{id}"));
        }
        let entries = self.fetch_registry().await?;
        entries
            .iter()
            .find(|e| e.id == id)
            .map(|e| adapt_entry(e, &self.src))
            .ok_or_else(|| format!("市场清单里没有技能 {id}，请刷新后重试"))
    }

    async fn download(&self, skill: &UnifiedSkill) -> Result<Vec<u8>, String> {
        // 重新取一次清单拿到 `source`——不信任前端传来的地址。
        let entries = self.fetch_registry().await?;
        let entry = entries
            .iter()
            .find(|e| e.id == skill.id)
            .ok_or_else(|| format!("市场清单里没有技能 {}，请刷新后重试", skill.id))?;
        let urls = self.download_urls(entry)?;
        http::download_bytes(&urls).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mirror_rewrites_only_our_registry() {
        let ours = format!("{REPO_RAW}skills/x.zip");
        assert_eq!(mirror(&ours).unwrap(), format!("{REPO_CDN}skills/x.zip"));
        // 第三方地址不改写：镜像别人既没必要也不安全
        assert!(mirror("https://example.com/x.zip").is_none());
    }

    #[test]
    fn valid_id_is_strict() {
        assert!(valid_id("mcp-builder"));
        assert!(valid_id("a1"));
        // 目录名不能以点开头（隐藏目录会被扫描器跳过）
        assert!(!valid_id(".hidden"));
        assert!(!valid_id("Upper"));
        assert!(!valid_id("has space"));
        assert!(!valid_id("has/slash"));
        assert!(!valid_id(""));
        assert!(!valid_id(&"a".repeat(65)));
    }

    /// 接受的地址形态。**注意不含裸 `owner/repo`**——
    /// 那样无法区分「用户想填仓库」与「填了别的东西」，宁可要求写全。
    #[test]
    fn normalize_repo_accepts_common_forms() {
        for input in [
            "https://github.com/owner/repo",
            "https://github.com/owner/repo/",
            "https://github.com/owner/repo.git",
            "http://github.com/owner/repo",
            "github.com/owner/repo",
            "  https://github.com/owner/repo  ",
        ] {
            let out = normalize_repo(input).expect(input);
            assert_eq!(out, "https://raw.githubusercontent.com/owner/repo/HEAD/");
        }
    }

    #[test]
    fn normalize_repo_rejects_non_github_and_subpaths() {
        // 非 GitHub 托管不支持（raw 路径规则不同，不能瞎拼）
        assert!(normalize_repo("https://gitlab.com/owner/repo").is_err());
        assert!(normalize_repo("https://gitee.com/owner/repo").is_err());
        // 裸 owner/repo 不接受
        assert!(normalize_repo("owner/repo").is_err());
        // 带子路径不是仓库根
        assert!(normalize_repo("https://github.com/owner/repo/tree/main").is_err());
        assert!(normalize_repo("").is_err());
        assert!(normalize_repo("https://github.com/owner").is_err());
        assert!(normalize_repo("https://github.com/../etc").is_err());
        assert!(normalize_repo("https://github.com/ow ner/repo").is_err());
    }

    #[test]
    fn repo_label_extracts_name() {
        assert_eq!(repo_label("https://github.com/owner/repo").unwrap(), "repo");
        assert_eq!(repo_label("owner/repo.git").unwrap(), "repo");
    }

    #[test]
    fn resolve_source_rejects_unsafe() {
        assert!(resolve_source("https://x/", "skills/a.zip").is_ok());
        assert!(resolve_source("https://x/", "https://y/a.zip").is_ok());
        // 明文 http
        assert!(resolve_source("https://x/", "http://y/a.zip").is_err());
        // 本地路径与穿越
        assert!(resolve_source("https://x/", "file:///c:/a.zip").is_err());
        assert!(resolve_source("https://x/", "../a.zip").is_err());
        assert!(resolve_source("https://x/", "/a.zip").is_err());
    }

    /// Adapter 是纯函数：registry 条目 → 统一结构。
    #[test]
    fn adapt_entry_maps_fields() {
        let entry = RegistryEntry {
            id: "demo-skill".into(),
            name: "示例技能".into(),
            description: "说明".into(),
            version: "1.2.0".into(),
            source: "skills/demo.zip".into(),
            sha256: "ABCDEF".into(),
            tags: vec!["demo".into()],
            author: "aura".into(),
        };
        let src = official_source();
        let u = adapt_entry(&entry, &src);
        assert_eq!(u.id, "demo-skill");
        assert_eq!(u.slug, "demo-skill");
        assert_eq!(u.name, "示例技能");
        assert_eq!(u.version, "1.2.0");
        assert_eq!(u.provider_label, OFFICIAL_NAME);
        // 哈希统一小写
        assert_eq!(u.integrity, Integrity::Sha256("abcdef".into()));
    }

    /// 清单没给哈希 → 标记为未校验（走更严的流程），而不是假装有。
    #[test]
    fn adapt_entry_marks_missing_hash_as_unverified() {
        let entry = RegistryEntry {
            id: "demo".into(),
            name: String::new(),
            description: String::new(),
            version: String::new(),
            source: "skills/demo.zip".into(),
            sha256: String::new(),
            tags: vec![],
            author: String::new(),
        };
        let u = adapt_entry(&entry, &official_source());
        assert!(!u.integrity.is_verified());
    }

    /// 官方源不可删；用户添加的 GitHub 源可删。
    #[test]
    fn official_source_is_not_removable() {
        let official = GitHubProvider::new(official_source());
        assert!(!official.removable());
        assert_eq!(official.kind(), ProviderKind::Official);

        let custom = GitHubProvider::new(RegistrySource {
            name: "team".into(),
            url: "https://raw.githubusercontent.com/team/skills/HEAD/".into(),
        });
        assert!(custom.removable());
        assert_eq!(custom.kind(), ProviderKind::GitHub);
    }

    /// 解码 Contents API 的 base64 响应。
    #[test]
    fn decode_contents_api_unwraps_base64() {
        let json = r#"{"name":"recommended.json","encoding":"base64","content":"eyJza2lsbHMiOltdfQ=="}"#;
        assert_eq!(decode_contents_api(json.as_bytes()).unwrap(), b"{\"skills\":[]}");
        let wrapped = r#"{"encoding":"base64","content":"eyJza2ls\nbHMiOltdfQ=="}"#;
        assert_eq!(decode_contents_api(wrapped.as_bytes()).unwrap(), b"{\"skills\":[]}");
        assert!(decode_contents_api(br#"{"message":"Not Found"}"#).is_err());
        assert!(decode_contents_api(b"not json").is_err());
    }
}
