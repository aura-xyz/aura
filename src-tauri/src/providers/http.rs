//! Provider 共用的 HTTP 工具（v0.6.2）
//!
//! 从 `market.rs` 抽出来的网络底座。原先这些函数只服务官方 registry，
//! 接入第二个源之后它们要同时服务多个源——放在 `providers/` 下更合适，
//! 也避免 `market`（安装管线）与 `providers`（源）互相依赖形成环。

use std::time::Duration;

/// 构造 HTTP 客户端。
///
/// 超时取值的理由见注释：国内访问 raw 常被阻断，界面里「点开市场就转圈」
/// 的那一段，宁可早失败早换线路。
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // 6 秒连不上基本可以判定这条线路不通
        .connect_timeout(Duration::from_secs(6))
        // 单请求总共 20 秒
        .timeout(Duration::from_secs(20))
        .user_agent("aura-skill-market")
        .build()
        .map_err(|e| format!("初始化网络客户端失败：{e}"))
}

/// 把 reqwest 错误压成一句短话。
///
/// 原始错误形如 `error sending request for url (https://…)`——把整条 URL
/// 甩给用户零信息量，还把界面撑成一堵墙。
pub fn describe_err(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "连接超时".to_string()
    } else if e.is_connect() {
        "无法连接".to_string()
    } else if let Some(status) = e.status() {
        format!("HTTP {}", status.as_u16())
    } else {
        "请求失败".to_string()
    }
}

/// 依次尝试多个地址，返回第一份成功的内容；全失败时把原因合并。
///
/// 合并时去重：三条线路的失败原因常常一模一样（都被同一台主机挡了），
/// 重复三遍只是噪音。
pub async fn fetch_first(urls: &[String]) -> Result<Vec<u8>, String> {
    let client = client()?;
    let mut reasons: Vec<String> = Vec::new();
    for url in urls {
        match client.get(url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    reasons.push(format!("HTTP {}", resp.status().as_u16()));
                    continue;
                }
                match resp.bytes().await {
                    Ok(bytes) => return Ok(bytes.to_vec()),
                    Err(e) => reasons.push(describe_err(&e)),
                }
            }
            Err(e) => reasons.push(describe_err(&e)),
        }
    }
    Err(dedupe_join(reasons))
}

/// 并发抢答：多条地址同时请求，谁先成功用谁。
///
/// 串行时「raw 被阻断 → 等 6 秒 → 镜像再试」会让市场页空转十几秒。
/// 清单只有几 KB，并发的成本可以忽略。
pub async fn fetch_race(urls: &[String]) -> Result<Vec<u8>, String> {
    if urls.is_empty() {
        return Err("没有可用的下载地址".into());
    }
    let client = client()?;
    let mut tasks = Vec::new();
    for url in urls {
        let c = client.clone();
        let u = url.clone();
        tasks.push(tokio::spawn(async move {
            let result = match c.get(&u).send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        Err(format!("HTTP {}", resp.status().as_u16()))
                    } else {
                        resp.bytes()
                            .await
                            .map(|b| b.to_vec())
                            .map_err(|e| describe_err(&e))
                    }
                }
                Err(e) => Err(describe_err(&e)),
            };
            (u, result)
        }));
    }

    let mut reasons: Vec<String> = Vec::new();
    for task in tasks {
        match task.await {
            Ok((_url, Ok(bytes))) => return Ok(bytes),
            Ok((_url, Err(e))) => reasons.push(e),
            Err(e) => reasons.push(format!("请求任务异常: {e}")),
        }
    }
    Err(dedupe_join(reasons))
}

/// 合并失败原因，去重后用「；」连接。
pub fn dedupe_join(mut reasons: Vec<String>) -> String {
    reasons.retain(|r| !r.trim().is_empty());
    reasons.dedup();
    if reasons.is_empty() {
        "请求失败".to_string()
    } else {
        reasons.join("；")
    }
}

/// 下载二进制内容（安装包）。
pub async fn download_bytes(urls: &[String]) -> Result<Vec<u8>, String> {
    fetch_first(urls).await
}
