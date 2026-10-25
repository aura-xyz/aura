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
 * ## 一个关键简化
 *
 * 「重新生成第 k 条回答」与「编辑第 k 条用户消息并重跑」**后端截断点完全相同**：
 * 都是「保留到第 k-1 条用户消息」，即删掉第 k 条用户消息及其后的一切。
 * 之后两者都通过重新发送一次消息，把第 k 条用户消息补回去。
 *
 * 区别只在**重新发送的内容**：重新生成用原问题，编辑用新内容。
 */

/**
 * 找出第 assistantIndex 条 assistant 回答是由第几条用户消息触发的。
 *
 * @param assistantIndex assistant 消息的 1-based 序号
 * @returns 对应的用户消息序号（1-based）；找不到返回 null
 */
export function userIndexForAssistant(
  messages: ChatMessage[],
  assistantIndex: number,
): number | null {
  if (assistantIndex < 1) return null;
  let assistantSeen = 0;
  let userCount = 0;
  for (const m of messages) {
    if (m.role === "assistant") {
      assistantSeen += 1;
      if (assistantSeen === assistantIndex) {
        // 该回答之前至少要有一个用户问题，否则是异常数据
        return userCount > 0 ? userCount : null;
      }
    } else {
      userCount += 1;
    }
  }
  return null;
}

/**
 * 取第 userIndex 条用户消息的原文（重新生成时作为重发的内容）。
 *
 * @returns 原文；序号非法返回 null
 */
export function originalQuestion(
  messages: ChatMessage[],
  userIndex: number,
): string | null {
  if (userIndex < 1) return null;
  let userSeen = 0;
  for (const m of messages) {
    if (m.role === "user") {
      userSeen += 1;
      if (userSeen === userIndex) return m.content;
    }
  }
  return null;
}

/**
 * 重新发送时，界面上要保留的部分：**删掉第 userIndex 条用户消息及其后**。
 *
 * 那条用户消息会被新发出的消息取代，所以连它一起删掉，避免出现两条
 * 相同的问题。
 */
export function sliceForResend(
  messages: ChatMessage[],
  userIndex: number,
): ChatMessage[] {
  if (userIndex < 1) return messages;
  let userSeen = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      userSeen += 1;
      if (userSeen === userIndex) return messages.slice(0, i);
    }
  }
  return messages;
}

/**
 * 截断点：保留到第几条用户消息。
 *
 * 删掉第 userIndex 条用户消息本身 → 保留到它之前的第 userIndex-1 条。
 * `userIndex = 1` 时保留 0 条，即清空历史。
 */
export function keepThroughForResend(userIndex: number): number {
  return Math.max(0, userIndex - 1);
}
