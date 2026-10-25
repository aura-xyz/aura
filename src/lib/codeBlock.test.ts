import { describe, expect, it } from "vitest";
import {
  FOLD_THRESHOLD_LINES,
  countLines,
  foldPreview,
  shouldFold,
} from "./codeBlock";

describe("countLines", () => {
  it("空串算 0 行", () => {
    expect(countLines("")).toBe(0);
  });

  it("单行算 1 行", () => {
    expect(countLines("abc")).toBe(1);
  });

  it("按换行分割", () => {
    expect(countLines("a\nb\nc")).toBe(3);
  });

  it("末尾换行不额外算一行", () => {
    expect(countLines("a\nb\n")).toBe(2);
  });

  it("只有换行符算 1 行", () => {
    expect(countLines("\n")).toBe(1);
  });
});

describe("shouldFold", () => {
  it("不超过阈值不折叠", () => {
    const code = Array.from({ length: FOLD_THRESHOLD_LINES }, (_, i) => `l${i}`).join("\n");
    expect(shouldFold(code)).toBe(false);
  });

  it("超过阈值则折叠", () => {
    const code = Array.from({ length: FOLD_THRESHOLD_LINES + 1 }, (_, i) => `l${i}`).join("\n");
    expect(shouldFold(code)).toBe(true);
  });

  it("空代码不折叠", () => {
    expect(shouldFold("")).toBe(false);
  });
});

describe("foldPreview", () => {
  it("只留头部若干行", () => {
    const code = Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n");
    const preview = foldPreview(code, 3);
    expect(preview).toBe("l0\nl1\nl2");
  });

  it("代码比预览还短时原样返回", () => {
    expect(foldPreview("a\nb", 6)).toBe("a\nb");
  });

  it("空代码返回空串", () => {
    expect(foldPreview("", 6)).toBe("");
  });
});
