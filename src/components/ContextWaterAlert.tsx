/**
 * 上下文水位预警条（v0.8.1 P13）。
 *
 * 70% 只有水位条自身的颜色与 tooltip（不额外占高度）；90% 给一条带
 * 「压缩历史 / 新开会话」的提示条；100% 变硬拦截说明——发送已在 store
 * 层被挡下，这里必须给出脱困动作，不能让用户只看到「点了没反应」。
 */
import { useEffect, useState } from "react";
import { MessageSquarePlus, RotateCcw, TriangleAlert } from "lucide-react";
import { useStore } from "../store";
import { compactSession } from "../lib/api";
import { errorText } from "../lib/apiError";
import {
  WATER_FULL,
  waterAdvice,
  waterLevel,
  waterOverflow,
} from "../lib/contextWater";
import { notify } from "../lib/notices";
import { CONTENT_WIDTH } from "../lib/layout";

export default function ContextWaterAlert({
  contextLimit,
}: {
  /** 当前模型窗口上限；未知传 undefined */
  contextLimit?: number;
}) {
  const { activeSession, newSession } = useStore();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const used = activeSession?.lastUsage?.input ?? null;
  const level = waterLevel(used, contextLimit);
  const overflow = waterOverflow(used, contextLimit);
  const advice = waterAdvice(level, overflow);

  // 下一轮用量到来后重新评估：压缩成功只是暂时收起，不该永久屏蔽预警
  useEffect(() => {
    setDone(false);
  }, [used]);

  if (done || advice.stage === "none" || advice.stage === "warn") return null;

  async function onCompact() {
    if (!activeSession || !contextLimit || busy) return;
    setBusy(true);
    try {
      const r = await compactSession(activeSession.id, contextLimit);
      if (r.changed) {
        notify(
          "ok",
          `已折叠 ${r.dropped_messages} 条早期上下文（${r.before_tokens} → ${r.after_tokens} tokens）`,
        );
        setDone(true);
      } else {
        notify("error", "当前历史已很短，没有可压缩的内容，建议新开会话");
      }
    } catch (e) {
      notify("error", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const full = advice.stage === "full";
  return (
    <div className={`mx-auto ${CONTENT_WIDTH} px-6 pb-2`}>
      <div
        role={full ? "alert" : "status"}
        className={`rounded-card border px-4 py-3 ${
          full
            ? "border-danger/50 bg-danger/10"
            : "border-line bg-surface-sunken/60"
        }`}
      >
        <div className="flex items-start gap-2.5">
          <TriangleAlert
            size={15}
            className={`mt-0.5 shrink-0 ${full ? "text-danger" : "text-subtle"}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {full ? `上下文已占满（${Math.round((level?.ratio ?? WATER_FULL) * 100)}%）` : "上下文接近上限"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-subtle">
              {advice.text}
            </p>
            {advice.showActions && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onCompact()}
                  disabled={busy || !contextLimit}
                  className="flex items-center gap-1 rounded-tag border border-line px-2 py-1 text-[11px] text-foreground transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                >
                  <RotateCcw size={11} className={busy ? "animate-spin" : ""} />
                  压缩历史
                </button>
                <button
                  type="button"
                  onClick={() => void newSession()}
                  className="flex items-center gap-1 rounded-tag border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
                >
                  <MessageSquarePlus size={11} />
                  新开会话
                </button>
                <span className="text-[10px] text-subtle">
                  压缩只折叠模型可见的早期上下文，对话记录不会删除
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
