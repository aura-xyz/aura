/**
 * 全局错误兜底（v0.8.1 P11）。
 *
 * 渲染崩溃由 ErrorBoundary 接住；这里是它的补集——事件回调里的异常、
 * 没人 await 的 Promise 拒绝。两者都收敛成右下角 toast，避免「点了没反应、
 * 控制台才有字」。相同文案 1.5 秒内去重，防止一个反复触发的定时器刷屏。
 */
import { errorText } from "./apiError";
import { notify } from "./notices";

/** 注册 window.onerror / unhandledrejection，返回卸载器。 */
export function installGlobalErrorHandlers(): () => void {
  // 去重状态跟着本次安装走：多次安装（含单测）互不干扰。
  let lastText = "";
  let lastAt = 0;

  function report(e: unknown): void {
    const text = errorText(e);
    const now = Date.now();
    if (text === lastText && now - lastAt < 1500) return;
    lastText = text;
    lastAt = now;
    notify("error", text);
    // 诊断细节留在控制台供开发模式排查；不落盘，避免把可能的敏感内容
    // 写成用户不知道的明文文件。
    console.error("[aura] 未捕获错误：", e);
  }

  const onError = (e: ErrorEvent) => report(e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => report(e.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
