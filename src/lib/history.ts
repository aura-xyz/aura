import type { ChatMessage, Session } from "../store";

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
 * 会话时间分组的四节（本地时区日界）。
 *
 * 与文档 1 · F2 / C52 一致：工作区内会话按
 * 「今天 / 昨天 / 7 天内 / 更早」分组。节头用 11px eyebrow 样式由调用方渲染，
 * 这里只产出有序的分组结构与标签，保持纯函数、可单测。
 */
export type TimeBucketKey = "today" | "yesterday" | "week" | "earlier";

export interface TimeBucket {
  key: TimeBucketKey;
  label: string;
  sessions: Session[];
}

/** 一节毫秒数，用于本地日界与「7 天内」的折算。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 取本地时区的「当天 0 点」毫秒戳。
 *
 * 必须用本地日界而非 UTC 日界：否则北京时区用户在 UTC 8 点前点的会话
 * 会被算进「昨天」，节头错位。跨日边界的单测就靠这个函数钉住。
 */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 把会话按更新时间分到四节（今天 / 昨天 / 7 天内 / 更早）。
 *
 * 纯函数：`now` 默认取 `Date.now()`，测试可显式传入以钉住跨日边界。
 * `updated_at` 来自后端，单位为**秒**，调用方负责 ×1000 转毫秒。
 * 返回顺序固定为 今天 → 昨天 → 7 天内 → 更早；空节也保留（调用方按需跳过）。
 */
export function groupSessionsByTime(
  sessions: Session[],
  now: number = Date.now(),
): TimeBucket[] {
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  const sevenDaysStart = todayStart - 7 * DAY_MS;

  const buckets: TimeBucket[] = [
    { key: "today", label: "今天", sessions: [] },
    { key: "yesterday", label: "昨天", sessions: [] },
    { key: "week", label: "7 天内", sessions: [] },
    { key: "earlier", label: "更早", sessions: [] },
  ];

  for (const s of sessions) {
    const t = (s.updated_at ?? 0) * 1000;
    if (t >= todayStart) buckets[0].sessions.push(s);
    else if (t >= yesterdayStart) buckets[1].sessions.push(s);
    // 「7 天内」是**小于** 7 天；正好 7 天前 0 点归「更早」（边界排他）。
    else if (t > sevenDaysStart) buckets[2].sessions.push(s);
    else buckets[3].sessions.push(s);
  }
  return buckets;
}

/**
 * 会话行的相对时间（第二行，11px）。
 *
 * 与 ChatGPT / Claude 侧栏一致：今天显示时刻、昨天显示「昨天」、
 * 一周内显示「N 天前」、更久显示日期。`ts` 为毫秒；`updated_at` 为 0
 * （未落库的新会话）返回空串，由调用方决定是否展示。
 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  if (!ts || ts <= 0) return "";
  const diff = now - ts;
  if (diff < 0) return "";

  const todayStart = startOfLocalDay(now);
  if (ts >= todayStart) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (ts >= todayStart - DAY_MS) return "昨天";
  if (ts >= todayStart - 7 * DAY_MS) {
    return `${Math.floor((todayStart - startOfLocalDay(ts)) / DAY_MS)} 天前`;
  }
  const d = new Date(ts);
  if (d.getFullYear() === new Date(now).getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

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
