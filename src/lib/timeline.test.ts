import { describe, expect, it } from "vitest";
import { TURN_SUMMARY_MAX, turnSummary } from "./timeline";

const item = (kind: "user" | "tool", title: string) => ({ kind, title });

describe("turnSummary", () => {
  it("取该轮第一条用户消息作为摘要", () => {
    expect(
      turnSummary([item("tool", "read_file"), item("user", "帮我修一下登录问题"), item("user", "再来一条")]),
    ).toBe("帮我修一下登录问题");
  });

  it("超过 20 字截断并加省略号", () => {
    const long = "一".repeat(30);
    const s = turnSummary([item("user", long)]);
    expect(Array.from(s)).toHaveLength(TURN_SUMMARY_MAX + 1); // 20 字 + 省略号
    expect(s.endsWith("…")).toBe(true);
  });

  it("没有用户消息时返回空串，调用方据此不留占位", () => {
    expect(turnSummary([item("tool", "read_file")])).toBe("");
    expect(turnSummary([])).toBe("");
  });

  /// 按码点截断：emoji 被切成半个代理对会显示成乱码方块
  it("不切断代理对", () => {
    const s = turnSummary([item("user", "🚀".repeat(25))], 4);
    expect(Array.from(s).slice(0, 4).join("")).toBe("🚀🚀🚀🚀");
    expect(s).not.toContain("�");
  });
});
