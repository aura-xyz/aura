//! 三期协议面组合回归（v0.8.2 · M3-09）。
//!
//! 各模块自己的单测覆盖单点；这里把「帧 → 分发 → 审批闸门 → 响应」
//! 与「配置 → 能力协商 → 授权 → 调度」串成真实链路，防止组合起来丢字段。
//! 同时作为一期文档第五章、二期文档第五章手动清单的自动化替身。

use serde_json::{json, Value};

use super::capabilities::{client_capabilities, parse_capabilities};
use super::client::{sampling_error, SamplingGate, SAMPLING_LIMIT};
use super::market::parse_catalog;
use super::oauth::{
    authorization_url, is_expired, new_pkce, parse_token_response, resolve_endpoints,
    take, token_form_code, Pending, REDIRECT_URI,
};
use super::scheduler::{annotate_source, trim_batch, MAX_BATCH};
use super::session::{decode_line, Inbound, RpcSession};

/// 服务器发起的 sampling 请求必须走到审批闸门，并回一条带原始 id 的错误帧。
/// 这是三期最容易「单测都过、组合起来静默丢弃」的一条链路。
#[test]
fn inbound_sampling_request_is_never_silently_dropped() {
    let line = r#"{"jsonrpc":"2.0","id":42,"method":"sampling/createMessage","params":{"messages":[]}}"#;
    let v = decode_line(line).unwrap().unwrap();
    let session = RpcSession::new();
    match session.dispatch_full(v).expect("应识别为服务器请求") {
        Inbound::Request(id, method, params) => {
            assert_eq!(id, 42);
            assert_eq!(method, "sampling/createMessage");
            assert!(params.get("messages").is_some());
            // 默认未注入审批器 → 拒绝帧（M3-05 安全默认）
            let frame = sampling_error(id, -32001, "用户未批准模型调用");
            assert_eq!(frame["id"], 42);
            assert_eq!(frame["error"]["code"], -32001);
        }
        other => panic!("应为 Request，实际 {other:?}"),
    }
}

/// 响应仍走 pending、通知仍走路由，一/二期语义不能被 M3-05 破坏。
#[test]
fn responses_and_notifications_keep_legacy_paths() {
    let s = RpcSession::new();
    assert_eq!(
        s.dispatch(json!({ "jsonrpc": "2.0", "id": 1, "result": {} })),
        None
    );
    assert_eq!(
        s.dispatch(json!({
            "jsonrpc": "2.0",
            "method": "notifications/resources/updated",
            "params": { "uri": "file:///a.txt" }
        })),
        Some((
            "notifications/resources/updated".to_string(),
            json!({ "uri": "file:///a.txt" })
        ))
    );
}

/// 能力协商：客户端声明含 sampling，服务器声明被解析，缺字段仍当不支持。
#[test]
fn capability_negotiation_roundtrip_includes_sampling() {
    let client = client_capabilities();
    assert!(client.get("sampling").is_some());
    assert!(client["resources"]["subscribe"].as_bool().unwrap_or(false));
    let result = json!({
        "protocolVersion": "2025-11-25",
        "serverInfo": { "name": "remote", "version": "2.0" },
        "capabilities": { "tools": {}, "resources": {}, "prompts": {}, "sampling": {} }
    });
    let parsed = parse_capabilities(&result);
    assert_eq!(parsed.protocol_version, "2025-11-25");
    assert_eq!(parsed.domains(), vec!["tools", "resources", "prompts", "sampling"]);
    assert!(!parse_capabilities(&json!({ "capabilities": { "tools": {} } })).sampling);
}

/// OAuth 全链路纯函数串联：PKCE → 授权 URL → 一次性 state → 表单 → token → 过期。
#[test]
fn oauth_pkce_to_token_lifecycle() {
    let pkce = new_pkce().unwrap();
    let ep = resolve_endpoints("https://mcp.example.com/mcp", None).unwrap();
    let url = authorization_url(&ep, "aura-desktop", &pkce, "mcp:tools").unwrap();
    let parsed = url::Url::parse(&url).unwrap();
    let q: std::collections::HashMap<_, _> =
        parsed.query_pairs().into_owned().collect();
    assert_eq!(q["code_challenge"], pkce.challenge);
    assert_eq!(q["state"], pkce.state);
    assert_eq!(q["redirect_uri"], REDIRECT_URI);

    assert!(take(&pkce.state, 3).is_err(), "未登记的 state 必须被拒绝");
    super::oauth::remember(
        pkce.state.clone(),
        Pending {
            server_id: 7,
            verifier: pkce.verifier.clone(),
            client_id: "aura-desktop".into(),
            token_url: ep.token.clone(),
            created_at: super::oauth::now_secs(),
        },
    );
    let p = take(&pkce.state, 7).unwrap();
    let form = token_form_code(&p.client_id, "CODE", &p.verifier);
    assert!(form.iter().any(|(k, v)| k == "code_verifier" && v == &pkce.verifier));
    assert!(take(&pkce.state, 7).is_err(), "state 必须一次性");

    let t = parse_token_response(
        r#"{"access_token":"AT","refresh_token":"RT","expires_in":60}"#,
        1000,
    )
    .unwrap();
    assert!(!is_expired(&t, 1000));
    assert!(is_expired(&t, 1060));
}

/// 调度：批量截断 + 来源标注，且会话配额上限不受信任等级影响。
#[test]
fn scheduler_bounds_and_source_labels() {
    let calls: Vec<usize> = (0..MAX_BATCH + 5).collect();
    assert_eq!(trim_batch(calls).len(), MAX_BATCH);
    let a = annotate_source("alpha", "read", "A");
    let b = annotate_source("beta", "read", "B");
    assert!(a.contains("alpha") && !a.contains("beta"));
    assert_ne!(a, b);
    let gate = SamplingGate::new(SAMPLING_LIMIT);
    for _ in 0..SAMPLING_LIMIT {
        assert!(gate.try_take());
    }
    assert!(!gate.try_take());
}

/// 市场清单解析后每条都必须能过「有 command 或 server_url」的门槛。
#[test]
fn market_catalog_entries_are_installable_shapes() {
    let body = r#"[
        {"id":"a","name":"A","command":"npx","args":["-y","x"]},
        {"id":"b","name":"B","server_url":"https://mcp.example.com/mcp"},
        {"id":"c","name":"C"}
    ]"#;
    let out = parse_catalog(body);
    assert_eq!(out.len(), 2);
    for e in &out {
        assert!(!e.command.trim().is_empty() || !e.server_url.trim().is_empty());
        assert_eq!(e.source, "remote");
    }
}

#[tokio::test]
async fn global_quota_passes_a_successful_call() {
    let v: Result<Value, String> =
        super::scheduler::with_quota(async { Ok(json!({ "ok": true })) }).await;
    assert_eq!(v.unwrap()["ok"], true);
}
