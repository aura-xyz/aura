/**
 * 根级渲染错误边界（v0.8.1 P11）。
 *
 * 没有它时，任意一次渲染抛错会让整个 WebView 白屏；窗口又是无边框的，
 * 用户连「重新加载」的按钮都找不到。这里给一块可恢复面板，并把错误
 * 推到统一 toast，让用户至少知道发生了什么。
 */
import { Component, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { errorText } from "../lib/apiError";
import { notify } from "../lib/notices";

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    notify("error", `界面异常：${errorText(error)}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-8 text-center"
      >
        <h1 className="text-xl font-semibold text-foreground">界面出了点问题</h1>
        <p className="max-w-md text-sm leading-relaxed text-subtle">
          对话内容已经保存在本机。可以试着重新渲染界面；如果反复出现，请重启 Aura。
        </p>
        <p className="max-w-md text-xs text-subtle">
          {errorText(this.state.error)}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="flex items-center gap-1.5 rounded-tag border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:border-brand hover:text-brand"
        >
          <RotateCcw size={14} />
          重新渲染界面
        </button>
      </div>
    );
  }
}
