/** 输入框 Markdown 实时渲染开关：默认开启，设置页可关。 */
const STORAGE_KEY = "aura-markdown-live";

/**
 * 设置页改开关后，输入框要立刻切换 textarea / Lexical 两条路径。
 * 用一份订阅表通知所有消费者，不必把开关塞进 store 或刷新页面。
 */
const listeners = new Set<() => void>();

export function loadMarkdownLive(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveMarkdownLive(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* localStorage 不可用时只影响本次会话 */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeMarkdownLive(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
