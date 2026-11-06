import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../store";
import {
  activeTurnAt,
  buildTurnItems,
  centerOffset,
  previewText,
  totalSize,
  visibleRange,
} from "./turnRail";

function user(content: string): ChatMessage {
  return { id: `u-${content}`, role: "user", content };
}

function assistant(text: string, kind: "text" | "action" = "text"): ChatMessage {
  return {
    id: `a-${text}`,
    role: "assistant",
    blocks: [{ kind, text }],
  };
}

describe("时间线轮次表", () => {
  it("一个轮次 = 一条用户消息，编号从 1 递增", () => {
    const items = buildTurnItems([
      user("第一问"),
      assistant("答一"),
      user("第二问"),
      assistant("答二"),
    ]);
    expect(items.map((i) => i.turn)).toEqual([1, 2]);
    expect(items.map((i) => i.prompt)).toEqual(["第一问", "第二问"]);
    expect(items.map((i) => i.response)).toEqual(["答一", "答二"]);
  });

  it("只取该轮首条回复，工具过程与重跑产生的后续回复不进预览", () => {
    const items = buildTurnItems([
      user("问题"),
      assistant("跑了 ls", "action"),
      assistant("正式回答"),
      assistant("重新生成的回答"),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].response).toBe("正式回答");
  });

  it("末尾只有用户消息时轮次仍可导航，回复预览为空", () => {
    const items = buildTurnItems([user("还没答")]);
    expect(items).toEqual([{ turn: 1, prompt: "还没答", response: "" }]);
  });
});

describe("预览文本", () => {
  it("折叠换行与连续空白", () => {
    expect(previewText("第一行\n\n  第二行\t末尾")).toBe("第一行 第二行 末尾");
  });

  it("超长文本截断成一行", () => {
    const out = previewText("甲".repeat(200), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("定高虚拟范围", () => {
  it("只渲染视口内条目，两端各留 overscan", () => {
    expect(visibleRange(1000, 0, 100, 10, 2)).toEqual({ start: 0, end: 12 });
    expect(visibleRange(1000, 500, 100, 10, 2)).toEqual({ start: 48, end: 62 });
  });

  it("长列表也不会把全部条目渲染出来", () => {
    const r = visibleRange(100_000, 50_000, 400, 32, 3);
    expect(r.end - r.start).toBeLessThan(30);
  });

  it("尚未测量到视口高度时只给一小段", () => {
    expect(visibleRange(1000, 0, 0, 10)).toEqual({ start: 0, end: 3 });
  });

  it("滚到底不会越界", () => {
    expect(visibleRange(20, 9999, 100, 10, 2).end).toBe(20);
  });
});

describe("轨道几何与激活轮次", () => {
  it("总高度含上下 inset", () => {
    expect(totalSize(10, 10, 6)).toBe(112);
    expect(centerOffset(0, 10, 6, 100, 112)).toBe(0);
    expect(centerOffset(9, 10, 6, 100, 112)).toBe(12);
  });

  it("居中滚动钳到合法范围，不会滚出内容区", () => {
    const total = totalSize(100, 10, 6);
    const off = centerOffset(99, 10, 6, 200, total);
    expect(off).toBe(total - 200);
  });

  it("激活轮次取视口上三分之一线之前最后一条", () => {
    const positions = [0, 300, 600, 900];
    expect(activeTurnAt(positions, 0, 300)).toBe(1);
    expect(activeTurnAt(positions, 300, 300)).toBe(2);
    expect(activeTurnAt(positions, 900, 300)).toBe(4);
  });

  it("没有锚点时返回 0", () => {
    expect(activeTurnAt([], 0, 300)).toBe(0);
  });
});
