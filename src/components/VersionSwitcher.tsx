import { ChevronLeft, ChevronRight } from "lucide-react";
import { versionCount, viewingVersion } from "../lib/versions";
import type { ChatMessage } from "../store";

/**
 * 版本切换器（v0.7.0）。
 *
 * 只在有多个版本时出现。平时完全隐形，保住极简的第一观感。
 *
 * **必须标注「显示的是历史版本」**：切换只改显示，后端上下文始终基于
 * 最新版本。不说的话，用户会以为后续对话是基于他正在看的这版进行的。
 */
export default function VersionSwitcher({
  message,
  onSwitch,
}: {
  message: ChatMessage;
  onSwitch: (index: number) => void;
}) {
  if (message.role !== "assistant") return null;
  const total = versionCount(message);
  if (total <= 1) return null;

  const current = viewingVersion(message);
  const isHistory = current < total;

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-subtle">
      <button
        type="button"
        onClick={() => onSwitch(current - 1)}
        disabled={current <= 1}
        aria-label="上一个版本"
        className="rounded-md border border-line px-1 py-0.5 transition-colors hover:border-brand hover:text-brand disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft size={12} />
      </button>
      <span className="font-mono">
        {current} / {total}
      </span>
      <button
        type="button"
        onClick={() => onSwitch(current + 1)}
        disabled={current >= total}
        aria-label="下一个版本"
        className="rounded-md border border-line px-1 py-0.5 transition-colors hover:border-brand hover:text-brand disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight size={12} />
      </button>
      {isHistory && (
        <span className="text-warning">
          显示历史版本，后续对话基于最新版本
        </span>
      )}
    </div>
  );
}
