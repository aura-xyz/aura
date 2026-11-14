//! 自动重连的退避策略（v0.8.1 · M2-10）。
//!
//! 纯计算，不碰 tokio / 子进程：间隔与次数上限都能脱离真实连接单测。
//! 一期「崩溃后不自动重启」是从严策略；二期把它做成可选项，默认仍关闭。

use std::time::Duration;

/// 最多尝试次数。到顶就置 Down，交给用户手动重连。
pub const MAX_RECONNECT_ATTEMPTS: usize = 5;
const MAX_DELAY_SECS: u64 = 30;
/// 单台服务器允许的并发 `tools/call` 上限。
pub const MAX_CONCURRENT_CALLS: usize = 3;

/// 第 `attempt` 次（0-based）重连前的等待：1 → 2 → 4 → 8 → 16 秒，
/// 之后一律封顶 30 秒。用饱和幂避免下标过大溢出。
pub fn reconnect_delay(attempt: usize) -> Duration {
    let shift = attempt.min(10) as u32;
    Duration::from_secs(2u64.saturating_pow(shift).min(MAX_DELAY_SECS))
}

/// 是否还该继续尝试。次数到顶就停，避免失控服务器无限拉起进程。
pub fn should_retry(attempt: usize) -> bool {
    attempt < MAX_RECONNECT_ATTEMPTS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delays_are_exponential_and_capped() {
        let secs: Vec<u64> = (0..8).map(|i| reconnect_delay(i).as_secs()).collect();
        assert_eq!(secs, vec![1, 2, 4, 8, 16, 30, 30, 30]);
    }

    #[test]
    fn huge_attempt_does_not_overflow() {
        assert_eq!(reconnect_delay(usize::MAX).as_secs(), MAX_DELAY_SECS);
    }

    #[test]
    fn retries_stop_after_five_attempts() {
        assert!(should_retry(0));
        assert!(should_retry(4));
        assert!(!should_retry(5));
        assert!(!should_retry(50));
    }
}
