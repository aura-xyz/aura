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

/// 探测时取的字节数。只取头一段就够判断快慢，不必下整个安装包。
pub const PROBE_BYTES: u64 = 256 * 1024;

/// 探测的超时。超过这个时间还没拿到东西就当这个源不可用。
pub const PROBE_TIMEOUT_SECS: u64 = 8;

/// 「够快」的门槛：100 KB/s。低于此值，42.9MB 要下 7 分钟以上。
pub const MIN_SPEED_BPS: f64 = 100.0 * 1024.0;

/// 下载整体超时上限。正常源 2 分钟内下完，这个只是防挂死。
pub const DOWNLOAD_TIMEOUT_SECS: u64 = 900;

/// 镜像前缀表。
///
/// 镜像都是第三方服务，可能随时下线或变慢——所以它们只是**候选**，
/// 选源逻辑会实测速度，并且失败会自动回退。官方直连永远在候选里。
const MIRRORS: &[(&str, &str)] = &[
    ("ghfast", "https://ghfast.top/"),
    ("gh-proxy", "https://gh-proxy.com/"),
];

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
pub fn candidate_sources(download_url: &str) -> Vec<DownloadSource> {
    let mut out: Vec<DownloadSource> = Vec::new();
    for (label, prefix) in MIRRORS {
        out.push(DownloadSource {
            label: (*label).to_string(),
            url: format!("{prefix}{download_url}"),
        });
    }
    out.push(DownloadSource {
        label: "GitHub 直连".to_string(),
        url: download_url.to_string(),
    });
    out
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

/// 并发探测所有候选源。
///
/// 并发是必须的：串行探测的话，最坏要等 N × 8 秒。并发后总耗时≈最慢的那个。
async fn probe_all(sources: &[DownloadSource]) -> Vec<ProbeResult> {
    let mut handles = Vec::new();
    for s in sources {
        let s = s.clone();
        handles.push(tokio::spawn(async move { probe_one(&s).await }));
    }
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        out.push(h.await.unwrap_or_else(|_| ProbeResult::failed("", "")));
    }
    out
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

    let update = updater.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else {
        return Ok(None);
    };

    let info = UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|d| d.to_string()),
        sources: candidate_sources(update.download_url.as_str()),
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

    let sources = candidate_sources(update.download_url.as_str());
    let probes = probe_all(&sources).await;
    let chosen = choose_source(&probes).ok_or_else(|| "没有可用的下载源".to_string())?;
    let source = sources[chosen].clone();

    // 探测结果落日志：装不动时能看出是「源慢」还是「源挂」
    for p in &probes {
        if p.ok {
            eprintln!(
                "[aura] 更新源 {} 探测 {:.2} KB/s",
                p.label,
                probe_speed(p.bytes, p.millis) / 1024.0
            );
        } else {
            eprintln!("[aura] 更新源 {} 探测失败", p.label);
        }
    }
    eprintln!("[aura] 选用更新源：{}", source.label);

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
        let srcs = candidate_sources("https://github.com/o/r/releases/download/v1/a.exe");
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
}
