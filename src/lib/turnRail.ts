/**
 * 右侧虚拟滚动时间线的数据层（v0.8.0，参照 dsh ui-chat/TurnNavigator）。
 *
 * 一个「轮次」= 一条用户消息 + 它触发的首条助手回复。刻度轨与预览面板
 * 都是定高的，所以虚拟范围可以纯函数算出来 —— 单测不必开 jsdom，
 * 也能钉住「只渲染可见项」这条性能契约。
 */
import { plainTextOf } from "./messageText";
import type { ChatMessage } from "../store";

export interface TurnItem {
  /** 1-based 用户轮次 */
  turn: number;
  /** 用户消息原文 */
  prompt: string;
  /** 该轮首条助手回复的纯文本，供预览气泡第二行 */
  response: string;
}

/** 预览用的单行文本：折叠换行、压掉多余空白、按长度截断。 */
export function previewText(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * 从消息流构造轮次表。
 *
 * 助手消息挂到「最近一条用户消息」上，且只取第一条回复 —— 重新生成、
 * 编辑重跑会产生多条 assistant，预览里只需要这个轮次最后在讨论什么，
 * 取首条即可，避免把工具输出也塞进摘要。
 */
export function buildTurnItems(messages: ChatMessage[]): TurnItem[] {
  const items: TurnItem[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      items.push({
        turn: items.length + 1,
        prompt: (m.content ?? "").trim(),
        response: "",
      });
    } else if (items.length > 0) {
      const last = items[items.length - 1];
      if (!last.response) {
        last.response = plainTextOf(m.blocks);
      }
    }
  }
  return items;
}

export interface VirtualRange {
  /** 含 */
  start: number;
  /** 不含 */
  end: number;
}

/**
 * 定高虚拟列表的可见区间。overscan 在两端各多留几行，避免快速滚动时
 * 出现空白。viewport <= 0（尚未测量到高度）时只给一小段，不让首帧
 * 把全部条目都渲染出来。
 */
export function visibleRange(
  count: number,
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  overscan = 3,
): VirtualRange {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  if (viewport <= 0) return { start: 0, end: Math.min(count, overscan) };
  // 先钳 scrollTop：程序化跳转或窗口缩小后，浏览器给的 scrollTop 可能
  // 已超过当前内容高度，不钳会让 start 跑到 count 之外，渲染出空列表。
  const maxTop = Math.max(0, count * rowHeight - viewport);
  const top = Math.max(0, Math.min(scrollTop, maxTop));
  const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((top + viewport) / rowHeight) + overscan);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/** 定高列表总高度 = 条目数 × 行高 + 上下 inset。 */
export function totalSize(count: number, rowHeight: number, inset = 0): number {
  return Math.max(0, count * rowHeight + inset * 2);
}

/** 把某个条目滚到视口中央所需的 scrollTop，并钳到合法范围。 */
export function centerOffset(
  index: number,
  rowHeight: number,
  inset: number,
  viewport: number,
  total: number,
): number {
  const center = inset + index * rowHeight + rowHeight / 2;
  const max = Math.max(0, total - viewport);
  const target = center - viewport / 2;
  return Math.max(0, Math.min(max, target));
}

/**
 * 从各轮次锚点的 offsetTop 反推当前激活轮次（1-based）。
 *
 * 取「视口上三分之一线之前最后一个」而不是「视口内第一个」：读者通常
 * 看着刚滚过的那条消息，用 1/3 线比顶边更贴近实际阅读位置。
 * positions 为空时返回 0（无激活）。
 */
export function activeTurnAt(
  positions: number[],
  scrollTop: number,
  viewport: number,
): number {
  if (positions.length === 0) return 0;
  const line = Math.max(0, scrollTop) + Math.max(0, viewport) / 3;
  let active = 0;
  for (let i = 0; i < positions.length; i += 1) {
    if (positions[i] <= line) active = i + 1;
    else break;
  }
  return active === 0 ? 1 : active;
}
