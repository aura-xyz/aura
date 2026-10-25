import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../store";
import {
  keepThroughForResend,
  originalQuestion,
  sliceForResend,
  userIndexForAssistant,
} from "./history";

function user(content: string): ChatMessage {
  return { id: `u-${content}`, role: "user", content };
}

function assistant(content: string): ChatMessage {
  return {
    id: `a-${content}`,
    role: "assistant",
    blocks: [{ kind: "text", text: content }],
  };
}

/** u1 / a1 / u2 / a2 */
function sample(): ChatMessage[] {
  return [user("u1"), assistant("a1"), user("u2"), assistant("a2")];
}

describe("userIndexForAssistant", () => {
  it("找到该回答是由第几条用户消息触发的", () => {
    const m = sample();
    expect(userIndexForAssistant(m, 1)).toBe(1); // a1 ← u1
    expect(userIndexForAssistant(m, 2)).toBe(2); // a2 ← u2
  });

  it("序号非法返回 null", () => {
    expect(userIndexForAssistant(sample(), 0)).toBeNull();
    expect(userIndexForAssistant(sample(), 99)).toBeNull();
  });

  it("首条就是 assistant 的异常数据返回 null", () => {
    expect(userIndexForAssistant([assistant("a1")], 1)).toBeNull();
  });
});

describe("originalQuestion", () => {
  it("取到原问题文本", () => {
    expect(originalQuestion(sample(), 1)).toBe("u1");
    expect(originalQuestion(sample(), 2)).toBe("u2");
  });

  it("序号非法返回 null", () => {
    expect(originalQuestion(sample(), 0)).toBeNull();
    expect(originalQuestion(sample(), 99)).toBeNull();
  });
});

describe("sliceForResend", () => {
  it("删掉该用户消息及其后", () => {
    const kept = sliceForResend(sample(), 1);
    expect(kept).toHaveLength(0);
  });

  it("保留到它之前", () => {
    const kept = sliceForResend(sample(), 2);
    expect(kept).toHaveLength(2);
    expect(kept[0].role).toBe("user");
    expect(kept[1].role).toBe("assistant");
  });

  it("非法序号原样返回（不误删）", () => {
    expect(sliceForResend(sample(), 0)).toHaveLength(4);
    expect(sliceForResend(sample(), 99)).toHaveLength(4);
  });
});

describe("keepThroughForResend", () => {
  it("删掉第 k 条用户消息 → 保留到 k-1", () => {
    expect(keepThroughForResend(1)).toBe(0);
    expect(keepThroughForResend(2)).toBe(1);
  });

  it("不会返回负数", () => {
    expect(keepThroughForResend(0)).toBe(0);
    expect(keepThroughForResend(-5)).toBe(0);
  });
});

describe("重新生成与编辑的语义一致性", () => {
  /**
   * 两者后端截断点必须相同：都是「保留到 uIdx-1 条用户消息」。
   * 区别只在重新发送的内容（原文 / 新内容）。
   */
  it("同一 userIndex 推出同一截断点", () => {
    const m = sample();
    const uIdx = userIndexForAssistant(m, 2)!;
    expect(uIdx).toBe(2);
    // 重新生成第 2 条回答 → 截断点 1
    // 编辑第 2 条用户消息 → 截断点也是 1
    expect(keepThroughForResend(uIdx)).toBe(1);
    expect(keepThroughForResend(2)).toBe(1);
  });

  it("重新生成取到的原问题就是触发那条回答的问题", () => {
    const m = sample();
    const uIdx = userIndexForAssistant(m, 2)!;
    expect(originalQuestion(m, uIdx)).toBe("u2");
  });
});
