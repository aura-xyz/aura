/**
 * 单轮 Token 用量面板（v0.8.0，参照 dsh TurnUsagePanel）。
 *
 * 显示当前会话最后一条助手消息的估算 token 明细，点击按钮打开对话框查看详情。
 * 后端暂不下发精确 token 数，这里用前端 estimateTokens 做估算，并明确标注。
 */
import { memo, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { Info, Database } from "lucide-react";
import { useStore, type Session } from "../store";
import { estimateTokens } from "../lib/tokens";
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

  const usage = useMemo(() => {
    if (!activeSession) return null;
    const assistantMsgs = activeSession.messages.filter(
      (m: typeof activeSession.messages[number]) => m.role === "assistant",
    );
    if (assistantMsgs.length === 0) return null;
    const last = assistantMsgs[assistantMsgs.length - 1];
    const text = last.blocks
      .filter((b) => b.kind === "text")
      .map((b) => (b.kind === "text" ? b.text : ""))
      .join("");
    const input = estimateTokens(
      activeSession.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n"),
    );
    const output = estimateTokens(text);
    return { input, output, total: input + output };
  }, [activeSession]);

  if (!usage) return null;

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
        <span>本轮约 {formatTokens(usage.total)} Token</span>
      </button>
      {open && createPortal(
        <div
          className={`${dialogCss.panel} ${css.dialog}`}
          role="dialog"
          aria-label="本轮 Token 用量"
          style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 50 }}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <Database size={14} />
              本轮 Token 用量（估算）
            </span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details}>
            <dt>输入</dt>
            <dd className="text-right tabular-nums">{formatTokens(usage.input)}</dd>
            <dt>输出</dt>
            <dd className="text-right tabular-nums">{formatTokens(usage.output)}</dd>
            <dt>合计</dt>
            <dd className="text-right tabular-nums font-medium">{formatTokens(usage.total)}</dd>
          </dl>
          <p className="mt-3 text-xs text-subtle">
            后端暂不下发精确 token 数，此处按 CJK 每字 1 token、其余每 4 字符 1 token 估算。
          </p>
        </div>,
        document.body,
      )}
    </span>
  );
});
