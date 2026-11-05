import { describe, expect, it } from "vitest";
import { deriveStats, formatDuration } from "./StatsPills";

describe("会话统计", () => {
  it("LLM 耗时来自后端累计值，不再是恒零项", () => {
    const stats = deriveStats([], 4200);
    expect(stats.llmMs).toBe(4200);
    expect(formatDuration(stats.llmMs)).toBe("4.2s");
  });

  it("工具耗时仍从 action 块累加，与 LLM 耗时互不串线", () => {
    const messages = [
      {
        role: "assistant",
        blocks: [
          { kind: "action", text: "读文件", durationMs: 1200 },
          { kind: "action", text: "执行命令", durationMs: 800 },
        ],
      },
      { role: "user", content: "继续" },
    ] as never;
    const stats = deriveStats(messages, 300);
    expect(stats.turns).toBe(1);
    expect(stats.steps).toBe(1);
    expect(stats.toolMs).toBe(2000);
    expect(stats.llmMs).toBe(300);
  });
});
