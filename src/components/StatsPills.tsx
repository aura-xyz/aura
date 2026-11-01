/**
 * 会话统计 pills（v0.8.0，参照 dsh StatsPills）。
 *
 * 停靠在输入区，显示会话总览：turn 数、步数、LLM 耗时、工具耗时。
 * 无耐久投影时，从可见消息节点折算。
 */
import { memo, useMemo } from "react";
import { Activity, Clock } from "lucide-react";
import { useStore, type ChatMessage, type Session } from "../store";

interface WindowStats {
  turns: number;
  steps: number;
  llmMs: number;
  toolMs: number;
}

export function deriveStats(messages: ChatMessage[]): WindowStats {
  const turns = messages.filter((m) => m.role === "user").length;
  let steps = 0;
  let llmMs = 0;
  let toolMs = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    steps += 1;
    for (const b of m.blocks) {
      if (b.kind === "action" && b.durationMs !== undefined) {
        toolMs += b.durationMs;
      }
    }
  }
  return { turns, steps, llmMs, toolMs };
}

export function formatDuration(ms: number): string {
  const s = ms / 1_000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

export const StatsPills = memo(function StatsPills() {
  let activeSession: Session | undefined;
  try {
    activeSession = useStore().activeSession;
  } catch {
    return null;
  }
  if (!activeSession) return null;

  const stats = useMemo(() => deriveStats(activeSession.messages), [activeSession.messages]);

  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-flex items-center gap-2 px-2 py-1 rounded-md border border-line bg-surface text-[11px] text-subtle"
        title={`共 ${stats.turns} 轮对话，${stats.steps} 条助手回复`}
      >
        <span className="flex items-center gap-1">
          <Activity size={12} className="text-brand" />
          <span>{stats.turns} 轮</span>
        </span>
        <span className="w-px h-3 bg-line" />
        <span className="flex items-center gap-1">
          <Clock size={12} className="text-success" />
          <span>{formatDuration(stats.llmMs + stats.toolMs)}</span>
        </span>
      </span>
    </span>
  );
});
