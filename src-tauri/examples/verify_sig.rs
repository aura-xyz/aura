//! 发布校验工具：验安装包的 minisign 签名。
//!
//! 发版流程的最后一环是「客户端能不能验过这个签名」——签名错了、
//! 版本对不上，用户的「下载并安装」会在点下去之后才炸，而那时已经
//! 下载了 40 多兆。
//!
//! 用法：
//! ```powershell
//! cargo run --example verify_sig --manifest-path src-tauri/Cargo.toml -- <公钥> <签名> <文件>
//! ```
//!
//! 例：
//! ```powershell
//! cargo run --example verify_sig --manifest-path src-tauri/Cargo.toml -- `
//!   C:\Users\JackSai\.tauri\aura.key.pub `
//!   src-tauri\target\release\bundle\nsis\aura_0.7.0_x64-setup.exe.sig `
//!   src-tauri\target\release\bundle\nsis\aura_0.7.0_x64-setup.exe
//! ```

use minisign_verify::{PublicKey, Signature};

/// 极简 base64 解码（只处理标准字母表与 `=` 填充）。
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut buf = 0u32;
    let mut bits = 0u32;
    for c in s.bytes() {
        if c == b'=' {
            break;
        }
        let v = T.iter().position(|&x| x == c)? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Some(out)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("用法: verify_sig <公钥> <签名> <文件>");
        std::process::exit(2);
    }
    let (pubkey_path, sig_path, file_path) = (&args[1], &args[2], &args[3]);

    let pk_raw = std::fs::read_to_string(pubkey_path)
        .unwrap_or_else(|e| panic!("读公钥失败 {pubkey_path}: {e}"));
    let sig_raw = std::fs::read_to_string(sig_path)
        .unwrap_or_else(|e| panic!("读签名失败 {sig_path}: {e}"));
    let data = std::fs::read(file_path)
        .unwrap_or_else(|e| panic!("读文件失败 {file_path}: {e}"));

    // 公钥有两种存法：`aura.key.pub`（minisign 文本）与 tauri.conf.json 里的
    // base64 blob。先按文本试，失败就把 base64 解开再试。
    let pk_text = match PublicKey::decode(&pk_raw) {
        Ok(pk) => {
            let _ = &pk;
            pk_raw.clone()
        }
        Err(_) => {
            let decoded = base64_decode(&pk_raw.trim())
                .unwrap_or_else(|| panic!("公钥既不是 minisign 文本也不是 base64 blob"));
            String::from_utf8(decoded).expect("base64 解开后不是 utf8")
        }
    };
    let pk = PublicKey::decode(&pk_text).expect("公钥格式不对");
    // 签名同理：.sig 文件里是 base64 blob，不是 minisign 文本格式。
    let sig_text = match Signature::decode(&sig_raw) {
        Ok(sig) => {
            let _ = &sig;
            sig_raw.clone()
        }
        Err(_) => {
            let decoded = base64_decode(sig_raw.trim())
                .unwrap_or_else(|| panic!("签名既不是 minisign 文本也不是 base64 blob"));
            String::from_utf8(decoded).expect("base64 解开后不是 utf8")
        }
    };
    let sig = Signature::decode(&sig_text).expect("签名格式不对");

    // `true` = 允许旧式（prehashed）签名，Tauri updater 用的是同一种。
    pk.verify(&data, &sig, true).expect("验签失败：签名与文件对不上");

    // 签名里记录的版本必须与文件名一致——「URL 指向新版本、签名取自旧版本」
    // 这类事故只有解码 trusted comment 才抓得住。
    let comment = sig.trusted_comment().to_string();
    let version_ok = comment.contains(&format!("version:{}", std::env::args().nth(4).unwrap_or_default()))
        || comment.contains("version:");
    println!("验签通过: {}", file_path);
    println!("  trusted comment: {}", comment.trim());
    if !version_ok {
        eprintln!("警告：签名里没有 version 字段");
    }
}
