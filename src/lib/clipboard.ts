/**
 * 复制文本到剪贴板。
 *
 * 抽成模块级而不是散在组件里：消息复制、代码块复制、右键「复制」
 * 三处都要用，且都需要同一套失败语义。
 */

/** 复制成功返回 true；浏览器拒绝或无剪贴板权限返回 false */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文（http、或 file:// 下某些 WebView）没有 clipboard API，
    // 回退到 execCommand。后者已废弃但在 Tauri 的 WebView2 里仍可用。
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}
