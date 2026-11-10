import { describe, expect, it } from "vitest";
import { planChunk } from "./streamChunks";
import { splitMarkdown } from "./markdownSegments";

/**
 * v0.8.1 P04 的流式性能基准。
 *
 * 以**结构性阈值**为主（尾部待解析片段有界、已完成片段不再变化、积压能在
 * 有限帧内追平），墙钟只设一个很宽松的上限兜底——CI 上单次计时抖动大，
 * 把阈值卡在几十毫秒只会得到一条时红时绿的断言。
 */

function longAnswer(paragraphs: number): string {
  const out: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    out.push(`第${i}段 ${"模型输出的正文内容".repeat(20)}\n`);
    if (i % 5 === 0) out.push("```rust\nfn main() {}\n```\n");
    out.push("\n");
  }
  return out.join("");
}

describe("流式渲染性能基准", () => {
  it("10 万字符回答的切分耗时受控且拼接无损", () => {
    const content = longAnswer(500);
    expect(content.length).toBeGreaterThan(90_000);

    const start = performance.now();
    const parts = splitMarkdown(content);
    const cost = performance.now() - start;

    expect(cost).toBeLessThan(300);
    expect(parts.join("")).toBe(content);
    expect(parts.length).toBeGreaterThan(10);
  });

  it("尾部待解析片段长度有界，不随回答变长而线性增长", () => {
    for (const n of [50, 200, 500]) {
      const content = longAnswer(n);
      const parts = splitMarkdown(content);
      const tail = parts[parts.length - 1] ?? "";
      expect(tail.length).toBeLessThan(2000);
      expect(tail.length).toBeLessThan(content.length / 10);
    }
  });

  it("流式追加时只有尾部片段变化，已完成片段文本保持不变", () => {
    const base = longAnswer(20);
    const before = splitMarkdown(base);
    const after = splitMarkdown(`${base}继续输出`);

    expect(before.length).toBeGreaterThan(1);
    expect(after.slice(0, before.length - 1)).toEqual(before.slice(0, -1));
    expect(after[after.length - 1]).toContain("继续输出");
  });

  it("持续追加过程中，每帧需要重解析的文本始终有界", () => {
    let content = "";
    for (let i = 0; i < 120; i++) {
      content += `${"正文片段".repeat(30)}\n\n`;
      const parts = splitMarkdown(content);
      expect(parts[parts.length - 1].length).toBeLessThan(2000);
    }
  });

  it("超大积压能在有限帧内追平，不会越写越慢", () => {
    let backlog = 100_000;
    let frames = 0;
    while (backlog > 0 && frames < 1000) {
      backlog -= planChunk(backlog, 16);
      frames += 1;
    }
    expect(backlog).toBe(0);
    expect(frames).toBeLessThan(200);
  });
});
