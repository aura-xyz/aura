/**
 * 正式版开发者工具快捷键拦截（v0.8.0）。
 *
 * 判定抽成纯函数，才能在不碰 import.meta.env 的情况下单测：
 * 「正式版拦截 / 开发模式放行」这条分支如果写死在组件里，很容易被
 * 一次重构改成全版本拦截，把 `pnpm tauri dev` 的调试能力一起关掉。
 */

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** F12，以及 Windows/Linux 的 Ctrl+Shift+I/J/C、macOS 的 Cmd+Opt+I/J/C。 */
export function isDevtoolsShortcut(e: KeyLike): boolean {
  const key = e.key.toLowerCase();
  if (key === "f12") return true;
  const modifier = e.ctrlKey || e.metaKey;
  if (!modifier || !e.shiftKey) return false;
  return key === "i" || key === "j" || key === "c";
}

/**
 * 是否应该吞掉这次按键。`prod` 由调用方传 `import.meta.env.PROD`，
 * 开发模式传 false 时一律放行。
 */
export function shouldBlockDevtools(prod: boolean, e: KeyLike): boolean {
  return prod && isDevtoolsShortcut(e);
}
