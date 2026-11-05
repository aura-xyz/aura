/**
 * 单轮 Token 用量面板（v0.8.0）。
 *
 * 此前用前端 estimateTokens 按字符数折算，数字看着精确其实与计费无关。
 * 现在只显示后端从 SSE usage 帧上报的真实值；上游不提供时明确说明，
 * 不再拿估算值冒充用量。
 */
import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Database } from "lucide-react";
import { useStore, type Session } from "../store";
import dialogCss from "./stat-dialog.module.css";
import css from "./TurnUsagePanel.module.css";

function formatTokens(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export const TurnUsagePanel = memo(function TurnUsagePanel() {
  let activeSession: Session | undefined;
  try {
    activeSession = useStore().activeSession;
  } catch {
    return null;
  }
  const [open, setOpen] = useState(false);
  const usage = activeSession?.lastUsage;

  return (
    <span className={css.root}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-subtle transition-colors hover:bg-bubble hover:text-foreground"
      >
        <Info size={13} />
        <span>
          {usage ? `本轮 ${formatTokens(usage.total)} Token` : "本轮用量 —"}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            className={`${dialogCss.panel} ${css.dialog}`}
            role="dialog"
            aria-label="本轮 Token 用量"
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 50,
            }}
          >
            <div className={dialogCss.title}>
              <span className={dialogCss.titleLabel}>
                <Database size={14} />
                本轮 Token 用量
              </span>
            </div>
            <div className={dialogCss.titleRule} aria-hidden />
            {usage ? (
              <>
                <dl className={dialogCss.details}>
                  <dt>输入</dt>
                  <dd className="text-right tabular-nums">{formatTokens(usage.input)}</dd>
                  <dt>输出</dt>
                  <dd className="text-right tabular-nums">{formatTokens(usage.output)}</dd>
                  <dt>合计</dt>
                  <dd className="text-right tabular-nums font-medium">
                    {formatTokens(usage.total)}
                  </dd>
                  <dt>模型耗时</dt>
                  <dd className="text-right tabular-nums">
                    {(usage.llmMs / 1000).toFixed(1)}s
                  </dd>
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
