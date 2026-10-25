import { describe, expect, it } from "vitest";
import { MAX_DIFF_LINES, diffLines } from "./diff";

describe("diffLines", () => {
  it("内容相同时全部是上下文行", () => {
    const r = diffLines("a\nb\nc", "a\nb\nc");
    expect(r.added).toBe(0);
    expect(r.removed).toBe(0);
    expect(r.lines.every((l) => l.type === "context")).toBe(true);
    expect(r.lines).toHaveLength(3);
  });

  it("新增一行", () => {
    const r = diffLines("a\nb", "a\nX\nb");
    expect(r.added).toBe(1);
    expect(r.removed).toBe(0);
    const add = r.lines.find((l) => l.type === "add");
    expect(add?.text).toBe("X");
    expect(add?.newLine).toBe(2);
    expect(add?.oldLine).toBeNull();
  });

  it("删除一行", () => {
    const r = diffLines("a\nX\nb", "a\nb");
    expect(r.removed).toBe(1);
    expect(r.added).toBe(0);
    const del = r.lines.find((l) => l.type === "del");
    expect(del?.text).toBe("X");
    expect(del?.oldLine).toBe(2);
  });

  it("修改一行算一删一增", () => {
    const r = diffLines("a\nOLD\nb", "a\nNEW\nb");
    expect(r.added).toBe(1);
    expect(r.removed).toBe(1);
  });

  it("新增文件：全是新增行", () => {
    const r = diffLines("", "a\nb");
    expect(r.added).toBe(2);
    expect(r.removed).toBe(0);
    expect(r.lines.every((l) => l.type === "add")).toBe(true);
  });

  it("删除文件：全是删除行", () => {
    const r = diffLines("a\nb", "");
    expect(r.removed).toBe(2);
    expect(r.added).toBe(0);
  });

  it("两边都空", () => {
    const r = diffLines("", "");
    expect(r.lines).toHaveLength(0);
    expect(r.added).toBe(0);
    expect(r.removed).toBe(0);
  });

  it("缩进差异也算差异", () => {
    const r = diffLines("  a", "a");
    expect(r.added).toBe(1);
    expect(r.removed).toBe(1);
  });

  it("行号连续标注正确", () => {
    const r = diffLines("a\nb\nc", "a\nb\nc");
    expect(r.lines.map((l) => l.oldLine)).toEqual([1, 2, 3]);
    expect(r.lines.map((l) => l.newLine)).toEqual([1, 2, 3]);
  });

  it("末尾换行不产生多余行", () => {
    const r = diffLines("a\nb\n", "a\nb");
    expect(r.lines).toHaveLength(2);
    expect(r.added).toBe(0);
    expect(r.removed).toBe(0);
  });

  it("文件过大时退化成整体替换", () => {
    const big = Array.from({ length: MAX_DIFF_LINES + 10 }, (_, i) => `l${i}`).join("\n");
    const r = diffLines(big, big + "\nextra");
    expect(r.degraded).toBe(true);
    // 退化 = 旧文件全删 + 新文件全加（不做逐行比对）
    expect(r.removed).toBe(big.split("\n").length);
    expect(r.added).toBe(big.split("\n").length + 1);
  });

  it("未超阈值时不退化", () => {
    const r = diffLines("a", "b");
    expect(r.degraded).toBe(false);
  });
});
