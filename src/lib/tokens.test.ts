import { describe, expect, it } from "vitest";
import { estimateTokens } from "./tokens";

/**
 * 这一组的数字是**与后端 `agent/context.rs::estimate_tokens` 对拍**得来的。
 * 改任一侧口径，另一侧的测试必须同步改——否则前端显示的数字会与
 * 后端压缩时用的数字不一致，用户以为估算坏了。
 */
describe("estimateTokens", () => {
  it("空串为 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("纯英文每 4 字符 1 token，末尾 +1", () => {
    expect(estimateTokens("hello")).toBe(2); // 5/4=1 +1
    expect(estimateTokens("abcd")).toBe(2); // 4/4=1 +1
    expect(estimateTokens("abcdefgh")).toBe(3); // 8/4=2 +1
  });

  it("中文每字 1 token", () => {
    expect(estimateTokens("你好")).toBe(3); // 2 + 1
    expect(estimateTokens("你好世界")).toBe(5); // 4 + 1
  });

  it("中英混排按各自口径", () => {
    // "你好ab"：2 CJK + 2 其他 → 2 + 0 + 1 = 3
    expect(estimateTokens("你好ab")).toBe(3);
  });

  it("空格与标点也算非 CJK", () => {
    // "hi there"：8 字符全非 CJK → 2 + 1 = 3
    expect(estimateTokens("hi there")).toBe(3);
  });

  it("日文假名不在 CJK 区间内（与后端口径一致）", () => {
    // あ 是 U+3042，低于 0x2E80？不，0x3042 在 0x2E80–0x9FFF 内 → 算 CJK
    expect(estimateTokens("あ")).toBe(2);
  });

  it("韩文不在 CJK 区间内，按普通字符计（与后端口径一致）", () => {
    // 한 是 U+D55C，高于 0x9FFF 且低于 0xF900 → 不算 CJK
    expect(estimateTokens("한")).toBe(1);
  });

  it("结果单调不减：加内容不会减少", () => {
    const a = estimateTokens("abc");
    const b = estimateTokens("abcdef");
    expect(b).toBeGreaterThan(a);
  });
});
