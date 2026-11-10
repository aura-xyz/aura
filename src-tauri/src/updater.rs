//! 自动更新：**多源下载**（v0.7.0 起替换插件自带的下载路径）。
//!
//! # 为什么要自己下
//!
//! 插件（`tauri-plugin-updater`）的下载是「清单里给什么 URL 就下什么 URL」，
//! 没有换源、没有速度判断、没有回退。而实测（2026-10-25，本机 Windows 11）：
//!
//! | 源 | 吞吐 | 42.9MB 安装包耗时 |
//! |---|---|---|
//! | GitHub Release 资产（302 → Azure Blob） | **0.05 MB/s** | ~14 分钟 |
//! | ghfast.top 镜像 | 0.37 MB/s | ~2 分钟 |
//! | gh-proxy.com 镜像 | 0.12 MB/s | ~6 分钟 |
//! | 本机带宽上限（Cloudflare 校准） | 1.11 MB/s | ~40 秒 |
//!
//! 也就是说：慢的不是网络，是 **GitHub 资产在境内的这条链路**。
//! 用户实测「安装到 10MB/42.9MB 时失败」「更新安装速度慢」都源于此。
//!
//! # 做法
//!
//! 1. 用清单给出的资产地址派生若干**候选源**（官方直连 + 镜像）。
//! 2. **并发探测**每个源的真实吞吐（只取头 256KB，不下整个文件）。
//! 3. 按策略选源：**官方够快就用官方**（尽量不把用户流量交给第三方）；
//!    官方太慢才用镜像；全都不行也用官方（权威优先，慢总比错好）。
//! 4. 把选中的 URL 写回 `Update.download_url`，之后**仍由插件负责**
//!    下载、minisign 签名校验与安装——我们只换源，不重写它的安全链路。
//!
//! 镜像只影响速度与可用性，**改不了内容**：载荷的 minisign 签名由本项目私钥
//! 签发，插件下载完会校验签名（并且校验签名里记录的版本号），
//! 镜像给一份旧文件只会导致签名不匹配而失败，不会装进坏东西。

use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use crate::commands::AppState;
use crate::mirrors::MIRRORS;

/// 探测时取的字节数。只取头一段就够判断快慢，不必下整个安装包。
pub const PROBE_BYTES: u64 = 256 * 1024;

/// 探测的超时。超过这个时间还没拿到东西就当这个源不可用。
pub const PROBE_TIMEOUT_SECS: u64 = 8;

/// 「够快」的门槛：100 KB/s。低于此值，42.9MB 要下 7 分钟以上。
pub const MIN_SPEED_BPS: f64 = 100.0 * 1024.0;

/// 下载整体超时上限。正常源 2 分钟内下完，这个只是防挂死。
pub const DOWNLOAD_TIMEOUT_SECS: u64 = 900;

/// 镜像前缀表已收敛到 [`crate::mirrors`]，更新与技能市场共用一份。

/// 一个候选下载源。
#[derive(Debug, Clone, Serialize)]
pub struct DownloadSource {
    /// 展示名（给用户看「正在从哪个源下载」）
    pub label: String,
    /// 完整 URL
    pub url: String,
}

/// 探测结果。
#[derive(Debug, Clone)]
pub struct ProbeResult {
    pub label: String,
    pub url: String,
    /// 是否成功拿到数据
    pub ok: bool,
    /// 实际拿到的字节数
    pub bytes: u64,
    /// 耗时（毫秒）
    pub millis: u64,
}

impl ProbeResult {
    /// 失败的结果（探测过程中出错时用）
    fn failed(label: &str, url: &str) -> Self {
        ProbeResult {
            label: label.to_string(),
            url: url.to_string(),
            ok: false,
            bytes: 0,
            millis: 0,
        }
    }
}

/// 吞吐（字节/秒）。
pub fn probe_speed(bytes: u64, millis: u64) -> f64 {
    if millis == 0 {
        return 0.0;
    }
    bytes as f64 / (millis as f64 / 1000.0)
}

/// 从清单给出的资产地址派生候选源。
///
/// 官方直连放在**最后**：它是最权威的源，但在境内最慢。选源时按实测速度
/// 决定是否用镜像（见 [`choose_source`]），所以这个顺序只影响「同速时的偏好」。
///
/// `extra_mirrors` 是**清单下发的**镜像前缀（v0.7.2-rc.2），排在内置表前面：
/// 运营想换镜像只需改一次清单，不用发版。两者按 URL 去重——同一家同时出现在
/// 清单与内置表里时只留一条（清单的那条，标签更好认）。
pub fn candidate_sources(download_url: &str, extra_mirrors: &[String]) -> Vec<DownloadSource> {
    let mut out: Vec<DownloadSource> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for prefix in extra_mirrors {
        let url = format!("{prefix}{download_url}");
        if seen.insert(url.clone()) {
            out.push(DownloadSource {
                label: mirror_label(prefix),
                url,
            });
        }
    }
    for (label, prefix) in MIRRORS {
        let url = format!("{prefix}{download_url}");
        if seen.insert(url.clone()) {
            out.push(DownloadSource {
                label: (*label).to_string(),
                url,
            });
        }
    }
    out.push(DownloadSource {
        label: "GitHub 直连".to_string(),
        url: download_url.to_string(),
    });
    out
}

/// 镜像前缀 → 展示名。用主机名，日志里一眼能看出是哪家。
fn mirror_label(prefix: &str) -> String {
    prefix
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string()
}

/// 从清单里取 `mirrors` 下发表。抽成纯函数好测。
///
/// **只接受 https**：清单本身走镜像分发，一份被投毒的清单不该能把下载导向
/// 任意地址。签名校验能挡住坏文件，但「把用户流量引到第三方」是另一回事，
/// 多一道前缀校验成本几乎为零。
fn parse_mirrors(text: &str) -> Option<Vec<String>> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let arr = v.get("mirrors")?.as_array()?;
    let out: Vec<String> = arr
        .iter()
        .filter_map(|m| m.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| s.starts_with("https://"))
        .collect();
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// 拉取清单里的 `mirrors`。
///
/// 插件的 `RemoteRelease` 不透出自定义字段，所以只能自己再读一遍清单
/// （2KB 级）。按端点顺序尝试，首个给出 mirrors 的即用；全失败返回空，
/// 调用方回退内置表——**清单源全挂时不影响下载**（下载用的是 check 已拿到的句柄）。
async fn fetch_manifest_mirrors(endpoints: &[String]) -> Vec<String> {
    if endpoints.is_empty() {
        return Vec::new();
    }
    let Ok(client) = reqwest::Client::builder()
        .user_agent("aura-updater-manifest")
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
    else {
        return Vec::new();
    };
    for url in endpoints {
        let Ok(resp) = client.get(url).send().await else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(text) = resp.text().await else {
            continue;
        };
        if let Some(list) = parse_mirrors(&text) {
            return list;
        }
    }
    Vec::new()
}

/// 从应用配置里读清单端点（`plugins.updater.endpoints`）。
///
/// 不在 Rust 里硬编码一份：端点顺序是「运营决策」，只应存在于
/// `tauri.conf.json` 一处。两处各写一份迟早会漂。
fn updater_endpoints(app: &AppHandle) -> Vec<String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("endpoints"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| e.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// 按实测结果选源。
///
/// 策略（有意为之，别改）：
/// 1. **官方够快就用官方**——尽量不让用户的下载流量经过第三方。
/// 2. 官方太慢，就用**最快的镜像**。
/// 3. 全都探测失败 → 用官方（权威优先；慢总比下到坏文件强）。
pub fn choose_source(probes: &[ProbeResult]) -> Option<usize> {
    let official = probes.iter().position(|p| p.label == "GitHub 直连");
    let usable: Vec<usize> = probes
        .iter()
        .enumerate()
        .filter(|(_, p)| p.ok && p.bytes > 0)
        .map(|(i, _)| i)
        .collect();
    if usable.is_empty() {
        // 全挂了：还是给官方直连一个机会
        return official.or(Some(0));
    }

    let speed = |i: usize| probe_speed(probes[i].bytes, probes[i].millis);

    // 1) 官方够快就用官方
    if let Some(off) = official {
        if probes[off].ok && speed(off) >= MIN_SPEED_BPS {
            return Some(off);
        }
    }

    // 2) 否则用最快的镜像（只镜像参与，官方仍是兜底）
    let best_mirror = usable
        .iter()
        .copied()
        .filter(|i| Some(*i) != official)
        .max_by(|a, b| speed(*a).partial_cmp(&speed(*b)).unwrap_or(std::cmp::Ordering::Equal));
    if let Some(m) = best_mirror {
        if speed(m) >= MIN_SPEED_BPS {
            return Some(m);
        }
    }

    // 3) 没有一个够快 → 用最快的那个（官方优先，同速取先出现的）
    usable
        .iter()
        .copied()
        .max_by(|a, b| speed(*a).partial_cmp(&speed(*b)).unwrap_or(std::cmp::Ordering::Equal))
}

/// 进度事件（发给前端）。
#[derive(Clone, Serialize)]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    /// 实际使用的源（展示用）
    pub source: String,
}

/// 检查结果（发给前端）。
#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
    /// 候选下载源（前端展示「可用下载源」）
    pub sources: Vec<DownloadSource>,
}

/// 探测一个源的吞吐。只取头 [`PROBE_BYTES`] 字节。
async fn probe_one(source: &DownloadSource) -> ProbeResult {
    let client = match reqwest::Client::builder()
        .user_agent("aura-updater-probe")
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(_) => return ProbeResult::failed(&source.label, &source.url),
    };

    let t0 = Instant::now();
    let resp = match client
        .get(&source.url)
        .header(reqwest::header::RANGE, format!("bytes=0-{}", PROBE_BYTES - 1))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => return ProbeResult::failed(&source.label, &source.url),
    };

    let mut bytes = 0u64;
    let mut resp = resp;
    while let Ok(Some(chunk)) = resp.chunk().await {
        bytes += chunk.len() as u64;
        if bytes >= PROBE_BYTES {
            break;
        }
    }
    if bytes == 0 {
        return ProbeResult::failed(&source.label, &source.url);
    }
    ProbeResult {
        label: source.label.clone(),
        url: source.url.clone(),
        ok: true,
        bytes,
        millis: t0.elapsed().as_millis() as u64,
    }
}

/// 并发探测一组候选源。
///
/// 并发是必须的：串行探测的话，最坏要等 N × 8 秒。并发后总耗时≈最慢的那个。
///
/// 探测函数以参数注入（而不是直接调 `probe_one`），这样编排逻辑
/// （两级探测的短路行为）能在不起网络的情况下被测试覆盖。
async fn probe_all<F, Fut>(sources: &[DownloadSource], probe: F) -> Vec<ProbeResult>
where
    F: Fn(DownloadSource) -> Fut + Clone + Send + 'static,
    Fut: std::future::Future<Output = ProbeResult> + Send + 'static,
{
    let mut handles = Vec::with_capacity(sources.len());
    for s in sources {
        let s = s.clone();
        let p = probe.clone();
        handles.push(tokio::spawn(async move { p(s).await }));
    }
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        out.push(h.await.unwrap_or_else(|_| ProbeResult::failed("", "")));
    }
    out
}

/// 官方直连是否够快，够快就可以短路、完全不碰镜像。
///
/// 判据：拿到了数据 **且** 速度达标。`bytes == 0` 视为没拿到——
/// 只发了个请求、一个字节都没下来，不能算「能用」。
fn official_is_fast_enough(p: &ProbeResult) -> bool {
    p.ok && p.bytes > 0 && probe_speed(p.bytes, p.millis) >= MIN_SPEED_BPS
}

/// 把「官方结果 + 镜像结果」装配成与 `sources` **等长同序**的结果向量。
///
/// # 为什么必须先对齐
///
/// 下载代码用 `sources[chosen]`，而 `chosen` 是 `choose_source` 在 probes 里
/// 返回的下标。只要两个数组的顺序或长度差一点，选源就会错位——选中的是 A，
/// 下载的却是 B，还不报错。所以这里强制：
///
/// - `out.len() == sources.len()`
/// - 前 `len-1` 个位置对应 `sources[..len-1]`（镜像）
/// - 最后一个位置固定是官方（`candidate_sources` 保证官方在末尾）
///
/// 没探测到的位置填 `failed`：`choose_source` 会跳过它们，不会误选。
fn assemble_two_stage(
    sources: &[DownloadSource],
    official: ProbeResult,
    mirrors: Vec<ProbeResult>,
) -> Vec<ProbeResult> {
    let mut out: Vec<ProbeResult> = sources
        .iter()
        .map(|s| ProbeResult::failed(&s.label, &s.url))
        .collect();
    let Some(off) = sources.len().checked_sub(1) else {
        return out;
    };
    for (i, r) in mirrors.into_iter().take(off).enumerate() {
        out[i] = r;
    }
    out[off] = official;
    out
}

/// 两级探测：官方先行，达标即短路；否则再并发探测镜像。
///
/// # 为什么要分两级（而不是 v0.7.0 的 9 路并发）
///
/// 9 路并发各抢 256KB 会**互相挤占带宽**：官方本来能跑 300KB/s，被 8 个镜像
/// 一起抢之后测出来只有 60KB/s，于是误判「官方太慢」而去用镜像——测速结果
/// 自己被测速行为污染了。
///
/// 分两级后：
/// - 官方够快（境外 / 有加速的用户）→ **一次往返**结束，镜像零流量；
/// - 官方不够快（境内典型情况）→ 官方那一路已经退出，镜像测速不再被挤占。
///
/// 代价是「官方慢 + 镜像也慢」时多等一轮（官方探测最长 8s）。
/// 这是有意的取舍：绝大多数用户属于前两种，而不是第三种。
///
/// 探测函数注入，见 [`probe_all`]。测试用它数「到底发了几次探测」，
/// 才能钉住「短路时镜像零流量」这条契约。
async fn probe_two_stage_inner<F, Fut>(
    sources: &[DownloadSource],
    probe: F,
) -> Vec<ProbeResult>
where
    F: Fn(DownloadSource) -> Fut + Clone + Send + 'static,
    Fut: std::future::Future<Output = ProbeResult> + Send + 'static,
{
    if sources.is_empty() {
        return Vec::new();
    }
    let off = sources.len() - 1;
    let official = probe(sources[off].clone()).await;
    if official_is_fast_enough(&official) {
        // 短路：镜像一个都不碰
        return assemble_two_stage(sources, official, Vec::new());
    }
    let mirrors = probe_all(&sources[..off], probe).await;
    assemble_two_stage(sources, official, mirrors)
}

/// 真实的两级探测：官方先行，达标短路，否则并发探测镜像。
async fn probe_two_stage(sources: &[DownloadSource]) -> Vec<ProbeResult> {
    probe_two_stage_inner(sources, |s| async move { probe_one(&s).await }).await
}

/// 检查更新失败时给用户看的完整话术。
///
/// 抽成函数是为了能测：这段文案是「用户能不能自己救自己」的唯一线索——
/// 只说「检查失败」等于把人困死，得把**原始原因**和**手动出路**一起给出来。
fn check_failed_message(reason: &str) -> String {
    format!("检查更新失败：{reason}。可在下方「历史版本下载」手动获取安装包。")
}

/// 检查是否有新版本。
///
/// 清单仍然由插件去取（它配了三个端点、会自动回退），我们只接管**下载**。
/// 返回 `None` 表示已是最新。
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<UpdateInfo>, String> {
    let updater = app
        .updater_builder()
        // 用 schannel 而不是 rustls-platform-verifier：后者每次建连都要做
        // 证书吊销检查，境内吊销服务器不可达，会白等约 10 秒。
        .configure_client(|b| b.use_native_tls())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let update = updater.check().await.map_err(|e| {
        // 检查失败要留原始原因：用户只会说「检查失败」，而真正有用的是
        // 「哪个端点、什么错」。同时把可操作的引导带给前端。
        let reason = e.to_string();
        crate::update_log::log_event("check_failed", &reason);
        check_failed_message(&reason)
    })?;
    let Some(update) = update else {
        return Ok(None);
    };

    // v0.7.2-rc.2：清单可能下发了 mirrors。多一次 2KB 级 GET，失败就回退内置表。
    let mirrors = fetch_manifest_mirrors(&updater_endpoints(&app)).await;
    if !mirrors.is_empty() {
        crate::update_log::log_event(
            "mirrors",
            &format!("manifest delivered {} prefix(es): {}", mirrors.len(), mirrors.join(" ")),
        );
    }
    if let Ok(mut slot) = state.update_mirrors.lock() {
        // 存下来给 download_update 用：同一次更新不该拉两遍清单
        *slot = mirrors.clone();
    }

    let info = UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|d| d.to_string()),
        sources: candidate_sources(update.download_url.as_str(), &mirrors),
    };

    // 存下句柄：安装时复用同一个 Update，不重新查清单。
    // 重新查会多一次网络往返，也多一个让「安装」平白失败的理由。
    {
        let mut slot = state
            .updater
            .lock()
            .map_err(|_| "更新句柄锁已中毒".to_string())?;
        *slot = Some(update);
    }

    Ok(Some(info))
}

/// 下载并安装更新。
///
/// 流程：并发探测候选源 → 选源 → 把 URL 写回 `Update` → 交给插件下载
/// （插件负责 minisign 签名校验）→ 插件安装（Windows 下会拉起安装器并退出本进程）。
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let update = {
        let slot = state
            .updater
            .lock()
            .map_err(|_| "更新句柄锁已中毒".to_string())?;
        slot.clone()
    }
    .ok_or_else(|| "没有待安装的更新，请先检查更新".to_string())?;

    // 复用 check 阶段拉到的清单 mirrors，不再多拉一次清单
    let mirrors = state
        .update_mirrors
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default();
    let sources = candidate_sources(update.download_url.as_str(), &mirrors);
    let probes = probe_two_stage(&sources).await;
    let chosen = choose_source(&probes).ok_or_else(|| "没有可用的下载源".to_string())?;
    let source = sources[chosen].clone();

    // 探测结果落日志：装不动时能看出是「源慢」还是「源挂」。
    // 原来的 eprintln 在 GUI 进程里没有控制台，等于没记。
    for p in &probes {
        crate::update_log::log_event(
            "probe",
            &crate::update_log::probe_line(&p.label, p.ok, p.bytes, p.millis),
        );
    }
    crate::update_log::log_event("chosen", &format!("{} ({})", source.label, source.url));

    let url = Url::parse(&source.url).map_err(|e| format!("下载地址无效: {e}"))?;
    let mut update = update;
    update.download_url = url;
    update.timeout = Some(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS));

    let mut downloaded: u64 = 0;
    let emitter = app.clone();
    let source_label = source.label.clone();
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = emitter.emit(
                    "update:progress",
                    UpdateProgress {
                        downloaded,
                        total,
                        source: source_label.clone(),
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    // 插件的 install 在 Windows 下会拉起安装器并 `std::process::exit(0)`，
    // 所以这里不会正常返回。
    update.install(bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(label: &str, ok: bool, bytes: u64, millis: u64) -> ProbeResult {
        ProbeResult {
            label: label.to_string(),
            url: format!("https://example.test/{label}"),
            ok,
            bytes,
            millis,
        }
    }

    #[test]
    fn speed_is_bytes_per_second() {
        // 512KB 用 1 秒 → 512 KB/s
        assert!((probe_speed(512 * 1024, 1000) - 512.0 * 1024.0).abs() < 1.0);
        // 0 毫秒不能除零
        assert_eq!(probe_speed(100, 0), 0.0);
    }

    #[test]
    fn candidates_include_official_last() {
        let srcs = candidate_sources("https://github.com/o/r/releases/download/v1/a.exe", &[]);
        assert_eq!(srcs.len(), MIRRORS.len() + 1);
        assert_eq!(srcs.last().unwrap().label, "GitHub 直连");
        assert_eq!(
            srcs.last().unwrap().url,
            "https://github.com/o/r/releases/download/v1/a.exe"
        );
        // 镜像地址是把原地址整体包在前面
        assert!(srcs[0].url.ends_with("https://github.com/o/r/releases/download/v1/a.exe"));
        assert!(srcs[0].url.starts_with(MIRRORS[0].1));
    }

    #[test]
    fn official_is_preferred_when_fast_enough() {
        let probes = vec![
            probe("ghfast", true, 256 * 1024, 200),  // 1.25 MB/s
            probe("GitHub 直连", true, 256 * 1024, 500), // 0.5 MB/s
        ];
        // 官方 0.5 MB/s > 门槛 100KB/s → 用官方
        assert_eq!(choose_source(&probes), Some(1));
    }

    #[test]
    fn mirror_wins_when_official_too_slow() {
        let probes = vec![
            probe("ghfast", true, 256 * 1024, 200), // 1.25 MB/s
            probe("GitHub 直连", true, 256 * 1024, 20_000), // 12.8 KB/s，太慢
        ];
        assert_eq!(choose_source(&probes), Some(0));
    }

    #[test]
    fn falls_back_to_official_when_all_probes_fail() {
        let probes = vec![
            probe("ghfast", false, 0, 0),
            probe("GitHub 直连", false, 0, 0),
        ];
        assert_eq!(choose_source(&probes), Some(1));
    }

    #[test]
    fn picks_fastest_when_none_reaches_threshold() {
        // 全都低于门槛：仍然要选一个，不能直接失败
        let probes = vec![
            probe("ghfast", true, 100 * 1024, 5000), // 20 KB/s
            probe("GitHub 直连", true, 50 * 1024, 5000), // 10 KB/s
        ];
        assert_eq!(choose_source(&probes), Some(0));
    }

    #[test]
    fn failed_mirror_is_not_selected() {
        let probes = vec![
            probe("ghfast", false, 0, 0),
            probe("gh-proxy", true, 256 * 1024, 300),
            probe("GitHub 直连", true, 256 * 1024, 30_000),
        ];
        assert_eq!(choose_source(&probes), Some(1));
    }

    // ── 两级探测（v0.7.2-rc.1）────────────────────────────────────

    const ASSET: &str = "https://github.com/o/r/releases/download/v1/a.exe";

    /// 官方够快：镜像一个都不探，只有官方位置有结果。
    #[test]
    fn two_stage_official_fast_skips_mirrors() {
        let sources = candidate_sources(ASSET, &[]);
        let off = sources.len() - 1;
        let official = probe("GitHub 直连", true, 256 * 1024, 500); // 0.5 MB/s

        assert!(
            official_is_fast_enough(&official),
            "0.5 MB/s 高于门槛，应判定为够快"
        );

        // 短路路径：mirrors 传空
        let probes = assemble_two_stage(&sources, official, Vec::new());

        assert_eq!(probes.len(), sources.len());
        for (i, p) in probes.iter().enumerate().take(off) {
            assert!(!p.ok, "短路时镜像 {} 不该被探测", p.label);
            assert_eq!(p.bytes, 0, "未探测的镜像不该有字节数");
            let _ = i;
        }
        assert!(probes[off].ok);
        assert_eq!(
            choose_source(&probes),
            Some(off),
            "官方够快就必须选官方，不能因为镜像位置失败而改变选择"
        );
    }

    /// 官方太慢：镜像全部探测，选中最快的那个。
    #[test]
    fn two_stage_official_slow_probes_mirrors() {
        let sources = candidate_sources(ASSET, &[]);
        let off = sources.len() - 1;
        let official = probe("GitHub 直连", true, 256 * 1024, 20_000); // 12.8 KB/s

        assert!(
            !official_is_fast_enough(&official),
            "12.8 KB/s 低于门槛，应判定为不够快"
        );

        // 模拟 7 路镜像都探了；让第 2 个最快
        let mirrors: Vec<ProbeResult> = sources[..off]
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let millis = if i == 1 { 150 } else { 400 + i as u64 * 100 };
                probe(&s.label, true, 256 * 1024, millis)
            })
            .collect();
        let probes = assemble_two_stage(&sources, official, mirrors);

        assert_eq!(probes.len(), sources.len());
        assert!(probes[..off].iter().all(|p| p.ok), "镜像应全部被探测");
        assert_eq!(
            choose_source(&probes),
            Some(1),
            "官方太慢时应选最快的镜像（下标 1）"
        );
    }

    /// 全挂：仍回落到官方索引，不能返回 None（那会让下载直接失败）。
    #[test]
    fn two_stage_all_fail_falls_back_official() {
        let sources = candidate_sources(ASSET, &[]);
        let off = sources.len() - 1;
        let official = probe("GitHub 直连", false, 0, 0);
        let mirrors: Vec<ProbeResult> = sources[..off]
            .iter()
            .map(|s| probe(&s.label, false, 0, 0))
            .collect();

        let probes = assemble_two_stage(&sources, official, mirrors);

        assert!(probes.iter().all(|p| !p.ok));
        assert_eq!(
            choose_source(&probes),
            Some(off),
            "全挂时 choose_source 必须回落到官方索引"
        );
    }

    /// 结果必须与 sources 等长同序——错位会让「选中的源」与「实际下载的源」不一致。
    #[test]
    fn two_stage_result_aligned_with_sources() {
        let sources = candidate_sources(ASSET, &[]);
        let off = sources.len() - 1;
        let official = probe("GitHub 直连", true, 256 * 1024, 900);
        let official = ProbeResult {
            url: sources[off].url.clone(),
            ..official
        };
        // 按来源的真实 URL 构造，这样 URL 断言才有意义
        let mirrors: Vec<ProbeResult> = sources[..off]
            .iter()
            .map(|s| ProbeResult {
                label: s.label.clone(),
                url: s.url.clone(),
                ok: true,
                bytes: 256 * 1024,
                millis: 500,
            })
            .collect();

        let probes = assemble_two_stage(&sources, official, mirrors);

        assert_eq!(probes.len(), sources.len(), "长度必须与 sources 一致");
        assert_eq!(off, sources.len() - 1, "官方必须在最后一个位置");
        for (i, p) in probes.iter().enumerate() {
            assert_eq!(
                p.label, sources[i].label,
                "第 {i} 个位置的标签与 sources 不一致——选源会错位"
            );
            assert_eq!(p.url, sources[i].url, "第 {i} 个位置的 URL 不一致");
        }
    }

    /// 官方探测「有响应但一个字节都没下来」不算够快。
    #[test]
    fn zero_bytes_is_not_fast_enough() {
        assert!(!official_is_fast_enough(&probe("GitHub 直连", true, 0, 100)));
        assert!(!official_is_fast_enough(&probe("GitHub 直连", false, 256 * 1024, 100)));
    }

    /// **编排层**：官方够快时，探测次数必须是 1（镜像零流量）。
    ///
    /// 上面几个用例只覆盖纯函数；若有人把短路删掉（退化成「总是并发探测 8 路」），
    /// 它们全都不会红。这条用「数探测次数」把短路行为本身钉住。
    #[tokio::test]
    async fn two_stage_short_circuits_on_fast_official() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let sources = candidate_sources(ASSET, &[]);
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();

        let probes = probe_two_stage_inner(&sources, move |s: DownloadSource| {
            let c = c.clone();
            async move {
                c.fetch_add(1, Ordering::SeqCst);
                if s.label == "GitHub 直连" {
                    ProbeResult {
                        label: s.label,
                        url: s.url,
                        ok: true,
                        bytes: 256 * 1024,
                        millis: 200, // 1.25 MB/s
                    }
                } else {
                    ProbeResult::failed(&s.label, &s.url)
                }
            }
        })
        .await;

        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "官方够快时必须只探测 1 次（镜像零流量），实际探测了 {} 次",
            calls.load(Ordering::SeqCst)
        );
        assert_eq!(probes.len(), sources.len());
        assert_eq!(choose_source(&probes), Some(sources.len() - 1));
    }

    /// **编排层**：官方太慢时，镜像必须全部被探测到。
    #[tokio::test]
    async fn two_stage_probes_every_mirror_when_official_slow() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let sources = candidate_sources(ASSET, &[]);
        let off = sources.len() - 1;
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();

        let probes = probe_two_stage_inner(&sources, move |s: DownloadSource| {
            let c = c.clone();
            async move {
                let n = c.fetch_add(1, Ordering::SeqCst);
                let slow = s.label == "GitHub 直连";
                ProbeResult {
                    label: s.label,
                    url: s.url,
                    ok: true,
                    bytes: 256 * 1024,
                    // 官方 12.8 KB/s；镜像越晚越快？不——越晚越慢，
                    // 这样「选最快的镜像」有一个确定的答案（下标 0）
                    millis: if slow { 20_000 } else { 200 + n as u64 * 100 },
                }
            }
        })
        .await;

        assert_eq!(
            calls.load(Ordering::SeqCst),
            sources.len(),
            "官方太慢时官方 + {off} 个镜像都该被探测"
        );
        assert_eq!(choose_source(&probes), Some(0), "应选最快的镜像（下标 0）");
    }

    // ── 清单下发的 mirrors（v0.7.2-rc.2）──────────────────────────

    /// 清单下发的镜像排在内置表**前面**，官方仍在最后。
    #[test]
    fn manifest_mirrors_come_first_and_official_stays_last() {
        let extra = vec!["https://new-mirror.example/".to_string()];
        let srcs = candidate_sources(ASSET, &extra);

        assert_eq!(srcs[0].label, "new-mirror.example");
        assert!(srcs[0].url.starts_with("https://new-mirror.example/https://github.com/"));
        assert_eq!(
            srcs.last().unwrap().label,
            "GitHub 直连",
            "官方必须仍在最后——两级探测按下标认定官方"
        );
        // 内置表没被顶掉（并集，不是替换）
        assert!(
            srcs.iter().any(|s| s.label == "ghfast"),
            "内置镜像必须保留：{:?}",
            srcs.iter().map(|s| &s.label).collect::<Vec<_>>()
        );
    }

    /// 同一家镜像同时出现在清单与内置表时只保留一条。
    #[test]
    fn manifest_mirror_identical_to_builtin_is_deduped() {
        let extra = vec!["https://ghfast.top/".to_string()];
        let srcs = candidate_sources(ASSET, &extra);

        let hits = srcs.iter().filter(|s| s.url.contains("ghfast.top")).count();
        assert_eq!(hits, 1, "重复镜像只该出现一次");
        let gh = srcs.iter().find(|s| s.url.contains("ghfast.top")).unwrap();
        assert_eq!(gh.label, "ghfast.top", "留下的是清单那条（标签是主机名）");
    }

    #[test]
    fn parse_mirrors_reads_array() {
        let text = r#"{"version":"1.0.0","mirrors":["https://a.example/","https://b.example/"]}"#;
        assert_eq!(
            parse_mirrors(text).unwrap(),
            vec!["https://a.example/".to_string(), "https://b.example/".to_string()]
        );
    }

    /// 非 https 的前缀一律丢弃：清单可以决定「从哪下」，不该能把流量引到明文 http。
    #[test]
    fn parse_mirrors_rejects_non_https() {
        let text = r#"{"mirrors":["http://plain.example/","https://ok.example/","ftp://x/"]}"#;
        assert_eq!(
            parse_mirrors(text).unwrap(),
            vec!["https://ok.example/".to_string()]
        );
    }

    #[test]
    fn parse_mirrors_absent_or_empty_yields_none() {
        assert!(parse_mirrors(r#"{"version":"1.0.0"}"#).is_none());
        assert!(parse_mirrors(r#"{"mirrors":[]}"#).is_none());
        assert!(
            parse_mirrors(r#"{"mirrors":["http://a/"]}"#).is_none(),
            "全是非法前缀时等同没有"
        );
        assert!(parse_mirrors("not json").is_none());
    }

    /// 检查失败的文案必须同时含**原始原因**与**手动出路**。
    #[test]
    fn check_failed_message_keeps_reason_and_offers_manual_path() {
        let msg = check_failed_message("error sending request for url (https://v4.gh-proxy.org/...)");
        assert!(
            msg.contains("error sending request for url"),
            "原始原因不能被吞掉，否则用户/开发者都无从判断: {msg}"
        );
        assert!(msg.contains("历史版本下载"), "必须给出手动出路: {msg}");
        assert!(msg.starts_with("检查更新失败："), "首句要直说结论: {msg}");
    }

    /// 清单没有 mirrors 时，候选源与只有内置表时完全一致（零行为变化）。
    #[test]
    fn no_manifest_mirrors_changes_nothing() {
        let a = candidate_sources(ASSET, &[]);
        assert_eq!(a.len(), MIRRORS.len() + 1);
        assert_eq!(a.last().unwrap().label, "GitHub 直连");
        assert_eq!(a[0].label, MIRRORS[0].0);
    }
}
