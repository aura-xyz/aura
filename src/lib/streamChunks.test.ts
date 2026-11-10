import { describe, expect, it } from "vitest";
import { planChunk } from "./streamChunks";

describe("planChunk", () => {
  it("空缓冲不消费", () => {
    expect(planChunk(0, 16)).toBe(0);
  });

  it("慢速区保持逐字节奏", () => {
    expect(planChunk(1, 16)).toBe(1);
    expect(planChunk(30, 16)).toBe(1);
    expect(planChunk(60, 16)).toBe(2);
  });

  it("中速区按 backlog/30 追平", () => {
    expect(planChunk(300, 16)).toBe(10);
  });

  it("大积压按更快节奏追赶", () => {
    expect(planChunk(1500, 16)).toBe(104);
  });

  it("掉帧时加倍消费，避免越写越慢", () => {
    expect(planChunk(300, 30)).toBe(20);
    expect(planChunk(300, 50)).toBe(30);
  });

  it("永远不超过积压量", () => {
    for (const backlog of [1, 5, 60, 61, 299, 300, 301, 5000]) {
      const n = planChunk(backlog, 100);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(backlog);
    }
  });
});
