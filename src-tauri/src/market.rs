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

const REPO_RAW: &str = "https://raw.githubusercontent.com/aura-xyz/aura-skill-registry/main/";
const REPO_CDN: &str = "https://cdn.jsdelivr.net/gh/aura-xyz/aura-skill-registry@main/";
const REGISTRY_JSON: &str = "recommended.json";

/// 官方源在界面上的名字。合并时按名字区分来源。
pub const OFFICIAL_NAME: &str = "官方";

/// 安装记录文件名。放在技能目录里，记下「这个包自带哪些文件」——
/// 更新时据此区分「包内文件该被替换」与「用户自己加的文件要保留」。
pub const INSTALL_RECORD: &str = ".aura-install.json";

/// 单个技能包解压后的大小上限。技能是纯文本 + 少量脚本，20MB 已很宽松。
const MAX_UNPACKED: u64 = 20 * 1024 * 1024;

// ── 注册表来源 ────────────────────────────────────────────────

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
/// 的 raw 规则各不相同，硬猜只会得到「装了但拉不到」的困惑。要支持别的托管
/// 得先有一套按托管方分派的规则表，不在本次范围。
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
/// 这是给「raw 与 CDN 都不通」准备的第三条路：`api.github.com` 是另一台主机，
/// 国内加速规则（hosts / Watt Toolkit 之类）基本都覆盖它，而 raw 与 jsDelivr
/// 未必。代价是它有 60 次/小时的无鉴权限额，所以**只当兜底**，排最后。
fn api_contents_url(raw_base: &str) -> Option<String> {
    let rest = raw_base.strip_prefix("https://raw.githubusercontent.com/")?;
    let mut parts = rest.split('/');
    let owner = parts.next().filter(|s| !s.is_empty())?;
    let repo = parts.next().filter(|s| !s.is_empty())?;
    Some(format!(
        "https://api.github.com/repos/{owner}/{repo}/contents/{REGISTRY_JSON}"
    ))
}

/// 某来源的**快线**候选地址：并发抢答，全是常规 CDN / 静态托管。
///
/// Contents API 不在其中——它有 60 次/小时的无鉴权限额，不能每次开市场都打一遍。
fn registry_urls(src: &RegistrySource) -> Vec<String> {
    let mut urls = vec![format!("{}{}", src.url, REGISTRY_JSON)];
    if src.url.ends_with("/HEAD/") {
        // HEAD 是默认分支的别名；个别代理会改写它，补一个 main 兜底
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

// ── 清单 ──────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Deserialize)]
pub struct MarketSkill {
    /// 安装目录名，同时是清单里的唯一键
    pub id: String,
    /// 展示名（可为中文），与技能 frontmatter 的 name 无关
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    /// 技能包 zip 地址：绝对 https，或相对注册表基址的路径
    pub source: String,
    /// zip 的 sha256（十六进制，大小写不敏感）。缺省即拒绝安装
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub author: String,
    /// 这条来自哪个源（展示用）。由 [`fetch_all`] 回填，不在清单里
    #[serde(skip)]
    pub registry: String,
    /// 注册表基址，用于把相对 `source` 拼成绝对地址
    #[serde(skip)]
    pub registry_url: String,
}

#[derive(Debug, Default, serde::Deserialize)]
struct Registry {
    #[serde(default)]
    skills: Vec<MarketSkill>,
}

/// 多源合并的结果：条目 + 每个源各自的失败原因。
#[derive(Debug, Default)]
pub struct RegistryFetch {
    pub skills: Vec<MarketSkill>,
    pub errors: Vec<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // 6 秒连不上基本可以判定这条线路不通（国内访问 raw 常被阻断）。
        // 界面里这是「点开市场就转圈」的那一段，宁可早失败早换线路。
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(20))
        .user_agent("aura-skill-market")
        .build()
        .map_err(|e| format!("初始化网络客户端失败：{e}"))
}

/// 把 reqwest 的错误压成短句。带完整 URL 的原始错误对用户没有信息量，
/// 只会把界面撑成一堵墙——排障细节留在文档里。
fn describe_err(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "连接超时".into()
    } else if e.is_connect() {
        "无法连接".into()
    } else if e.is_decode() {
        "响应无法解析".into()
    } else {
        "网络请求失败".into()
    }
}

/// 拉一个地址，连 URL 一起返回（失败时便于汇总原因）。
async fn fetch_one(client: reqwest::Client, url: String) -> (String, Result<Vec<u8>, String>) {
    let result = async {
        let resp = client.get(&url).send().await.map_err(|e| describe_err(&e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status().as_u16()));
        }
        let body = resp.bytes().await.map_err(|e| describe_err(&e))?.to_vec();
        // Contents API 的响应是「JSON 包着 base64」，其它地址就是原始字节
        if url.starts_with("https://api.github.com/") {
            decode_contents_api(&body)
        } else {
            Ok(body)
        }
    }
    .await;
    (url, result)
}

fn dedupe_join(mut reasons: Vec<String>) -> String {
    let mut out: Vec<String> = Vec::new();
    for r in reasons.drain(..) {
        if !out.contains(&r) {
            out.push(r);
        }
    }
    out.join(" / ")
}

/// 本仓库 raw 地址 → jsDelivr 镜像；其它地址返回 None（不改写第三方源）。
fn mirror(url: &str) -> Option<String> {
    url.strip_prefix(REPO_RAW)
        .map(|rest| format!("{REPO_CDN}{rest}"))
}

/// 依次尝试多个地址（给技能包下载用；包较大，不值得重复拉两份）。
async fn fetch_first(urls: &[String]) -> Result<Vec<u8>, String> {
    let client = client()?;
    let mut reasons: Vec<String> = Vec::new();
    for url in urls {
        match fetch_one(client.clone(), url.clone()).await {
            (_, Ok(bytes)) => return Ok(bytes),
            (_, Err(e)) => reasons.push(e),
        }
    }
    Err(dedupe_join(reasons))
}

/// 并发拉多个地址，谁先成功用谁（给清单用：只有几 KB，多拉一份不心疼）。
///
/// 串行的话「raw 被阻断 → 等 6 秒 → 镜像再试」会让市场页空转十几秒；
/// 并发之后最坏也只等一个超时。
async fn fetch_race(urls: &[String]) -> Result<Vec<u8>, String> {
    use futures_util::stream::{FuturesUnordered, StreamExt};

    let client = client()?;
    let mut tasks = FuturesUnordered::new();
    for url in urls {
        tasks.push(fetch_one(client.clone(), url.clone()));
    }

    let mut reasons: Vec<String> = Vec::new();
    while let Some((_, result)) = tasks.next().await {
        match result {
            Ok(bytes) => return Ok(bytes),
            Err(e) => reasons.push(e),
        }
    }
    Err(dedupe_join(reasons))
}

fn parse_registry(bytes: &[u8]) -> Result<Vec<MarketSkill>, String> {
    let reg: Registry =
        serde_json::from_slice(bytes).map_err(|e| format!("市场清单格式不正确：{e}"))?;
    Ok(reg.skills)
}

async fn fetch_registry_from(src: &RegistrySource) -> Result<Vec<MarketSkill>, String> {
    let urls = registry_urls(src);
    // 清单只有几 KB，直接并发抢答；失败原因汇总成「连接超时 / HTTP 404」这种短句
    let bytes = match fetch_race(&urls).await {
        Ok(b) => b,
        // 快线全挂才动 Contents API：它是另一台主机（国内加速多覆盖），
        // 但有限额，不能当常规通道用
        Err(first) => match api_contents_url(&src.url) {
            Some(api) => match fetch_first(&[api]).await {
                Ok(b) => b,
                Err(second) => return Err(format!("{first} / {second}")),
            },
            None => return Err(first),
        },
    };
    parse_registry(&bytes)
}

/// 多个源依次拉取。串行是刻意的：源通常只有 1~2 个，并发省不了多少，
/// 但串行能让「哪个源慢」直接体现在错误信息里。
pub async fn fetch_all(sources: &[RegistrySource]) -> RegistryFetch {
    let mut groups: Vec<Vec<MarketSkill>> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for src in sources {
        match fetch_registry_from(src).await {
            Ok(mut skills) => {
                let before = skills.len();
                skills.retain(|s| valid_id(&s.id));
                if skills.len() < before {
                    errors.push(format!(
                        "{}：{} 条条目 id 不合法，已忽略",
                        src.name,
                        before - skills.len()
                    ));
                }
                for s in &mut skills {
                    s.registry = src.name.clone();
                    s.registry_url = src.url.clone();
                }
                groups.push(skills);
            }
            Err(e) => errors.push(format!("{}：{e}", src.name)),
        }
    }

    RegistryFetch {
        skills: merge_dedupe(groups),
        errors,
    }
}

/// 按组顺序合并，同 id 先到先得。
///
/// 官方源永远传在第一个，所以这条规则等价于「第三方源不能顶掉官方技能」。
fn merge_dedupe(groups: Vec<Vec<MarketSkill>>) -> Vec<MarketSkill> {
    let mut out: Vec<MarketSkill> = Vec::new();
    for group in groups {
        for skill in group {
            if out.iter().any(|x| x.id == skill.id) {
                continue;
            }
            out.push(skill);
        }
    }
    out
}

/// 把清单里的 `source` 解析成绝对下载地址。
///
/// 只接受 **https 绝对地址** 或 **相对注册表基址的纯路径**。这一条挡住两类
/// 事故：注册表塞一个 `file://` / 本地盘路径，或者塞 `http://` 明文地址
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

fn download_urls(entry: &MarketSkill) -> Result<Vec<String>, String> {
    let primary = resolve_source(&entry.registry_url, &entry.source)?;
    let mut urls = vec![primary.clone()];
    if let Some(m) = mirror(&primary) {
        urls.push(m);
    }
    Ok(urls)
}

/// 按 id 在全部源里找条目。找不到时把各源失败原因一并带出——
/// 「清单里没有」有两种可能：真没有，或者那个源根本没拉到。
pub async fn find_entry(sources: &[RegistrySource], id: &str) -> Result<MarketSkill, String> {
    let id = id.trim();
    if !valid_id(id) {
        return Err(format!("技能 id 不合法：{id}"));
    }
    let fetched = fetch_all(sources).await;
    match fetched.skills.into_iter().find(|s| s.id == id) {
        Some(entry) => Ok(entry),
        None => {
            if fetched.errors.is_empty() {
                Err(format!("市场清单里没有技能 {id}，请刷新后重试"))
            } else {
                Err(format!(
                    "市场清单里没有技能 {id}（{}）",
                    fetched.errors.join("；")
                ))
            }
        }
    }
}

// ── 哈希与 id ─────────────────────────────────────────────────

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        s.push(char::from_digit((b & 0x0f) as u32, 16).unwrap());
    }
    s
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

async fn download(entry: &MarketSkill) -> Result<Vec<u8>, String> {
    let urls = download_urls(entry)?;
    let bytes = fetch_first(&urls).await?;
    verify_sha256(&bytes, &entry.sha256)?;
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

fn display_version(manifest: &skill::SkillManifest, entry: &MarketSkill) -> String {
    if manifest.version.trim().is_empty() || manifest.version == "0.0.0" {
        entry.version.clone()
    } else {
        manifest.version.clone()
    }
}

/// 下载 + 校验 + 解包 + 审查，返回报告。不写入任何东西。
pub async fn inspect(entry: &MarketSkill, market_root: &Path) -> Result<Inspection, String> {
    let id = entry.id.trim().to_string();
    if !valid_id(&id) {
        return Err(format!("技能 id 不合法：{id}"));
    }
    let bytes = download(entry).await?;

    std::fs::create_dir_all(market_root).map_err(|e| format!("创建市场目录失败：{e}"))?;
    let tmp = market_root.join(format!(".inspect-{id}"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| format!("创建临时目录失败：{e}"))?;

    let result = (|| -> Result<Inspection, String> {
        let (root, manifest) = prepare(&bytes, &tmp)?;
        let audit_result = audit::scan(&root);
        let target = market_root.join(&id);
        Ok(Inspection {
            id: id.clone(),
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
            registry: entry.registry.clone(),
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
    entry: &MarketSkill,
    market_root: &Path,
    accept_risky: bool,
    update: bool,
) -> Result<InstallSummary, String> {
    let id = entry.id.trim().to_string();
    if !valid_id(&id) {
        return Err(format!("技能 id 不合法：{id}"));
    }
    let target = market_root.join(&id);
    let exists = target.is_dir();
    if exists && !update {
        return Err(format!("技能 {id} 已安装，请用「更新」重装"));
    }

    let bytes = download(entry).await?;

    std::fs::create_dir_all(market_root).map_err(|e| format!("创建市场目录失败：{e}"))?;
    // 先解到临时目录：中途失败不会在 market/ 里留下半个技能
    let tmp = market_root.join(format!(".tmp-{id}"));
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
        let record = InstallRecord {
            id: id.clone(),
            version: display_version(&manifest, entry),
            sha256: entry.sha256.trim().to_ascii_lowercase(),
            files: new_files.clone(),
        };

        let mut kept: Vec<String> = Vec::new();
        if exists {
            let old_files = rel_files(&target);
            let old_pkg = read_record(&target).map(|r| r.files).unwrap_or_default();
            kept = preserved_paths(&old_files, &old_pkg, &new_files);

            let backup = market_root.join(format!(".bak-{id}"));
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

    fn entry(id: &str, registry: &str) -> MarketSkill {
        MarketSkill {
            id: id.to_string(),
            name: String::new(),
            description: String::new(),
            version: String::new(),
            source: format!("skills/{id}.zip"),
            sha256: String::new(),
            tags: Vec::new(),
            author: String::new(),
            registry: registry.to_string(),
            registry_url: REPO_RAW.to_string(),
        }
    }

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
    fn mirror_rewrites_only_our_registry() {
        let ours = format!("{REPO_RAW}skills/x.zip");
        assert_eq!(
            mirror(&ours).unwrap(),
            format!("{REPO_CDN}skills/x.zip")
        );
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

    #[test]
    fn parse_registry_accepts_official_shape() {
        // 用普通 raw string：清单里的中文展示名需要真实 UTF-8 字节
        let json = r#"{
          "version": 1,
          "updated": "2026-10-24",
          "skills": [
            {
              "id": "mcp-builder",
              "name": "MCP 服务器构建",
              "description": "指导构建兼容 MCP 协议的服务器。",
              "version": "1.0.0",
              "source": "https://raw.githubusercontent.com/aura-xyz/aura-skill-registry/main/skills/mcp-builder.zip",
              "sha256": "63B5B0173E5BFA04DD84A7E03BC7A23759C5DA864F4D771B31357899A65A05F6",
              "tags": ["development", "mcp"],
              "author": "anthropics"
            }
          ]
        }"#;
        let skills = parse_registry(json.as_bytes()).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "mcp-builder");
        assert_eq!(skills[0].name, "MCP 服务器构建", "中文展示名必须原样保留");
        assert_eq!(skills[0].tags, vec!["development", "mcp"]);
        // 未知字段忽略（前向兼容，注册表将来加字段不该让客户端崩）
        let with_extra = r#"{"skills":[{"id":"x","source":"u","sha256":"s","future":1}]}"#;
        assert_eq!(parse_registry(with_extra.as_bytes()).unwrap().len(), 1);
        // 结构不对要报错而不是静默返回空
        assert!(parse_registry(b"not json").is_err());
    }

    #[test]
    fn normalize_repo_accepts_github_forms() {
        let want = "https://raw.githubusercontent.com/owner/repo/HEAD/";
        for input in [
            "https://github.com/owner/repo",
            "https://github.com/owner/repo/",
            "https://github.com/owner/repo.git",
            "http://github.com/owner/repo",
            "github.com/owner/repo",
            "  https://github.com/owner/repo  ",
        ] {
            assert_eq!(normalize_repo(input).unwrap(), want, "输入 {input}");
        }

        // 带子路径的地址不是仓库根，硬猜分支只会更糟
        assert!(normalize_repo("https://github.com/owner/repo/tree/main").is_err());
        // 非 GitHub 托管不支持（raw 路径规则不同，不能瞎拼）
        assert!(normalize_repo("https://gitlab.com/owner/repo").is_err());
        assert!(normalize_repo("https://gitee.com/owner/repo").is_err());
        assert!(normalize_repo("owner/repo").is_err());
        assert!(normalize_repo("").is_err());
        assert!(normalize_repo("https://github.com/owner").is_err());
        assert!(normalize_repo("https://github.com/../etc").is_err());
        assert!(normalize_repo("https://github.com/ow ner/repo").is_err());
    }

    #[test]
    fn registry_urls_include_branch_and_cdn_fallbacks() {
        let ours = registry_urls(&official_source());
        assert_eq!(ours[0], format!("{REPO_RAW}{REGISTRY_JSON}"));
        // 官方源本来就在 main 上，不该再补一条 raw 的 main 兜底
        assert_eq!(ours.len(), 2, "官方源只有 raw + jsDelivr 两条：{ours:?}");
        assert_eq!(ours.last().unwrap(), &format!("{REPO_CDN}{REGISTRY_JSON}"));
        // Contents API 是「快线全挂」之后的兜底，不进并发组（有限额）
        assert!(!ours.iter().any(|u| u.contains("api.github.com")));

        let custom = RegistrySource {
            name: "团队".into(),
            url: normalize_repo("https://github.com/team/skills").unwrap(),
        };
        let urls = registry_urls(&custom);
        assert!(urls[0].ends_with("/HEAD/recommended.json"));
        assert!(
            urls.iter().any(|u| u.ends_with("/main/recommended.json")),
            "自定义源要补 main 兜底：{urls:?}"
        );
        // 第三方源不做 CDN 镜像
        assert!(!urls.iter().any(|u| u.contains("jsdelivr")));
    }

    #[test]
    fn api_contents_url_derives_from_raw_base() {
        assert_eq!(
            api_contents_url(REPO_RAW).unwrap(),
            "https://api.github.com/repos/aura-xyz/aura-skill-registry/contents/recommended.json"
        );
        let custom = normalize_repo("https://github.com/team/skills").unwrap();
        assert_eq!(
            api_contents_url(&custom).unwrap(),
            "https://api.github.com/repos/team/skills/contents/recommended.json"
        );
        // 非 GitHub raw 基址没有这条兜底
        assert!(api_contents_url("https://example.com/raw/").is_none());
    }

    #[test]
    fn decode_contents_api_unwraps_base64() {
        // 真实响应形状：content 是 base64，并带换行
        let json = r#"{"name":"recommended.json","encoding":"base64","content":"eyJza2lsbHMiOltdfQ=="}"#;
        assert_eq!(decode_contents_api(json.as_bytes()).unwrap(), b"{\"skills\":[]}");
        // 带换行的 base64 也要能解
        let wrapped = r#"{"encoding":"base64","content":"eyJza2ls\nbHMiOltdfQ=="}"#;
        assert_eq!(decode_contents_api(wrapped.as_bytes()).unwrap(), b"{\"skills\":[]}");
        // 不是文件内容（比如错误 JSON）要报错而不是解出垃圾
        assert!(decode_contents_api(br#"{"message":"Not Found"}"#).is_err());
        assert!(decode_contents_api(b"not json").is_err());
    }

    #[test]
    fn merge_keeps_first_and_respects_source_order() {
        let mut a = entry("shared", "官方");
        a.version = "1.0.0".into();
        let mut b = entry("shared", "第三方");
        b.version = "9.9.9".into();
        let merged = merge_dedupe(vec![vec![a], vec![b, entry("other", "第三方")]]);
        assert_eq!(merged.len(), 2, "同 id 只留一条");
        assert_eq!(merged[0].registry, "官方", "官方排第一，第三方顶不掉它");
        assert_eq!(merged[0].version, "1.0.0");
        assert_eq!(merged[1].id, "other");
    }

    #[test]
    fn resolve_source_requires_https_or_relative() {
        let base = REPO_RAW;
        assert_eq!(
            resolve_source(base, "skills/x.zip").unwrap(),
            format!("{base}skills/x.zip")
        );
        // 绝对 https 地址原样使用
        assert_eq!(
            resolve_source(base, "https://example.com/x.zip").unwrap(),
            "https://example.com/x.zip"
        );
        // 明文 http / 其它协议一律拒绝：下载的是即将被执行的脚本
        assert!(resolve_source(base, "http://example.com/x.zip").is_err());
        assert!(resolve_source(base, "file:///c:/x.zip").is_err());
        assert!(resolve_source(base, "//example.com/x.zip").is_err());
        assert!(resolve_source(base, "../../etc/passwd").is_err());
        assert!(resolve_source(base, "").is_err());
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
