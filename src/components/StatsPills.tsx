/**
 * 会话统计 pills（v0.8.0）。
 *
 * 统计口径全在 `lib/stats.ts`：这里只负责订阅当前会话并渲染，
 * 计算按消息对象记忆，流式期间只重算正在写的那一条。
 */
import { memo, useMemo } from "react";
import { Activity, Clock } from "lucide-react";
import { useStore, type Session } from "../store";
import { deriveStats, formatDuration } from "../lib/stats";

export const StatsPills = memo(function StatsPills() {
  let activeSession: Session | undefined;
  try {
    activeSession = useStore().activeSession;
  } catch {
    return null;
  }
  if (!activeSession) return null;

  const stats = useMemo(
    () => deriveStats(activeSession!.messages, activeSession!.llmMs ?? 0),
    [activeSession!.messages, activeSession!.llmMs],
  );

  return (
    <span className="flex items-center gap-2">
      {/* 与旁边的本轮用量 pill 同为无边框透明信息按钮；此前一个带边框
          卡片、一个透明，两个挨在一起像两种不同层级的控件。 */}
      <span
        className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs text-subtle transition-colors hover:bg-bubble"
        title={`共 ${stats.turns} 轮对话，${stats.steps} 条助手回复；模型 ${formatDuration(stats.llmMs)}，工具 ${formatDuration(stats.toolMs)}`}
      >
        <span className="flex items-center gap-1">
          <Activity size={12} className="text-brand" />
          <span>{stats.turns} 轮</span>
        </span>
        <span className="h-3 w-px bg-line" />
        <span className="flex items-center gap-1">
          <Clock size={12} className="text-success" />
          <span>
            LLM {formatDuration(stats.llmMs)} · 工具 {formatDuration(stats.toolMs)}
          </span>
        </span>
      </span>
    </span>
  );
});
