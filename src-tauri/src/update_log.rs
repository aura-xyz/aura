//! 后台流程的落盘日志（v0.7.2-rc.2）：**更新为主**，另含少数桌面集成事件。
//!
//! # 为什么必须落盘
//!
//! 更新失败时用户能提供的信息只有「点了没反应」或「提示失败了」。而真正有用的
//! 东西——探了哪些源、每个源多快、最后选了谁、清单为什么解析失败——原来只走
//! `eprintln!`。这是个 Windows GUI 进程，**没有控制台**，那些行等于扔进黑洞。
//!
//! v0.7.0 排查「42.9MB 下到 10MB 失败」时就吃过这个亏：只能靠用户口头描述。
//!
//! # 事件类型
//!
//! | kind | 来源 | 用途 |
//! |---|---|---|
//! | `probe` | 下载前探测 | 每源字节数/耗时/速度/成功与否 |
//! | `chosen` | 选源 | 最终选了哪个源 |
//! | `check_failed` | 检查更新 | 原始错误（含端点与解析失败原因） |
//! | `notify` | 系统通知 | 发送失败原因（「任务跑完没提示」的线索） |
//! | `cleanup` | 启动 | 清理空会话条数（改过库的动作留痕） |
//!
//! # 契约
//!
//! - 位置：`app_data_dir/logs/updater.log`，一行一条 `[RFC3339] kind message`。
//! - 单文件上限 1 MB，超了改名成 `.old`（**只留一代**，不会无限长）。
//! - **日志永远不能影响主流程**：目录建不出来、磁盘满、文件被占用，
//!   一律静默吞掉。宁可不记日志，也不能因为日志写失败而让更新失败。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// 单文件上限。超过就轮转。
pub const MAX_LOG_BYTES: u64 = 1024 * 1024;

/// 日志目录。启动时由 `lib.rs` 登记；未登记（单测、早期调用）时静默不写。
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 串行化写入。
///
/// 探测是并发的（7 个镜像同时跑），不加锁的话多个 `write_all` 会交错，
/// 日志行被从中间劈开就没法看了。
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 登记日志目录（`app_data_dir/logs`）。
///
/// 只生效一次：进程内日志目录是固定的。
pub fn init(dir: PathBuf) {
    let _ = LOG_DIR.set(dir);
}

/// 记一条更新事件。`kind` 见模块文档里的三类：`probe` / `chosen` / `check_failed`。
pub fn log_event(kind: &str, msg: &str) {
    let Some(dir) = LOG_DIR.get() else {
        return;
    };
    append_to(dir, kind, msg);
}

/// 实际写入。抽成独立函数是为了能测——全局目录只能 `set` 一次。
pub fn append_to(dir: &Path, kind: &str, msg: &str) {
    // 锁中毒也不能让更新流程跟着炸：拿不到锁就放弃这条日志
    let Ok(_guard) = WRITE_LOCK.lock() else {
        return;
    };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let path = dir.join("updater.log");
    rotate_if_needed(&path);

    let line = format!("[{}] {} {}\n", timestamp(), kind, msg);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(line.as_bytes());
    }
}

/// 超过上限就把当前文件挪成 `.old`（覆盖上一代）。
///
/// Windows 上 `rename` 到已存在的目标会失败，所以先删旧的。
fn rotate_if_needed(path: &Path) {
    let Ok(meta) = std::fs::metadata(path) else {
        return; // 文件还不存在：不需要轮转
    };
    if meta.len() < MAX_LOG_BYTES {
        return;
    }
    let mut old = path.as_os_str().to_owned();
    old.push(".old");
    let old = PathBuf::from(old);
    let _ = std::fs::remove_file(&old);
    let _ = std::fs::rename(path, &old);
}

/// 本地时间（带偏移）的 RFC3339。取不到本地时退回 UTC。
fn timestamp() -> String {
    use time::format_description::well_known::Rfc3339;
    let now = time::OffsetDateTime::now_local().unwrap_or_else(|_| time::OffsetDateTime::now_utc());
    now.format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// 把探测结果格式化成一条 `probe` 记录的正文。
///
/// 单独抽出来是因为它承载「源慢还是源挂」这个判断依据，
/// 格式要稳定（以后脚本可能按这个解析）。
pub fn probe_line(label: &str, ok: bool, bytes: u64, millis: u64) -> String {
    if ok {
        format!(
            "{} ok bytes={} millis={} speed={:.1}KB/s",
            label,
            bytes,
            millis,
            crate::updater::probe_speed(bytes, millis) / 1024.0
        )
    } else {
        format!("{label} failed")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("aura_updatelog_{tag}"));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn appends_readable_line_with_timestamp_and_kind() {
        let d = temp_dir("append");
        append_to(&d, "probe", "ghfast ok bytes=262144 millis=300");
        append_to(&d, "chosen", "ghfast");

        let text = std::fs::read_to_string(d.join("updater.log")).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2, "两条独立记录，不能粘在一起: {text}");

        // 形如 `[2026-11-01T18:53:38+08:00] probe ...`
        assert!(lines[0].starts_with('['), "行首必须是时间戳: {}", lines[0]);
        let close = lines[0].find(']').expect("时间戳必须闭合");
        let ts = &lines[0][1..close];
        assert!(
            ts.contains('T') && (ts.ends_with('Z') || ts.contains('+') || ts.len() > 19),
            "时间戳必须是 RFC3339: {ts}"
        );
        assert!(lines[0].contains(" probe "), "缺少 kind: {}", lines[0]);
        assert!(lines[0].ends_with("millis=300"), "正文被截断: {}", lines[0]);
        assert!(lines[1].contains(" chosen ghfast"));

        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn rotates_to_old_once_and_keeps_logging() {
        let d = temp_dir("rotate");
        std::fs::create_dir_all(&d).unwrap();
        let path = d.join("updater.log");
        // 直接把文件撑到上限，不靠跑 1MB 的真实事件
        std::fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize]).unwrap();

        append_to(&d, "chosen", "after-rotate");

        let old = d.join("updater.log.old");
        assert!(old.exists(), "超限后必须轮转到 .old");
        assert_eq!(
            std::fs::metadata(&old).unwrap().len(),
            MAX_LOG_BYTES,
            "旧文件应整体挪走"
        );
        let fresh = std::fs::read_to_string(&path).unwrap();
        assert!(fresh.contains("after-rotate"), "轮转后必须继续写新文件: {fresh}");
        assert!(
            fresh.len() < 1024,
            "轮转后应是全新的小文件，实际 {} 字节",
            fresh.len()
        );

        // 再撑满一次：只保留一代，.old 被覆盖而不是堆积
        std::fs::write(&path, vec![b'y'; MAX_LOG_BYTES as usize]).unwrap();
        append_to(&d, "chosen", "second-rotate");
        let old2 = std::fs::read(&old).unwrap();
        assert!(old2.iter().all(|b| *b == b'y'), ".old 应被最新一代覆盖");
        let files: Vec<String> = std::fs::read_dir(&d)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(files.len(), 2, "只该有 updater.log 与 .old，实际 {files:?}");

        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn write_failure_is_silent() {
        // 目录位置是个**文件** → create_dir_all 必然失败。
        // 要求：不 panic、不返回值（调用方无需处理）。
        let d = temp_dir("bad");
        std::fs::create_dir_all(d.parent().unwrap()).ok();
        std::fs::write(&d, b"i am a file, not a dir").unwrap();
        append_to(&d, "probe", "should be dropped silently");
        let _ = std::fs::remove_file(&d);
    }

    #[test]
    fn probe_line_formats_speed() {
        // 256KB / 200ms = 1.25 MB/s = 1280 KB/s
        let line = probe_line("ghfast", true, 256 * 1024, 200);
        assert!(line.starts_with("ghfast ok bytes=262144 millis=200"), "{line}");
        assert!(line.contains("1280.0KB/s"), "速度应换算成 KB/s: {line}");
        assert_eq!(probe_line("gh-proxy-v4", false, 0, 0), "gh-proxy-v4 failed");
    }
}
