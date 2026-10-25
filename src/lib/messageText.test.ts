import { describe, expect, it } from "vitest";
import type { Block } from "../store";
import { plainTextOf } from "./messageText";

function block(kind: Block["kind"], text: string): Block {
  if (kind === "action" || kind === "notice" || kind === "error") {
    return { kind, text, ok: true };
  }
  return { kind, text };
}

describe("plainTextOf", () => {
  it("只取 text 块，工具过程记录不算正文", () => {
    const blocks = [
      block("text", "第一段"),
      block("action", "read_file src/main.rs"),
      block("text", "第二段"),
      block("error", "boom"),
    ];
    expect(plainTextOf(blocks)).toBe("第一段\n\n第二段");
  });

  it("纯工具消息返回空串", () => {
    expect(plainTextOf([block("action", "x"), block("notice", "y")])).toBe("");
  });

  it("首尾空白被去掉", () => {
    expect(plainTextOf([block("text", "  hello  ")])).toBe("hello");
  });

  it("多个 text 块之间空一行", () => {
    expect(plainTextOf([block("text", "a"), block("text", "b")])).toBe("a\n\nb");
  });

  it("空数组返回空串", () => {
    expect(plainTextOf([])).toBe("");
  });
});
