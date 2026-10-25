//! 下载源速度探针（开发工具，不参与应用构建）。
//!
//! 用途：量化「安装包到底从哪一段链路下载、有多快」。
//!
//! 用法：
//! ```powershell
//! cargo run --example tls_probe --manifest-path src-tauri/Cargo.toml -- <url> [字节数]
//! ```
//!
//! 不传 url 时跑默认的两组对比（默认后端 vs rustls）。

use std::time::Instant;

use reqwest::header::RANGE;

const API: &str = "https://api.github.com";
const ASSET: &str =
    "https://github.com/aura-xyz/aura/releases/download/v0.6.3/Aura_0.6.3_win_x64_Setup.exe";

/// 下载前 N 字节，量出实际吞吐（MB/s）。
async fn timed_download(label: &str, url: &str, bytes: u64) {
    let client = reqwest::Client::builder()
        .user_agent("aura-tls-probe")
        .build()
        .expect("构造客户端失败");
    let t0 = Instant::now();
    match client
        .get(url)
        .header(RANGE, format!("bytes=0-{bytes}"))
        .send()
        .await
    {
        Ok(mut r) => {
            let status = r.status().as_u16();
            let final_url = r.url().to_string();
            let mut total = 0u64;
            while let Ok(Some(c)) = r.chunk().await {
                total += c.len() as u64;
            }
            let dur = t0.elapsed();
            let mb = total as f64 / 1024.0 / 1024.0;
            let speed = if dur.as_secs_f64() > 0.0 {
                mb / dur.as_secs_f64()
            } else {
                0.0
            };
            println!(
                "  {label:<22} {:>6.2} MB / {:>6.2}s = {:>6.2} MB/s  status={status}",
                mb,
                dur.as_secs_f64(),
                speed
            );
            println!("      最终地址: {final_url}");
        }
        Err(e) => {
            println!(
                "  {label:<22} 失败 {:>6.2}s  {e}",
                t0.elapsed().as_secs_f64()
            );
        }
    }
}

/// 只测建连 + 响应头。
async fn timed_head(label: &str, url: &str) {
    let client = reqwest::Client::builder()
        .user_agent("aura-tls-probe")
        .build()
        .expect("构造客户端失败");
    let t0 = Instant::now();
    match client.get(url).send().await {
        Ok(r) => println!(
            "  {label:<22} 建连+响应头 {:>6} ms  status={}  final={}",
            t0.elapsed().as_millis(),
            r.status().as_u16(),
            r.url()
        ),
        Err(e) => println!(
            "  {label:<22} 失败 {:>6} ms  {e}",
            t0.elapsed().as_millis()
        ),
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let n = 2 * 1024 * 1024;

    if args.len() >= 2 {
        // 传入 URL：先看响应头与最终地址，再量吞吐
        let url = args[1].clone();
        let bytes = args
            .get(2)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(n);
        println!("== 单源探测: {url}");
        timed_head("建连", &url).await;
        timed_download("下载", &url, bytes).await;
        return;
    }

    println!("== 默认对比（默认后端 vs rustls）==");
    let native = reqwest::Client::builder()
        .user_agent("aura-tls-probe")
        .build()
        .expect("构造 native-tls 客户端失败");
    let t0 = Instant::now();
    match native.get(API).send().await {
        Ok(r) => println!(
            "  默认   建连+响应头 {:>6} ms  status={}",
            t0.elapsed().as_millis(),
            r.status().as_u16()
        ),
        Err(e) => println!("  默认   失败 {:>6} ms  {e}", t0.elapsed().as_millis()),
    }

    let rustls = reqwest::Client::builder()
        .user_agent("aura-tls-probe")
        .use_rustls_tls()
        .build()
        .expect("构造 rustls 客户端失败");
    let t0 = Instant::now();
    match rustls.get(API).send().await {
        Ok(r) => println!(
            "  rustls 建连+响应头 {:>6} ms  status={}",
            t0.elapsed().as_millis(),
            r.status().as_u16()
        ),
        Err(e) => println!("  rustls 失败 {:>6} ms  {e}", t0.elapsed().as_millis()),
    }

    println!();
    println!("== 各下载源吞吐 ==");
    timed_download("github release", ASSET, n).await;
}
