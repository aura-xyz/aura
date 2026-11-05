import { beforeEach, describe, expect, it } from "vitest";
import { loadMarkdownLive, saveMarkdownLive } from "./markdownLive";

beforeEach(() => localStorage.clear());

describe("输入框 Markdown 实时渲染开关", () => {
  it("默认开启", () => {
    expect(loadMarkdownLive()).toBe(true);
  });

  it("关闭后持久化，重新读取仍为关闭", () => {
    saveMarkdownLive(false);
    expect(loadMarkdownLive()).toBe(false);
    saveMarkdownLive(true);
    expect(loadMarkdownLive()).toBe(true);
  });
});
