/**
 * 流式失败提示条（v0.8.1 P12）。
 *
 * 和网络中断 / 鉴权失败不同，这里不覆盖消息区：已生成的内容原样留在上面，
 * 只在其下方给一条可操作的提示。重试沿用 resendFrom（带副作用预检），
 * 「忽略」只收起提示，绝不删内容。
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useStore } from "../store";
import { CONTENT_WIDTH } from "../lib/layout";

export default function StreamFailureBar() {
  const { failure, activeId, retryLast, dismissFailure } = useStore();
  const [showDetail, setShowDetail] = useState(false);

  // 失败只属于产生它的会话：切到别的对话再切回来之前，不该一直挂在界面上
  if (!failure || failure.sessionId !== activeId) return null;

  const label = failure.kind === "interrupted" ? "生成中断" : "生成失败";

  return (
    <div className={`mx-auto ${CONTENT_WIDTH} px-6 pb-2`}>
      <div
        role="alert"
        className="rounded-card border border-danger/40 bg-surface-sunken/60 px-4 py-3"
      >
        <div className="flex items-start gap-2.5">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {label} · 已保留当前内容
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-subtle">
              {failure.message}
            </p>
            {showDetail && failure.detail && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-tag bg-bubble p-2 text-[11px] text-subtle">
                {failure.detail}
              </pre>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {failure.retryable && (
              <button
                type="button"
                onClick={() => void retryLast()}
                className="flex items-center gap-1 rounded-tag border border-line px-2 py-1 text-[11px] text-foreground transition-colors hover:border-brand hover:text-brand"
              >
                <RotateCcw size={11} />
                重试
              </button>
            )}
            {failure.detail && (
              <button
                type="button"
                onClick={() => setShowDetail((v) => !v)}
                aria-expanded={showDetail}
                aria-label={showDetail ? "收起错误详情" : "展开错误详情"}
                className="rounded-tag p-1 text-subtle hover:text-foreground"
              >
                {showDetail ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            )}
            <button
              type="button"
              onClick={dismissFailure}
              aria-label="忽略失败提示"
              title="忽略（内容保留）"
              className="rounded-tag p-1 text-subtle hover:text-foreground"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
