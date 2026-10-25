import type { ChatMessage } from "../store";

/**
 * 把「界面上的第几条消息」翻译成「保留到第几条用户消息」。
 *
 * ## 为什么需要这一层翻译
 *
 * 界面上的消息与 agent history 里的 entry **不是一一对应**：
 * 一条 assistant 界面消息（带若干 blocks）在 history 里可能对应
 * 「多条 assistant + 多条 tool_result」。
 *
 * 所以前端算不出 history 下标，只能表达「保留到第几条用户消息为止」
 * 这个语义，由后端翻译成下标（见 `truncate_history` 命令）。
 *
 * ## 两个用途
 *
 * - **重新生成第 k 条回答**（k 是 assistant 消息序号，1-based）：
 *   保留产生它的那个用户问题，删掉回答及其后。
 *   → `keepThroughUser` = 第 k 条回答之前的用户问题条数。
 * - **编辑第 k 条用户消息并重跑**：
 *   删掉该问题本身及其后。
 *   → `keepThroughUser` = k - 1。
 */

/**
 * 数出「第 index 条 assistant 消息之前」有多少条用户消息。
 *
 * @param messages 界面上按顺序排列的消息
 * @param assistantIndex assistant 消息的 1-based 序号
 * @returns 该回答之前用户消息的条数；找不到则返回 0
 */
export function userMessagesBeforeAssistant(
  messages: ChatMessage[],
  assistantIndex: number,
): number {
  let assistantSeen = 0;
  let userCount = 0;
  for (const m of messages) {
    if (m.role === "assistant") {
      assistantSeen += 1;
      if (assistantSeen === assistantIndex) return userCount;
    } else {
      userCount += 1;
    }
  }
  return 0;
}

/**
 * 计算「重新生成第 assistantIndex 条回答」该传给后端的 keepThroughUser。
 *
 * @returns 保留到第几条用户消息；找不到对应回答时返回 null（不发起截断）
 */
export function keepThroughForRegenerate(
  messages: ChatMessage[],
  assistantIndex: number,
): number | null {
  if (assistantIndex < 1) return null;
  // 该回答之前的用户问题条数 = 保留到第几条用户消息
  const n = userMessagesBeforeAssistant(messages, assistantIndex);
  if (n === 0) return null; // 第一条 assistant 之前没有用户问题，异常数据
  return n;
}

/**
 * 计算「编辑第 userIndex 条用户消息并重跑」该传的 keepThroughUser。
 *
 * 删掉该问题本身及其后 → 保留到它之前的问题。
 *
 * @param userIndex 用户消息的 1-based 序号
 * @returns 保留到第几条用户消息；非法序号返回 null
 */
export function keepThroughForEdit(
  messages: ChatMessage[],
  userIndex: number,
): number | null {
  if (userIndex < 1) return null;
  let userSeen = 0;
  for (const m of messages) {
    if (m.role === "user") {
      userSeen += 1;
      if (userSeen === userIndex) {
        // 该问题本身要删掉 → 保留到前一条用户问题
        return userIndex - 1;
      }
    }
  }
  return null;
}

/**
 * 找出某条 assistant 消息之前（含）的用户消息条数，用于前端删除对应 UI 消息。
 *
 * 「重新生成第 k 条回答」时，界面上要删掉的是：从第 k 条 assistant 开始
 * 到末尾的全部消息。
 */
export function sliceForRegenerate(
  messages: ChatMessage[],
  assistantIndex: number,
): ChatMessage[] {
  let assistantSeen = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "assistant") {
      assistantSeen += 1;
      if (assistantSeen === assistantIndex) return messages.slice(0, i);
    }
  }
  return messages;
}

/**
 * 找出「编辑第 userIndex 条用户消息」时界面上要保留的部分。
 *
 * 该用户消息本身要被新内容替换，所以保留到它之前。
 */
export function sliceForEdit(
  messages: ChatMessage[],
  userIndex: number,
): ChatMessage[] {
  let userSeen = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      userSeen += 1;
      if (userSeen === userIndex) return messages.slice(0, i);
    }
  }
  return messages;
}
