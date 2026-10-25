import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../store";
import {
  keepThroughForEdit,
  keepThroughForRegenerate,
  sliceForEdit,
  sliceForRegenerate,
  userMessagesBeforeAssistant,
} from "./history";

function user(content: string): ChatMessage {
  return { id: `u-${content}`, role: "user", content };
}

function assistant(content: string): ChatMessage {
  return { id: `a-${content}`, role: "assistant", blocks: [{ kind: "text", text: content }] };
}

/** u1 / a1 / u2 / a2 */
function sample(): ChatMessage[] {
  return [user("u1"), assistant("a1"), user("u2"), assistant("a2")];
}

/** 取消息的可读内容（user 是 content，assistant 取首个 text block） */
function contentOf(m: ChatMessage): string {
  if (m.role === "user") return m.content;
  const t = m.blocks.find((b) => b.kind === "text");
  return t && t.kind === "text" ? t.text : "";
}

describe("userMessagesBeforeAssistant", () => {
  it("数出某条回答之前的用户问题条数", () => {
    const m = sample();
    expect(userMessagesBeforeAssistant(m, 1)).toBe(1); // a1 之前有 u1
    expect(userMessagesBeforeAssistant(m, 2)).toBe(2); // a2 之前有 u1 u2
  });

  it("找不到对应回答时返回 0", () => {
    expect(userMessagesBeforeAssistant(sample(), 99)).toBe(0);
  });
});

describe("keepThroughForRegenerate", () => {
  it("重新生成第 1 条回答 → 保留到第 1 条用户问题", () => {
    // 问题保留，回答删掉
    expect(keepThroughForRegenerate(sample(), 1)).toBe(1);
  });

  it("重新生成第 2 条回答 → 保留到第 2 条用户问题", () => {
    expect(keepThroughForRegenerate(sample(), 2)).toBe(2);
  });

  it("非法序号返回 null（不发起截断）", () => {
    expect(keepThroughForRegenerate(sample(), 0)).toBeNull();
    expect(keepThroughForRegenerate(sample(), 99)).toBeNull();
  });

  it("首条就是 assistant 的异常数据返回 null", () => {
    expect(keepThroughForRegenerate([assistant("a1")], 1)).toBeNull();
  });
});

describe("keepThroughForEdit", () => {
  it("编辑第 1 条用户消息 → 保留到第 0 条（该问题本身也删掉）", () => {
    expect(keepThroughForEdit(sample(), 1)).toBe(0);
  });

  it("编辑第 2 条用户消息 → 保留到第 1 条", () => {
    expect(keepThroughForEdit(sample(), 2)).toBe(1);
  });

  it("非法序号返回 null", () => {
    expect(keepThroughForEdit(sample(), 0)).toBeNull();
    expect(keepThroughForEdit(sample(), 99)).toBeNull();
  });
});

describe("sliceForRegenerate", () => {
  it("删掉该回答及其后全部消息", () => {
    const kept = sliceForRegenerate(sample(), 1);
    expect(kept).toHaveLength(1);
    expect(kept[0].role).toBe("user");
    expect(contentOf(kept[0])).toBe("u1");
  });

  it("重新生成第 2 条回答时保留前面的内容", () => {
    const kept = sliceForRegenerate(sample(), 2);
    expect(kept).toHaveLength(3);
    expect(kept.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("sliceForEdit", () => {
  it("删掉该用户消息及其后", () => {
    const kept = sliceForEdit(sample(), 1);
    expect(kept).toHaveLength(0);
  });

  it("编辑第 2 条用户消息时保留到它之前", () => {
    const kept = sliceForEdit(sample(), 2);
    expect(kept).toHaveLength(2);
    expect(contentOf(kept[0])).toBe("u1");
    expect(contentOf(kept[1])).toBe("a1");
  });
});

describe("前后端语义一致性", () => {
  /**
   * 前端算出的 keepThroughUser 与后端的截断语义必须对得上：
   * 重新生成第 k 条回答时，前端删掉 UI 里的 [a_k..end]，
   * 后端删掉 history 里的 [u_k 之后..end]。
   * 两者必须同时指向「同一个问题之后」。
   */
  it("重新生成时前端切片与后端保留点一致", () => {
    const m = sample();
    const keep = keepThroughForRegenerate(m, 2)!; // → 2
    // 前端保留到第 2 条用户问题之前
    const uiKept = sliceForRegenerate(m, 2);
    // 后端保留到第 2 条用户消息为止（该条也在）
    // 换算成 UI：用户问题共 2 条，UI 里应保留 u1/a1/u2
    const userCount = uiKept.filter((x) => x.role === "user").length;
    expect(userCount).toBe(keep);
  });
});
