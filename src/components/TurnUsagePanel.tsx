/**
 * 单轮 Token 用量面板（v0.8.0）。
 *
 * 此前用前端 estimateTokens 按字符数折算，数字看着精确其实与计费无关。
 * 现在只显示后端从 SSE usage 帧上报的真实值；上游不提供时明确说明，
 * 不再拿估算值冒充用量。
 *
 * 视觉对齐 dsh TurnUsagePanel：触发按钮是无边框的信息 pill，点击打开的
 * 详情是**锚定在按钮上方**的 portal 浮层（不是屏幕居中的模态框），
 * 标题行右侧给总值，明细是两列网格、值右对齐等宽数字。
 */
import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Database } from "lucide-react";
import { useStore, type Session } from "../store";
import { useAnchoredPanel } from "../hooks/useAnchoredPanel";
import dialogCss from "./stat-dialog.module.css";
import css from "./TurnUsagePanel.module.css";

function formatTokens(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** 触发按钮上用紧凑写法，详情里仍给精确值（dsh 的 formatTokens 口径）。 */
function formatCompact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export const TurnUsagePanel = memo(function TurnUsagePanel() {
  let activeSession: Session | undefined;
  try {
    activeSession = useStore().activeSession;
  } catch {
    return null;
  }
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPanel(rootRef, panelRef, open, "top");
  const usage = activeSession?.lastUsage;

  // portal 面板不在 root 子树里，外部点击要同时排除它；Escape 关闭。
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Database size={14} aria-hidden />
        <span className={css.label}>
          {usage ? `本轮 ${formatCompact(usage.total)} Token` : "本轮用量 —"}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={dialogCss.panel}
            role="dialog"
            aria-label="本轮 Token 用量"
            style={pos}
          >
            <div className={dialogCss.title}>
              <span className={dialogCss.titleLabel}>
                <Database size={14} aria-hidden />
                本轮 Token 用量
              </span>
              <span className={dialogCss.titleValue}>
                {usage ? `${formatTokens(usage.total)} Token` : "—"}
              </span>
            </div>
            <div className={dialogCss.titleRule} aria-hidden />
            {usage ? (
              <>
                <dl className={dialogCss.details}>
                  <dt>输入</dt>
                  <dd>{formatTokens(usage.input)}</dd>
                  <dt>输出</dt>
                  <dd>{formatTokens(usage.output)}</dd>
                  <dt>合计</dt>
                  <dd>{formatTokens(usage.total)}</dd>
                  <dt>模型耗时</dt>
                  <dd>{(usage.llmMs / 1000).toFixed(1)}s</dd>
                </dl>
                <p className="mt-3 text-xs text-subtle">
                  数值来自模型服务的 usage 上报，包含本轮所有工具往返。
                </p>
              </>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-subtle">
                上游尚未返回本轮用量（部分本地模型不提供），此处不再按字符数推测。
              </p>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
});
