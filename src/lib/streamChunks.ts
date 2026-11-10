/**
 * 流式消费节奏（v0.8.1 P01）。
 *
 * 旧实现是固定 30ms 的 `setInterval`，与一帧实际渲染耗时脱钩：当 Markdown
 * 解析超过 30ms 时，定时器回调仍按点触发，backlog 越堆越多，表现为「越写越卡」。
 *
 * 现在由 `requestAnimationFrame` 驱动（一帧最多消费一次），并用上一帧的间隔
 * 作为主线程压力的代理：间隔越长，单帧多消费一些，尽快把积压追平。
 */

/** 慢速区（backlog ≤ 60）的逐字节奏，保留打字机观感。 */
const SLOW_LIMIT = 60;
const MEDIUM_LIMIT = 300;

/**
 * 计算这一帧应该消费多少个字符。
 *
 * @param backlog  尚未渲染的字符数（code point 计）
 * @param frameMs  距上一帧的毫秒数（首帧传 16）
 */
export function planChunk(backlog: number, frameMs: number): number {
  if (backlog <= 0) return 0;

  let base: number;
  if (backlog <= SLOW_LIMIT) {
    base = backlog > 40 ? 2 : 1;
  } else if (backlog <= MEDIUM_LIMIT) {
    base = Math.ceil(backlog / 30);
  } else {
    base = Math.ceil(backlog / 15) + 4;
  }

  // 主线程压力：60fps 约 16.7ms，超过 24ms 说明这一帧已经掉到 40fps 以下。
  const pressure = frameMs > 40 ? 3 : frameMs > 24 ? 2 : 1;
  return Math.min(backlog, Math.max(1, base * pressure));
}
