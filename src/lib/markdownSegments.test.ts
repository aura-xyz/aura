import { describe, expect, it } from "vitest";
import { hasUnclosedFence, splitMarkdown } from "./markdownSegments";

/** 造一段够长的正文，避免测试依赖中文字符数换算 */
const para = (word: string, times = 100) =>
  Array.from({ length: times }, (_, i) => `${word}${i}`).join(" ");

describe("splitMarkdown", () => {
  it("短回答不切，保持原来的单次解析", () => {
    expect(splitMarkdown("你好，这是一段短回答")).toEqual([
      "你好，这是一段短回答",
    ]);
  });

  it("长回答按空行切成多段，且拼接后无损还原原文", () => {
    const content = `${para("开头")}\n\n${para("中段")}\n\n${para("结尾")}`;
    const parts = splitMarkdown(content);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(content);
  });

  it("围栏代码块内部的空行不是边界，代码块整体留在同一片段", () => {
    const code = "```ts\nconst a = 1;\n\nconst b = 2;\n```";
    const content = `${para("前言")}\n\n${code}\n\n${para("后记")}`;
    const parts = splitMarkdown(content);
    expect(parts.join("")).toBe(content);
    const withFence = parts.filter((p) => p.includes("```"));
    expect(withFence).toHaveLength(1);
    expect(withFence[0]).toContain("const b = 2;");
    expect(withFence[0]).toContain("```");
  });

  it("未闭合的围栏整体留在尾部片段，不会产生半个代码块", () => {
    const content = `${para("前言")}\n\n\`\`\`ts\n${para("code")}\n\n${para("more")}`;
    const parts = splitMarkdown(content);
    expect(parts.join("")).toBe(content);
    expect(parts[parts.length - 1]).toContain("```ts");
    // 只有最后一段带围栏，前面的稳定片段不受未闭合状态污染
    expect(parts.slice(0, -1).some((p) => p.includes("```"))).toBe(false);
  });

  it("连续空行只按累计长度切，不产生成百上千个碎片段", () => {
    const content = Array.from({ length: 400 }, (_, i) => `短${i}`).join("\n\n");
    const parts = splitMarkdown(content);
    expect(parts.length).toBeLessThan(20);
    expect(parts.join("")).toBe(content);
  });

  it("没有空行的超长单段落退化为整段解析", () => {
    const content = para("连续", 300);
    expect(content.length).toBeGreaterThan(800);
    expect(splitMarkdown(content)).toEqual([content]);
  });
});

describe("hasUnclosedFence", () => {
  it("成对闭合的代码块返回 false", () => {
    expect(hasUnclosedFence("```ts\nlet a = 1;\n```\n\n收尾")).toBe(false);
  });

  it("流式输出到一半的代码块返回 true", () => {
    expect(hasUnclosedFence("说明\n\n```ts\nlet a = ")).toBe(true);
  });

  it("闭合围栏必须与开启字符相同且不短于开启长度", () => {
    expect(hasUnclosedFence("````rust\nfn main() {}\n```")).toBe(true);
    expect(hasUnclosedFence("````rust\nfn main() {}\n````")).toBe(false);
    expect(hasUnclosedFence("~~~text\n内容\n```")).toBe(true);
  });

  it("围栏内出现带 info 的普通行不会被误判为闭合", () => {
    expect(hasUnclosedFence("```ts\n```rust\nlet a = 1;")).toBe(true);
  });
});
