/**
 * 会话统计（v0.8.0）。
 *
 * LLM 耗时由后端 usage 事件按会话累计后传入；工具耗时从 action 块的
 * `durationMs` 累加。两者分开统计，避免把「恒为 0 的 llmMs」和工具耗时
 * 混成一个数字。
 *
 * **为什么不把累计值塞进 store**：会话消息会在加载、截断、切版本、重跑、
 * 切会话五条路径上变动，增量值要逐条维护，漏一条就长期漂移且没人发现。
 * 这里改成「按消息对象记忆」——消息是不可变的（更新时换新对象），所以
 * 每帧只需重算正在写的那一条，其余直接命中缓存，收益与 store 增量等价。
 */
import type { ChatMessage } from "../store";

export interface WindowStats {
  turns: number;
  steps: number;
  llmMs: number;
  toolMs: number;
}

interface MessageStats {
  steps: number;
  toolMs: number;
}

const memo = new WeakMap<ChatMessage, MessageStats>();

/** 单条消息的贡献。用户消息不计 step（它不是一次助手回复）。 */
function messageStats(message: ChatMessage): MessageStats {
  const cached = memo.get(message);
  if (cached) return cached;
  let steps = 0;
  let toolMs = 0;
  if (message.role === "assistant") {
    steps = 1;
    for (const block of message.blocks) {
      if (block.kind === "action" && block.durationMs !== undefined) {
        toolMs += block.durationMs;
      }
    }
  }
  const stats = { steps, toolMs };
  memo.set(message, stats);
  return stats;
}

export function deriveStats(
  messages: ChatMessage[],
  llmMs = 0,
): WindowStats {
  let turns = 0;
  let steps = 0;
  let toolMs = 0;
  for (const message of messages) {
    if (message.role === "user") {
      turns += 1;
      continue;
    }
    const part = messageStats(message);
    steps += part.steps;
    toolMs += part.toolMs;
  }
  return { turns, steps, llmMs, toolMs };
}

export function formatDuration(ms: number): string {
  const s = ms / 1_000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}
