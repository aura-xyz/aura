import { describe, expect, it } from "vitest";
import { deriveStats, formatDuration } from "./stats";
import type { ChatMessage } from "../store";

const user = { id: "u1", role: "user", content: "继续" } as ChatMessage;

function assistant(blocks: unknown[], id = "a1"): ChatMessage {
  return { id, role: "assistant", blocks } as ChatMessage;
}

describe("会话统计", () => {
  it("LLM 耗时来自后端累计值，不再是恒零项", () => {
    const stats = deriveStats([], 4200);
    expect(stats.llmMs).toBe(4200);
    expect(formatDuration(stats.llmMs)).toBe("4.2s");
  });

  it("工具耗时仍从 action 块累加，与 LLM 耗时互不串线", () => {
    const messages = [
      assistant([
        { kind: "action", text: "读文件", durationMs: 1200 },
        { kind: "action", text: "执行命令", durationMs: 800 },
      ]),
      user,
    ];
    const stats = deriveStats(messages, 300);
    expect(stats.turns).toBe(1);
    expect(stats.steps).toBe(1);
    expect(stats.toolMs).toBe(2000);
    expect(stats.llmMs).toBe(300);
  });

  it("没有 durationMs 的动作块不计耗时；空回复也算一步", () => {
    const stats = deriveStats(
      [assistant([{ kind: "action", text: "开始" }]), assistant([], "a2")],
      0,
    );
    expect(stats.steps).toBe(2);
    expect(stats.toolMs).toBe(0);
  });

  /// 缓存按消息对象记忆：流式更新换新对象，必须立刻反映新的工具耗时，
  /// 否则统计会一直停在上一次的值。
  it("同一条消息换了新对象后计入新增耗时", () => {
    const first = assistant([{ kind: "action", text: "读文件", durationMs: 500 }]);
    expect(deriveStats([first]).toolMs).toBe(500);

    const grown = assistant([
      { kind: "action", text: "读文件", durationMs: 500 },
      { kind: "action", text: "执行命令", durationMs: 700 },
    ]);
    expect(deriveStats([grown]).toolMs).toBe(1200);
  });

  it("长会话里重复求值结果稳定（走缓存不改变语义）", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ id: `u${i}`, role: "user", content: `${i}` } as ChatMessage);
      messages.push(
        assistant([{ kind: "action", text: "执行", durationMs: 100 }], `a${i}`),
      );
    }
    const once = deriveStats(messages);
    const twice = deriveStats(messages);
    expect(once).toEqual(twice);
    expect(once).toEqual({ turns: 20, steps: 20, llmMs: 0, toolMs: 2000 });
  });
});
