//! 密钥存储后端（v0.8.1 C45）。
//!
//! v0.6.0 起，API Key 不再明文躺在库里：Windows 走 DPAPI，Linux 走
//! SecretService。但 Linux 上 SecretService **不一定有**——精简发行版没装
//! gnome-keyring，KDE 下没开 Wallet 兼容层，都会失败。
//!
//! 旧实现的失败方式是「保存直接报错」：用户配好 Key 却存不进去，
//! 界面上只说「保存失败」，既不知道缺什么，也没有替代方案。
//!
//! 这里把存储抽象成 [`KeyStore`]，给出三档实现：
//!
//! | 后端 | 适用 | 强度 |
//! |---|---|---|
//! | [`DpapiStore`] | Windows | 强：绑定当前用户，密钥不进用户态 |
//! | [`SystemKeyringStore`] | 有 SecretService 的 Linux | 强：交给系统密钥环 |
//! | [`FileEncryptedStore`] | 其余 Linux | **弱**：主密钥与密文同盘，靠文件权限兜底 |
//!
//! 降级档必须**明说**：设置页要显示「当前使用应用内文件加密，弱于系统
//! 密钥环」，否则用户以为自己的 Key 进了系统密钥环。
//!
//! ## blob 前缀
//!
//! 密文带类型前缀（`aurafile:v1:`），读取时按前缀分派——用户可能先在
//! 有 SecretService 的机器上保存过 Key，之后换到没有的机器上；反过来
//! 也一样。前缀让每种密文只由对应的后端解开。

use std::path::{Path, PathBuf};

use base64::Engine;

#[cfg(not(windows))]
use crate::secure::KEYRING_HINT;

/// 密钥存储后端。
pub trait KeyStore: Sync {
    /// 存：把明文交给后端，返回可持久化的 blob。
    fn save(&self, plain: &str) -> Result<String, String>;
    /// 取：按 blob 取回明文。
    fn load(&self, blob: &str) -> Result<String, String>;
    /// 后端当前是否可用（探测结果，不做写操作）。
    fn available(&self) -> bool;
    /// 后端名称（设置页展示）。
    fn name(&self) -> &'static str;
    /// 保护强度说明。
    fn strength(&self) -> &'static str;
}

/// 文件加密档的 blob 前缀。
pub const FILE_PREFIX: &str = "aurafile:v1:";
/// 系统密钥环档的 blob 前缀（沿用 v0.6.0 的写法，单一来源在 secure.rs）。
#[cfg(not(windows))]
pub const KEYRING_PREFIX: &str = crate::secure::KEYRING_MARKER;

/// Windows 上没有密钥环档，但前缀常量仍要存在（分派逻辑里要用到）。
#[cfg(windows)]
pub const KEYRING_PREFIX: &str = "keyring:";

/// 应用数据目录。启动时由 `set_data_dir` 注入（文件加密档要在那里放主密钥）。
///
/// 用 Mutex 而不是 OnceLock：测试会在不同临时目录之间切换，
/// OnceLock 一旦设定就改不动了。
static DATA_DIR: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

/// 设置应用数据目录。拿不到时文件加密档不可用。
pub fn set_data_dir(dir: PathBuf) {
    let mut guard = DATA_DIR.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(dir);
}

fn data_dir() -> Option<PathBuf> {
    DATA_DIR
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

// ── Windows：DPAPI ───────────────────────────────────────────
/// Windows DPAPI。密文是纯 hex（沿用 v0.6.0 的格式，便于旧库直接读）。
pub struct DpapiStore;

impl KeyStore for DpapiStore {
    fn save(&self, plain: &str) -> Result<String, String> {
        #[cfg(windows)]
        {
            let bytes = crate::secure::win::protect(plain.as_bytes(), crate::secure::ENTROPY)
                .map_err(|e| e.to_string())?;
            Ok(crate::secure::hex_encode(&bytes))
        }
        #[cfg(not(windows))]
        {
            let _ = plain;
            Err("DPAPI 只在 Windows 可用".into())
        }
    }

    fn load(&self, blob: &str) -> Result<String, String> {
        #[cfg(windows)]
        {
            let bytes = crate::secure::hex_decode(blob)?;
            let plain = crate::secure::win::unprotect(&bytes, crate::secure::ENTROPY)?;
            String::from_utf8(plain).map_err(|e| format!("解密结果不是合法 UTF-8: {e}"))
        }
        #[cfg(not(windows))]
        {
            let _ = blob;
            Err("DPAPI 只在 Windows 可用".into())
        }
    }

    fn available(&self) -> bool {
        cfg!(windows)
    }

    fn name(&self) -> &'static str {
        "Windows DPAPI"
    }

    fn strength(&self) -> &'static str {
        "强：密钥由 Windows 解密，绑定当前用户"
    }
}

// ── Linux：SecretService ─────────────────────────────────────
/// 系统密钥环（SecretService）。
pub struct SystemKeyringStore;

impl KeyStore for SystemKeyringStore {
    fn save(&self, plain: &str) -> Result<String, String> {
        #[cfg(not(windows))]
        {
            let kr = keyring::Entry::new(crate::secure::KEYRING_SERVICE, crate::secure::KEYRING_USER);
            kr.set_password(plain)
                .map_err(|e| format!("保存 API Key 失败：{e}。{KEYRING_HINT}"))?;
            Ok(format!("{KEYRING_PREFIX}"))
        }
        #[cfg(windows)]
        {
            let _ = plain;
            Err("系统密钥环只在非 Windows 平台使用".into())
        }
    }

    fn load(&self, blob: &str) -> Result<String, String> {
        #[cfg(not(windows))]
        {
            let _ = blob;
            let kr = keyring::Entry::new(crate::secure::KEYRING_SERVICE, crate::secure::KEYRING_USER);
            kr.get_password()
                .map_err(|e| format!("读取 API Key 失败：{e}。{KEYRING_HINT}"))
        }
        #[cfg(windows)]
        {
            let _ = blob;
            Err("系统密钥环只在非 Windows 平台使用".into())
        }
    }

    fn available(&self) -> bool {
        #[cfg(not(windows))]
        {
            // 探一个不存在的条目：**只读**，不往用户密钥环里写东西。
            // 「条目不存在」说明服务是通的；其他错误（连不上 D-Bus、
            // 没有 SecretService）才算不可用。
            let kr = keyring::Entry::new(crate::secure::KEYRING_SERVICE, "__aura_probe__");
            match kr.get_password() {
                Ok(_) => true,
                Err(keyring::Error::NoEntry) => true,
                Err(_) => false,
            }
        }
        #[cfg(windows)]
        {
            false
        }
    }

    fn name(&self) -> &'static str {
        "系统密钥环（SecretService）"
    }

    fn strength(&self) -> &'static str {
        "强：密钥交给系统密钥环保管"
    }
}

// ── 降级档：应用内文件加密 ───────────────────────────────────
/// 应用内文件加密（AES-256-GCM）。
///
/// **强度弱于系统密钥环**：主密钥文件与密文在同一块磁盘上，
/// 拿到磁盘的人两个都能拿到。它挡的是「明文躺在库里」和「随手看一眼
/// 配置文件」这两种情形，挡不住有 root 的攻击者。
///
/// 因此设置页必须显示这一点，让用户知情。
pub struct FileEncryptedStore;

impl FileEncryptedStore {
    /// 主密钥文件路径。
    fn key_path() -> Option<PathBuf> {
        data_dir().map(|d| d.join("keystore").join("master.key"))
    }

    /// 读取或生成主密钥。
    ///
    /// 生成时必须用 0600 权限（Unix）：文件型密钥的强度全靠这个权限，
    /// 默认的 0644 等于把密钥公开给同机其他用户。
    fn master_key() -> Result<Vec<u8>, String> {
        let path = Self::key_path()
            .ok_or_else(|| "未找到应用数据目录，无法使用文件加密档".to_string())?;
        if let Ok(existing) = std::fs::read(&path) {
            if existing.len() == 32 {
                return Ok(existing);
            }
            // 长度不对：主密钥文件被改过或损坏，绝不能拿它去「解密」
            // ——用错误的密钥解出来的密文会被当成垃圾，直接覆盖更安全。
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("无法创建密钥目录：{e}"))?;
        }
        let mut key = vec![0u8; 32];
        getrandom::getrandom(&mut key).map_err(|e| format!("无法生成随机主密钥：{e}"))?;
        write_private(&path, &key)?;
        Ok(key)
    }
}

/// 写文件并把权限收紧到 0600（Unix）。
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| format!("无法写入主密钥文件：{e}"))?;
        f.write_all(bytes)
            .map_err(|e| format!("无法写入主密钥文件：{e}"))?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, bytes).map_err(|e| format!("无法写入主密钥文件：{e}"))
    }
}

impl KeyStore for FileEncryptedStore {
    fn save(&self, plain: &str) -> Result<String, String> {
        use aes_gcm::aead::{Aead, KeyInit};
        use aes_gcm::{Aes256Gcm, Key, Nonce};

        let key = Self::master_key()?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let mut nonce_bytes = [0u8; 12];
        getrandom::getrandom(&mut nonce_bytes).map_err(|e| format!("无法生成随机数：{e}"))?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, plain.as_bytes())
            .map_err(|_| "加密失败".to_string())?;

        let mut payload = nonce_bytes.to_vec();
        payload.extend_from_slice(&ciphertext);
        Ok(format!(
            "{FILE_PREFIX}{}",
            base64::engine::general_purpose::STANDARD.encode(payload)
        ))
    }

    fn load(&self, blob: &str) -> Result<String, String> {
        use aes_gcm::aead::{Aead, KeyInit};
        use aes_gcm::{Aes256Gcm, Key, Nonce};

        let payload_b64 = blob.strip_prefix(FILE_PREFIX).unwrap_or(blob);
        let payload = base64::engine::general_purpose::STANDARD
            .decode(payload_b64)
            .map_err(|_| "密文格式损坏".to_string())?;
        if payload.len() < 13 {
            return Err("密文长度不足".into());
        }
        let (nonce_bytes, ciphertext) = payload.split_at(12);
        let key = Self::master_key()?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let plain = cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|_| "解密失败：主密钥与密文不匹配".to_string())?;
        String::from_utf8(plain).map_err(|e| format!("解密结果不是合法 UTF-8: {e}"))
    }

    fn available(&self) -> bool {
        Self::key_path().is_some()
    }

    fn name(&self) -> &'static str {
        "应用内文件加密（降级档）"
    }

    fn strength(&self) -> &'static str {
        "弱：主密钥与密文同盘，仅靠文件权限保护，弱于系统密钥环"
    }
}

// ── 选择与分派 ───────────────────────────────────────────────

/// 后端种类。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreKind {
    Dpapi,
    Keyring,
    File,
}

/// 选定的后端。
///
/// 用**枚举**而不是 trait 对象：三个后端都是零大小结构体，枚举能直接
/// 放进 `OnceLock`，不用和 trait 对象的 `Sync` 约束较劲。
/// 真正的行为差异仍然由 [`KeyStore`] 的三个实现承担。
#[derive(Debug, Clone, Copy)]
pub struct Store {
    kind: StoreKind,
}

impl Store {
    pub fn kind(&self) -> StoreKind {
        self.kind
    }

    fn backend(&self) -> &'static dyn KeyStore {
        match self.kind {
            StoreKind::Dpapi => &DpapiStore,
            StoreKind::Keyring => &SystemKeyringStore,
            StoreKind::File => &FileEncryptedStore,
        }
    }

    pub fn save(&self, plain: &str) -> Result<String, String> {
        match self.backend().save(plain) {
            Ok(blob) => Ok(blob),
            Err(primary_err) => {
                // 主后端写失败时降级到文件加密档。
                //
                // 典型场景：Linux 上 SecretService 的「可用」探针只做只读探测
                // （读一个不存在的条目），能连通就判定可用；但真正写入时若密钥环
                // 集合被锁、或 DBus 会话不可写，set_password 会失败。此时若直接
                // 返回错误，连同 `save_config` 在内的所有配置保存都会失败——
                // 表现为「模型列表有模型却切换不了」这类看似无关的故障。
                //
                // C45 的口径是「宁可弱，也不能让用户存不进 Key」，配置保存同理：
                // 降级档的密文带 `aurafile:v1:` 前缀，unprotect 会按前缀路由回来。
                if !matches!(self.kind, StoreKind::File) && FileEncryptedStore.available() {
                    FileEncryptedStore.save(plain).map_err(|file_err| {
                        format!("{primary_err}；降级到文件加密也失败：{file_err}")
                    })
                } else {
                    Err(primary_err)
                }
            }
        }
    }

    pub fn load(&self, blob: &str) -> Result<String, String> {
        self.backend().load(blob)
    }

    pub fn available(&self) -> bool {
        self.backend().available()
    }

    pub fn name(&self) -> &'static str {
        self.backend().name()
    }

    pub fn strength(&self) -> &'static str {
        self.backend().strength()
    }
}

/// 当前应当使用的后端。
///
/// 优先系统级：Windows 用 DPAPI，Linux 有 SecretService 就用它。
/// 都没有时退回文件加密档——**宁可弱，也不能让用户存不进 Key**。
pub fn choose_store() -> &'static Store {
    static STORE: std::sync::OnceLock<Store> = std::sync::OnceLock::new();
    STORE.get_or_init(|| {
        let kind = if cfg!(windows) {
            StoreKind::Dpapi
        } else {
            let keyring = SystemKeyringStore;
            if keyring.available() {
                StoreKind::Keyring
            } else {
                StoreKind::File
            }
        };
        Store { kind }
    })
}

/// 当前后端的可用性与强度描述（设置页展示）。
pub fn store_status() -> (String, String, bool) {
    let store = choose_store();
    (
        store.name().to_string(),
        store.strength().to_string(),
        store.available(),
    )
}

/// 按当前后端加密。
pub fn protect(plain: &str) -> Result<String, String> {
    choose_store().save(plain)
}

/// 按 blob 前缀分派解密。
///
/// 前缀缺失的 blob 走「旧格式」分支：Windows 认为是 DPAPI hex，
/// 非 Windows 认为是 v0.6.0 之前的明文（直接原样返回）。
pub fn unprotect(blob: &str) -> Result<String, String> {
    if let Some(rest) = blob.strip_prefix(FILE_PREFIX) {
        return FileEncryptedStore.load(rest);
    }
    if blob.starts_with(KEYRING_PREFIX) {
        return SystemKeyringStore.load(blob);
    }
    #[cfg(windows)]
    {
        DpapiStore.load(blob)
    }
    #[cfg(not(windows))]
    {
        // v0.6.0 之前是明文；解密失败也按明文返回，调用方据此走兼容分支
        Ok(blob.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 数据目录是全局的，两个用例会互相踩：串行执行 + 共用一个目录。
    static DIR_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn test_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aura-ks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        set_data_dir(dir.clone());
        dir
    }

    /// 文件加密档往返：密文不含明文，且带类型前缀。
    #[test]
    fn file_store_round_trips() {
        let _guard = DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = test_dir();

        let store = FileEncryptedStore;
        let secret = "sk-or-v1-0123456789abcdef";
        let blob = store.save(secret).expect("应能加密");
        assert!(blob.starts_with(FILE_PREFIX), "{blob}");
        assert!(!blob.contains(secret));
        assert_eq!(store.load(&blob).unwrap(), secret);

        // 主密钥文件必须是 0600（Unix）
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let key_path = FileEncryptedStore::key_path().unwrap();
            let mode = std::fs::metadata(&key_path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "主密钥文件权限必须是 0600");
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 密文被篡改必须失败，而不是返回垃圾。
    #[test]
    fn file_store_rejects_tampered_ciphertext() {
        let _guard = DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = test_dir();

        let store = FileEncryptedStore;
        let blob = store.save("hello").unwrap();
        let mut payload = base64::engine::general_purpose::STANDARD
            .decode(blob.strip_prefix(FILE_PREFIX).unwrap())
            .unwrap();
        let last = payload.len() - 1;
        payload[last] ^= 0xff;
        let broken = format!(
            "{FILE_PREFIX}{}",
            base64::engine::general_purpose::STANDARD.encode(payload)
        );
        assert!(store.load(&broken).is_err(), "篡改后的密文必须解密失败");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 分派：不同前缀走不同后端，不能串。
    #[test]
    fn dispatch_follows_prefix() {
        // keyring 前缀在 Linux 上会真的去问系统密钥环（大概率失败），
        // 但**不该**走到文件档或明文分支去。
        if cfg!(not(windows)) {
            let err = unprotect("keyring:").unwrap_err();
            assert!(err.contains("API Key") || err.contains("keyring"), "{err}");
        }
        // 无前缀的旧 blob：Windows 走 DPAPI（失败），其他平台按明文返回
        if cfg!(not(windows)) {
            assert_eq!(unprotect("{\"api_key\":\"sk-x\"}").unwrap(), "{\"api_key\":\"sk-x\"}");
        }
    }

    /// 后端选择的降级顺序：Windows 永远 DPAPI；Linux 有密钥环就用密钥环。
    #[test]
    fn choose_store_prefers_system_backends() {
        let store = choose_store();
        if cfg!(windows) {
            assert_eq!(store.name(), "Windows DPAPI");
        } else if SystemKeyringStore.available() {
            assert_eq!(store.name(), "系统密钥环（SecretService）");
        } else {
            assert_eq!(store.name(), "应用内文件加密（降级档）");
        }
    }
}
