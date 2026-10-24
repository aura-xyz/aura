//! 技能市场（v0.6.1）：拉官方 registry 清单、下载并安装技能包。
//!
//! 注册表是独立仓库 `aura-xyz/aura-skill-registry`，清单为 `recommended.json`：
//! 每项给出 id、中文名、说明、版本、zip 地址与 sha256。安装即
//! 「下载 zip → 校验哈希 → 解到 `skills/market/<id>/`」，之后由技能扫描
//! 照常发现，不需要别的登记动作。
//!
//! **网络取舍**：`raw.githubusercontent.com` 在国内常不可达（与更新检查同一个
//! 坑），因此清单与技能包都带 jsDelivr 镜像兜底。镜像只对本仓库地址生效，
//! 第三方地址原样不动。
//!
//! **安全底线**：哈希必填（清单不给 sha256 就拒绝安装）、解包用
//! `enclosed_name()` 拒绝 `../` 与绝对路径（zip slip）、解压总量设上限
//! （zip bomb）、先解到临时目录再整体搬入（失败不留半个技能）。

use std::path::{Path, PathBuf};
use std::time::Duration;

const REPO_RAW: &str = "https://raw.githubusercontent.com/aura-xyz/aura-skill-registry/main/";
const REPO_CDN: &str = "https://cdn.jsdelivr.net/gh/aura-xyz/aura-skill-registry@main/";
const REGISTRY_JSON: &str = "recommended.json";

/// 单个技能包解压后的大小上限。技能是纯文本 + 少量脚本，20MB 已很宽松。
const MAX_UNPACKED: u64 = 20 * 1024 * 1024;

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
    /// 技能包 zip 地址
    pub source: String,
    /// zip 的 sha256（十六进制，大小写不敏感）。缺省即拒绝安装
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub author: String,
}

#[derive(Debug, Default, serde::Deserialize)]
struct Registry {
    #[serde(default)]
    skills: Vec<MarketSkill>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .user_agent("aura-skill-market")
        .build()
        .map_err(|e| format!("初始化网络客户端失败：{e}"))
}

/// 本仓库 raw 地址 → jsDelivr 镜像；其它地址返回 None（不改写第三方源）。
fn mirror(url: &str) -> Option<String> {
    url.strip_prefix(REPO_RAW)
        .map(|rest| format!("{REPO_CDN}{rest}"))
}

/// 依次尝试多个地址，返回第一份成功的内容；全失败时把最后一个错误带出去。
async fn fetch_first(urls: &[String]) -> Result<Vec<u8>, String> {
    let client = client()?;
    let mut last = String::from("没有可用的下载地址");
    for url in urls {
        match client.get(url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last = format!("{url} 返回 HTTP {}", resp.status().as_u16());
                    continue;
                }
                match resp.bytes().await {
                    Ok(bytes) => return Ok(bytes.to_vec()),
                    Err(e) => last = format!("{url} 读取响应失败：{e}"),
                }
            }
            Err(e) => last = format!("{url} 请求失败：{e}"),
        }
    }
    Err(last)
}

fn parse_registry(bytes: &[u8]) -> Result<Vec<MarketSkill>, String> {
    let reg: Registry =
        serde_json::from_slice(bytes).map_err(|e| format!("市场清单格式不正确：{e}"))?;
    Ok(reg.skills)
}

pub async fn fetch_registry() -> Result<Vec<MarketSkill>, String> {
    let primary = format!("{REPO_RAW}{REGISTRY_JSON}");
    let mut urls = vec![primary.clone()];
    if let Some(m) = mirror(&primary) {
        urls.push(m);
    }
    parse_registry(&fetch_first(&urls).await?)
}

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

/// 下载并安装。`market_root` 是 `skills/market` 根目录。
pub async fn install(entry: &MarketSkill, market_root: &Path) -> Result<(), String> {
    let id = entry.id.trim();
    if !valid_id(id) {
        return Err(format!("技能 id 不合法：{id}"));
    }
    let target = market_root.join(id);
    if target.exists() {
        return Err(format!("技能 {id} 已安装，先在「已安装」里删除再重装"));
    }

    let mut urls = vec![entry.source.clone()];
    if let Some(m) = mirror(&entry.source) {
        urls.push(m);
    }
    let bytes = fetch_first(&urls).await?;
    verify_sha256(&bytes, &entry.sha256)?;

    std::fs::create_dir_all(market_root).map_err(|e| format!("创建市场目录失败：{e}"))?;
    // 先解到临时目录：中途失败不会在 market/ 里留下半个技能
    let tmp = market_root.join(format!(".tmp-{id}"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| format!("创建临时目录失败：{e}"))?;

    let result = (|| -> Result<(), String> {
        extract_zip(&bytes, &tmp)?;
        let root = skill_root(&tmp).ok_or_else(|| "技能包里没有 SKILL.md".to_string())?;
        // 解析一遍：格式不对的技能装进来也只会被扫描器静默跳过
        let md = std::fs::read_to_string(root.join("SKILL.md"))
            .map_err(|e| format!("读取 SKILL.md 失败：{e}"))?;
        crate::agent::skill::parse_skill_md(&md)
            .map_err(|e| format!("技能格式不合法：{e}"))?;
        match std::fs::rename(&root, &target) {
            Ok(()) => Ok(()),
            Err(e) => Err(format!("安装失败：{e}")),
        }
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    } else if tmp.exists() {
        // 技能根是临时目录的子目录时，把壳删掉
        let _ = std::fs::remove_dir_all(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
