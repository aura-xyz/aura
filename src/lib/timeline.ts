/**
 * 时间线的纯逻辑（v0.8.0）。
 *
 * 目前只有「轮次摘要」一条：分组头光写「第 3 轮」，扫读时还得逐条展开
 * 才知道那一轮在干嘛。取该轮首条用户消息的前 20 字当摘要，一眼能认。
 */
import type { TimelineEntry } from "./api";

/** 摘要长度上限。再长会把分组头挤成两行。 */
export const TURN_SUMMARY_MAX = 20;

/**
 * 轮次摘要：该轮第一条用户消息的前 N 字。
 *
 * 没有用户消息（例如「对话开始」那一组只有上下文事件）时返回空串，
 * 由调用方决定是否显示——空摘要不该留一个孤零零的占位。
 */
export function turnSummary(
  items: Pick<TimelineEntry, "kind" | "title">[],
  max = TURN_SUMMARY_MAX,
): string {
  const user = items.find((i) => i.kind === "user");
  const text = user?.title.trim() ?? "";
  if (!text) return "";
  // 按码点截断，避免把 emoji 切成半个代理对
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}
