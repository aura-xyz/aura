//! GitHub 镜像表与改写（v0.8.0）。
//!
//! 镜像都是第三方加速服务，可能随时下线或变慢，因此只作为**候选**：
//! - 软件自身的请求（自动更新、官方技能市场）用内置 7 家轮换/竞速；
//! - 用户的普通浏览不经过这里（镜像只服务 Aura 自己的后端请求）；
//! - 用户自建的自定义技能源，默认直连，可用设置页配置的自定义镜像前缀加速。
//!
//! 前缀都是 gh-proxy 系写法：`<prefix><完整的 https 地址>`。

use std::sync::Mutex;

/// 内置镜像前缀表（7 家）。`updater` 与技能市场共用这一份，避免两处漂移。
///
/// `gh-proxy.org` 与 `gh-proxy.com` 是不同服务，不是同一域名的新旧写法。
pub const MIRRORS: &[(&str, &str)] = &[
    // 2026-11-01 实测 v4 秒下 latest.json 与安装包
    ("gh-proxy-v4", "https://v4.gh-proxy.org/"),
    ("gh-proxy-cdn", "https://cdn.gh-proxy.org/"),
    ("gh-proxy", "https://gh-proxy.org/"),
    ("gh-proxy-v6", "https://v6.gh-proxy.org/"),
    ("gh-proxy-axis", "https://axisnow.gh-proxy.org/"),
    // 2026-10-25 实测 0.37 MB/s
    ("ghfast", "https://ghfast.top/"),
    // 2026-10-25 实测 0.12 MB/s
    ("gh-proxy.com", "https://gh-proxy.com/"),
];

/// 只对 GitHub 的 https 地址做镜像（不接管任意站点）。
pub fn is_github_url(url: &str) -> bool {
    url.starts_with("https://raw.githubusercontent.com/")
        || url.starts_with("https://github.com/")
}

/// 拼接镜像地址：`<prefix><url>`，前缀缺尾斜杠时补一个。
pub fn apply(prefix: &str, url: &str) -> String {
    let p = prefix.trim();
    if p.ends_with('/') {
        format!("{p}{url}")
    } else {
        format!("{p}/{url}")
    }
}

/// 软件自身请求的镜像候选（不含官方直连，调用方自行拼接）。
pub fn official_candidates(url: &str, extra: &[String]) -> Vec<String> {
    if !is_github_url(url) {
        return Vec::new();
    }
    let mut out: Vec<String> = Vec::new();
    for p in extra {
        if !p.trim().is_empty() {
            out.push(apply(p, url));
        }
    }
    for (_, prefix) in MIRRORS {
        out.push(apply(prefix, url));
    }
    out
}

/// 用户自定义源：只应用用户配置的镜像前缀（内置 7 家不接管第三方源）。
pub fn custom_candidates(url: &str, prefix: Option<&str>) -> Vec<String> {
    match prefix {
        Some(p) if is_github_url(url) && !p.trim().is_empty() => vec![apply(p, url)],
        _ => Vec::new(),
    }
}

/// 设置项键名（DB settings 表）。
pub const SETTING_KEY: &str = "skill_mirror";

/// 用户配置的自定义镜像前缀（设置页可改；空 = 不加速）。
static CUSTOM_PREFIX: Mutex<Option<String>> = Mutex::new(None);

pub fn set_custom_prefix(prefix: Option<String>) {
    let value = prefix
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    if let Ok(mut guard) = CUSTOM_PREFIX.lock() {
        *guard = value;
    }
}

pub fn custom_prefix() -> Option<String> {
    CUSTOM_PREFIX
        .lock()
        .ok()
        .and_then(|g| g.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_normalizes_trailing_slash() {
        assert_eq!(
            apply("https://v4.gh-proxy.org/", "https://github.com/a/b"),
            "https://v4.gh-proxy.org/https://github.com/a/b"
        );
        assert_eq!(
            apply("https://ghfast.top", "https://github.com/a/b"),
            "https://ghfast.top/https://github.com/a/b"
        );
    }

    #[test]
    fn only_github_urls_are_mirrored() {
        assert!(is_github_url("https://raw.githubusercontent.com/a/b/main/x"));
        assert!(is_github_url("https://github.com/a/b/releases/x"));
        assert!(!is_github_url("https://example.com/x"));
        assert!(official_candidates("https://example.com/x", &[]).is_empty());
    }

    #[test]
    fn official_candidates_include_extra_then_builtin() {
        let url = "https://raw.githubusercontent.com/a/b/main/x.json";
        let got = official_candidates(url, &["https://my.mirror/".to_string()]);
        assert_eq!(got.first().unwrap(), &apply("https://my.mirror/", url));
        assert_eq!(got.len(), 1 + MIRRORS.len());
    }

    #[test]
    fn custom_candidates_use_only_custom_prefix() {
        let url = "https://raw.githubusercontent.com/a/b/main/x.zip";
        assert!(custom_candidates(url, None).is_empty());
        assert_eq!(
            custom_candidates(url, Some("https://my.mirror/")).first().unwrap(),
            &apply("https://my.mirror/", url)
        );
    }
}
