import { describe, expect, it } from "vitest";
import { isMarkdownPaste } from "./markdownPaste";

describe("粘贴 Markdown 判定", () => {
  it("识别常见块级语法", () => {
    for (const text of [
      "# 标题",
      "## 二级标题\n正文",
      "> 引用",
      "- 列表项\n- 第二项",
      "- [x] 已完成的勾选项",
      "1. 第一步\n2. 第二步",
      "```ts\nconst a = 1;\n```",
      "上文\n\n---\n\n下文",
    ]) {
      expect(isMarkdownPaste(text), text).toBe(true);
    }
  });

  it("识别闭合的内联语法", () => {
    expect(isMarkdownPaste("这是 **加粗** 和 `代码`")).toBe(true);
    expect(isMarkdownPaste("[文档](https://example.com)")).toBe(true);
    expect(isMarkdownPaste("~~删除线~~")).toBe(true);
  });

  it("普通文本与半截语法不走转换", () => {
    for (const text of [
      "",
      "帮我看看目录里有什么文件",
      "价格是 3 * 4 = 12",
      "还没写完的 **加粗",
      "路径 src/lib/a.ts",
      "版本号 1.2.3 与 2.0",
    ]) {
      expect(isMarkdownPaste(text), text).toBe(false);
    }
  });
});
