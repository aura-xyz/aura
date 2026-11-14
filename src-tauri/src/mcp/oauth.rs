//! OAuth 2.1 + PKCE 授权面（v0.8.2 · M3-04）。
//!
//! 复用一期 M-01 的 `secure` 加密通道与 `mcp_servers` 凭据列，不建第二套
//! 存储；token 只以密文落在 `oauth_token_encrypted`，明文仅在内存里存在。
//!
//! 边界写清楚：本模块负责 PKCE、端点发现、授权 URL 构造、code/refresh
//! 交换与过期判断；**打开浏览器与收集授权码由前端/用户完成**（M3-08），
//! 这里不监听端口、不自动抓取回调，避免在桌面端引入常驻 HTTP 服务。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// 回环回调地址。OAuth 2.1 要求本机客户端用 loopback redirect；
/// 用户从浏览器地址栏复制 `code` 后交回 `mcp_oauth_complete`。
pub const REDIRECT_URI: &str = "http://127.0.0.1:18741/callback";
/// 授权码有效期（秒）：超过即拒绝，防止旧 state 被复用。
const PENDING_TTL_SECS: i64 = 300;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix 秒；0 表示服务器未给 expires_in（按不过期处理）
    pub expires_at: i64,
    pub token_type: String,
}

#[derive(Debug, Clone)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

/// 用 `getrandom` 生成高熵 verifier / state；challenge = BASE64URL(SHA256(verifier))。
pub fn new_pkce() -> Result<Pkce, String> {
    let mut a = [0u8; 32];
    let mut b = [0u8; 24];
    getrandom::getrandom(&mut a).map_err(|e| format!("随机数不可用：{e}"))?;
    getrandom::getrandom(&mut b).map_err(|e| format!("随机数不可用：{e}"))?;
    let verifier = URL_SAFE_NO_PAD.encode(a);
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
    Ok(Pkce {
        verifier,
        challenge,
        state: URL_SAFE_NO_PAD.encode(b),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    pub authorization: String,
    pub token: String,
}

/// 端点发现：拿到 AS 元数据就用它的 `authorization_endpoint` / `token_endpoint`，
/// 拿不到（或未实现 discovery 的服务器）回退到同源 `/authorize` `/token`。
/// 缺字段一律按「不支持」处理，绝不猜路径之外的东西。
pub fn resolve_endpoints(server_url: &str, discovery: Option<&str>) -> Result<Endpoints, String> {
    let base = url::Url::parse(server_url).map_err(|e| format!("远程地址无效：{e}"))?;
    let origin = base.origin().ascii_serialization();
    let mut out = Endpoints {
        authorization: format!("{origin}/authorize"),
        token: format!("{origin}/token"),
    };
    if let Some(body) = discovery {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
            if let Some(a) = v.get("authorization_endpoint").and_then(|x| x.as_str()) {
                if a.starts_with("https://") || a.starts_with("http://127.0.0.1") {
                    out.authorization = a.to_string();
                }
            }
            if let Some(t) = v.get("token_endpoint").and_then(|x| x.as_str()) {
                if t.starts_with("https://") || t.starts_with("http://127.0.0.1") {
                    out.token = t.to_string();
                }
            }
        }
    }
    Ok(out)
}

pub fn authorization_url(
    ep: &Endpoints,
    client_id: &str,
    pkce: &Pkce,
    scope: &str,
) -> Result<String, String> {
    let mut u = url::Url::parse(&ep.authorization)
        .map_err(|e| format!("授权端点无效：{e}"))?;
    u.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("state", &pkce.state)
        .append_pair("code_challenge", &pkce.challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("scope", scope);
    Ok(u.to_string())
}

pub fn token_form_code(client_id: &str, code: &str, verifier: &str) -> Vec<(String, String)> {
    vec![
        ("grant_type".into(), "authorization_code".into()),
        ("code".into(), code.to_string()),
        ("redirect_uri".into(), REDIRECT_URI.to_string()),
        ("client_id".into(), client_id.to_string()),
        ("code_verifier".into(), verifier.to_string()),
    ]
}

pub fn token_form_refresh(client_id: &str, refresh: &str) -> Vec<(String, String)> {
    vec![
        ("grant_type".into(), "refresh_token".into()),
        ("refresh_token".into(), refresh.to_string()),
        ("client_id".into(), client_id.to_string()),
    ]
}

pub fn parse_token_response(body: &str, now_secs: i64) -> Result<TokenSet, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("token 响应不是 JSON：{e}"))?;
    let access_token = v
        .get("access_token")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "token 响应缺少 access_token".to_string())?
        .to_string();
    let expires_at = v
        .get("expires_in")
        .and_then(|x| x.as_i64())
        .filter(|s| *s > 0)
        .map(|s| now_secs.saturating_add(s))
        .unwrap_or(0);
    Ok(TokenSet {
        access_token,
        refresh_token: v
            .get("refresh_token")
            .and_then(|x| x.as_str())
            .map(str::to_string),
        expires_at,
        token_type: v
            .get("token_type")
            .and_then(|x| x.as_str())
            .unwrap_or("Bearer")
            .to_string(),
    })
}

pub fn is_expired(t: &TokenSet, now_secs: i64) -> bool {
    t.expires_at > 0 && now_secs >= t.expires_at.saturating_sub(30)
}

/// 拉取 AS 元数据；失败返回 None 走回退端点，不阻断授权。
pub async fn discover(server_url: &str) -> Option<String> {
    let base = url::Url::parse(server_url).ok()?;
    let origin = base.origin().ascii_serialization();
    let well_known = format!("{origin}/.well-known/oauth-authorization-server");
    let resp = reqwest::Client::new()
        .get(well_known)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}

pub async fn exchange(
    token_url: &str,
    form: Vec<(String, String)>,
) -> Result<TokenSet, String> {
    // Cargo.toml 的 reqwest 未开 `form` feature；用 url crate 手工编码，
    // 避免为一个表单请求加依赖。
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .finish();
    let resp = reqwest::Client::new()
        .post(token_url)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(body)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("token 交换失败：{e}"))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取 token 响应失败：{e}"))?;
    if !status.is_success() {
        let brief: String = body.chars().take(160).collect();
        return Err(format!("授权服务器返回 HTTP {}：{brief}", status.as_u16()));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    parse_token_response(&body, now)
}

/// 一次授权事务的暂存信息（state → 参数），不落库、进程内有效。
#[derive(Clone)]
pub struct Pending {
    pub server_id: i64,
    pub verifier: String,
    pub client_id: String,
    pub token_url: String,
    pub created_at: i64,
}

fn pending_table() -> &'static Mutex<HashMap<String, Pending>> {
    static TABLE: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
    TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn remember(state: String, p: Pending) {
    if let Ok(mut t) = pending_table().lock() {
        // 顺手清掉过期条目，避免表无限增长
        t.retain(|_, v| now_secs() - v.created_at < PENDING_TTL_SECS);
        t.insert(state, p);
    }
}

/// 取回并**立即删除**（state 一次性），同时校验 server_id 与 TTL。
pub fn take(state: &str, server_id: i64) -> Result<Pending, String> {
    let mut t = pending_table()
        .lock()
        .map_err(|_| "授权状态表不可用".to_string())?;
    let p = t
        .remove(state)
        .ok_or_else(|| "授权状态无效或已被使用，请重新发起授权".to_string())?;
    if p.server_id != server_id || now_secs() - p.created_at > PENDING_TTL_SECS {
        return Err("授权状态已过期或与服务器不匹配，请重新发起授权".to_string());
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_verifier_and_state_is_unique() {
        let a = new_pkce().unwrap();
        let b = new_pkce().unwrap();
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.state, b.state);
        let mut h = Sha256::new();
        h.update(a.verifier.as_bytes());
        assert_eq!(a.challenge, URL_SAFE_NO_PAD.encode(h.finalize()));
        assert!(!a.challenge.contains('='));
    }

    #[test]
    fn endpoints_fall_back_to_same_origin() {
        let ep = resolve_endpoints("https://mcp.example.com/api/mcp", None).unwrap();
        assert_eq!(ep.authorization, "https://mcp.example.com/authorize");
        assert_eq!(ep.token, "https://mcp.example.com/token");
    }

    #[test]
    fn endpoints_honor_discovery_document() {
        let doc = r#"{"authorization_endpoint":"https://auth.example.com/oauth/authorize","token_endpoint":"https://auth.example.com/oauth/token"}"#;
        let ep = resolve_endpoints("https://mcp.example.com/mcp", Some(doc)).unwrap();
        assert_eq!(ep.authorization, "https://auth.example.com/oauth/authorize");
        assert_eq!(ep.token, "https://auth.example.com/oauth/token");
    }

    #[test]
    fn authorization_url_carries_pkce_and_state() {
        let ep = resolve_endpoints("https://mcp.example.com/mcp", None).unwrap();
        let pkce = Pkce {
            verifier: "v".into(),
            challenge: "c".into(),
            state: "s-123".into(),
        };
        let u = url::Url::parse(&authorization_url(&ep, "aura", &pkce, "mcp:tools").unwrap())
            .unwrap();
        let q: HashMap<_, _> = u.query_pairs().into_owned().collect();
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], "c");
        assert_eq!(q["state"], "s-123");
        assert_eq!(q["redirect_uri"], REDIRECT_URI);
        assert_eq!(q["scope"], "mcp:tools");
    }

    #[test]
    fn token_forms_and_response_parsing() {
        let form = token_form_code("aura", "CODE", "VERIFIER");
        assert!(form.contains(&("grant_type".to_string(), "authorization_code".to_string())));
        assert!(form.contains(&("code_verifier".to_string(), "VERIFIER".to_string())));
        let refresh = token_form_refresh("aura", "R");
        assert!(refresh.contains(&("grant_type".to_string(), "refresh_token".to_string())));

        let t = parse_token_response(
            r#"{"access_token":"AT","refresh_token":"RT","expires_in":3600,"token_type":"Bearer"}"#,
            1000,
        )
        .unwrap();
        assert_eq!(t.access_token, "AT");
        assert_eq!(t.refresh_token.as_deref(), Some("RT"));
        assert_eq!(t.expires_at, 4600);
        assert!(!is_expired(&t, 4000));
        assert!(is_expired(&t, 4600));
        assert!(parse_token_response(r#"{"error":"invalid_grant"}"#, 0).is_err());
    }

    #[test]
    fn pending_state_is_single_use_and_bound_to_server() {
        let p = Pending {
            server_id: 7,
            verifier: "v".into(),
            client_id: "aura".into(),
            token_url: "https://x/token".into(),
            created_at: now_secs(),
        };
        remember("state-1".into(), p.clone());
        assert!(take("state-1", 8).is_err()); // 绑错服务器，且已被消费
        remember("state-2".into(), p);
        assert_eq!(take("state-2", 7).unwrap().verifier, "v");
        assert!(take("state-2", 7).is_err()); // 一次性
    }
}
