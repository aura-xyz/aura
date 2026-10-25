/**
 * Token 估算（前端副本）。
 *
 * **必须与后端 `agent/context.rs::estimate_tokens` 口径一致**：
 * CJK 字符（U+2E80–U+9FFF 及 U+F900 以上）每字 1 token，
 * 其余每 4 字符 1 token，最后 +1。
 *
 * 为什么前端要抄一份而不是问后端：这是纯函数，输入框每敲一个字都要算一次，
 * 走一次 IPC 不划算。抄的代价是两边必须同步——改后端口径时记得改这里，
 * 两侧各有一条测试钉住同一组输入，改一边另一边会红。
 */

const CJK_MIN = 0x2e80;
const CJK_MAX = 0x9fff;
const CJK_EXT_MIN = 0xf900;

function isCjk(code: number): boolean {
  return (
    (code >= CJK_MIN && code <= CJK_MAX) || code >= CJK_EXT_MIN
  );
}

/** 与后端同口径的 token 估算 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    if (isCjk(ch.codePointAt(0) ?? 0)) cjk += 1;
  }
  const total = [...text].length;
  const other = total - cjk;
  return cjk + Math.floor(other / 4) + 1;
}
