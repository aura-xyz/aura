//! 本地敏感配置加密（v0.6.0）
//!
//! API Key 此前以明文存进 SQLite。库文件虽然只在本机，但备份、误分享、
//! 其他进程读取都能直接拿到密钥——用户把密钥交给我们，就不能让它
//! 以明文躺着。这里用 Windows DPAPI（`CryptProtectData` /
//! `CryptUnprotectData`）在落盘前加密：
//!
//! - 密文**绑定当前 Windows 用户**：同用户同机透明解密，无需主密码，
//!   对用户与前端链路零感知（`load_config` 解密、`save_config` 加密）。
//! - 附加一段固定熵：无熵时同一用户下的任何进程都能解本应用的密文，
//!   加上熵把「Aura 加密的」与别处加密的区分开。熵不是秘密，
//!   安保来自 DPAPI 的用户绑定本身。
//!
//! **已知取舍**：换 Windows 用户或重装系统后密文不可解密，需要重新
//! 填写密钥。这是透明加密的固有代价，远优于明文。
//!
//! FFI 直接调 crypt32.dll，与 `lib.rs` 的 `win_icon` 同一先例——
//! 两个函数一个结构体，自己声明比引 `windows` crate 轻。
//!
//! 非 Windows 平台未验证（本项目打包与验证仅覆盖 Windows x64）：
//! 直穿明文，仅保证编译通过，**不要在其它平台当作已加密**。

/// 附加熵，加解密必须一致。
const ENTROPY: &[u8] = b"aura-local-secret-v1";

/// 加密，输出 hex 字符串。
///
/// 失败时返回 Err 而非回落明文：调用方（`save_config`）应让保存失败，
/// 静默写成明文等于悄悄拆掉这道防线。
pub fn protect(plain: &str) -> Result<String, String> {
    #[cfg(windows)]
    {
        win::protect(plain.as_bytes(), ENTROPY).map(|bytes| hex_encode(&bytes))
    }
    #[cfg(not(windows))]
    {
        let _ = ENTROPY;
        Ok(plain.to_string())
    }
}

/// 解密 hex 密文。
///
/// 输入不是合法 hex、或不是本应用加密的 blob 时返回 Err——调用方
/// （`load_config`）据此走「旧版明文」兼容分支。
pub fn unprotect(blob: &str) -> Result<String, String> {
    #[cfg(windows)]
    {
        let bytes = hex_decode(blob)?;
        let plain = win::unprotect(&bytes, ENTROPY)?;
        String::from_utf8(plain).map_err(|e| format!("解密结果不是合法 UTF-8: {}", e))
    }
    #[cfg(not(windows))]
    {
        Ok(blob.to_string())
    }
}

#[cfg(windows)]
mod win {
    use std::os::raw::c_void;

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    /// 禁止 DPAPI 弹任何 UI。本应用可能在无窗口上下文的后台路径被调用
    /// （启动加载配置），弹窗会直接挂住。
    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DataBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *const c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
        fn CryptUnprotectData(
            p_data_in: *const DataBlob,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *const c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut c_void) -> *mut c_void;
    }

    fn blob_of(bytes: &[u8]) -> DataBlob {
        DataBlob {
            cb_data: bytes.len() as u32,
            // API 只读输入；win_icon 的先例同样如此转换
            pb_data: bytes.as_ptr() as *mut u8,
        }
    }

    /// 把 DPAPI 输出的 blob 拷成 Vec 并释放原内存。
    ///
    /// 必须拷贝：`pb_data` 由系统分配，只属于本次调用。
    fn take_blob(out: &DataBlob) -> Vec<u8> {
        if out.pb_data.is_null() || out.cb_data == 0 {
            return Vec::new();
        }
        // SAFETY: pb_data/cb_data 由 API 成功返回时保证有效
        let bytes = unsafe { std::slice::from_raw_parts(out.pb_data, out.cb_data as usize) };
        let copied = bytes.to_vec();
        // SAFETY: 只释放 API 分配的这块；LocalFree(null) 亦可
        unsafe { LocalFree(out.pb_data as *mut c_void) };
        copied
    }

    pub fn protect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob_of(data);
        let ent = blob_of(entropy);
        let mut out = DataBlob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        };
        // SAFETY: 全部指针来自本地变量，生命周期覆盖调用；描述符与
        // 提示结构传 null 配合 UI_FORBIDDEN 是文档允许的组合
        let ok = unsafe {
            CryptProtectData(
                &input,
                std::ptr::null(),
                &ent,
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        };
        if ok == 0 {
            return Err(format!(
                "CryptProtectData 失败: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(take_blob(&out))
    }

    pub fn unprotect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob_of(data);
        let ent = blob_of(entropy);
        let mut out = DataBlob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        };
        // SAFETY: 同上；描述符出参传 null（不需要读回说明文字）
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                &ent,
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        };
        if ok == 0 {
            return Err(format!(
                "CryptUnprotectData 失败: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(take_blob(&out))
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        s.push(char::from_digit((b & 0x0f) as u32, 16).unwrap());
    }
    s
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    let s = s.trim();
    if s.len() % 2 != 0 {
        return Err("hex 长度不为偶数".into());
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hi = hex_val(bytes[i])?;
        let lo = hex_val(bytes[i + 1])?;
        out.push((hi << 4) | lo);
        i += 2;
    }
    Ok(out)
}

fn hex_val(b: u8) -> Result<u8, String> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err(format!("非法 hex 字符: {:?}", b as char)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 往返：加密后必须能解回原文，且密文里看不到明文。
    #[test]
    fn protect_then_unprotect_round_trips() {
        let secret = "sk-or-v1-0123456789abcdef";
        let blob = protect(secret).expect("加密不应失败");
        assert_ne!(blob, secret);
        assert!(
            !blob.contains(secret),
            "密文不能包含明文片段: {blob}"
        );
        // 纯 hex：落进 TEXT 列不引入转义问题
        assert!(blob.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(unprotect(&blob).unwrap(), secret);
    }

    /// 熵参与加解密：同一进程内换熵应解不开。
    /// （直接测内部函数，避开模块常量的间接性。）
    #[cfg(windows)]
    #[test]
    fn entropy_must_match_to_decrypt() {
        let blob = win::protect(b"payload", ENTROPY).unwrap();
        assert!(
            win::unprotect(&blob, b"other-entropy").is_err(),
            "熵不一致时必须解不开——否则别的进程能复放我们的密文"
        );
    }

    /// 非 hex 输入（如旧版明文 JSON）必须干净地失败，
    /// 调用方靠这个信号走明文兼容分支。
    #[test]
    fn unprotect_rejects_non_hex() {
        assert!(unprotect("").is_err());
        assert!(unprotect("abc").is_err()); // 奇数长度
        assert!(unprotect("zzzz").is_err()); // 非法字符
        assert!(unprotect(r#"{"api_key":"sk-x"}"#).is_err()); // 明文 JSON
    }

    /// 合法 hex 但不是 DPAPI blob 时同样必须失败——
    /// 否则会把随机字节当明文密钥用下去。
    #[test]
    fn unprotect_rejects_non_dpapi_bytes() {
        let fake = hex_encode(b"this is not a dpapi blob at all!!");
        assert!(unprotect(&fake).is_err());
    }

    /// 空串是合法明文：加密解密都要能处理（清除密钥的路径会存空值）。
    #[test]
    fn empty_string_round_trips() {
        let blob = protect("").unwrap();
        assert_eq!(unprotect(&blob).unwrap(), "");
    }

    #[test]
    fn hex_codec_round_trips_all_bytes() {
        for b in 0u16..=255 {
            let byte = b as u8;
            let s = hex_encode(&[byte, 0xab, 0xff]);
            let back = hex_decode(&s).unwrap();
            assert_eq!(back, vec![byte, 0xab, 0xff]);
        }
    }
}
