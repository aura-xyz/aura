/**
 * 会话列表时间戳开关（v0.8.0）。
 *
 * 侧栏每条会话的第二行相对时间（今天 14:20 / 昨天 / 3 天前）对
 * 「小屏幕 + 多对话」用户是噪声：行高被撑高、标题空间被挤。默认开启，
 * 设置页可关；关闭后只在侧栏隐藏，数据与排序不受影响。
 *
 * 与 markdownLive 同构：模块级订阅表 + localStorage，不必塞进 store。
 */
const STORAGE_KEY = "aura-show-session-time";

const listeners = new Set<() => void>();

export function loadShowSessionTime(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveShowSessionTime(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* localStorage 不可用时只影响本次会话 */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeShowSessionTime(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
