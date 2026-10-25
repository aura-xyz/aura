import { describe, expect, it } from "vitest";
import type { SkillView } from "./api";
import { MAX_CARDS, buildExampleCards } from "./exampleCards";

function skill(over: Partial<SkillView>): SkillView {
  return {
    name: "docx",
    description: "生成与编辑 Word 文档",
    version: "1.0.0",
    source: "builtin",
    allowed_tools: [],
    enabled: true,
    dir: "C:/skills/docx",
    path: "C:/skills/docx/SKILL.md",
    ...over,
  };
}

describe("buildExampleCards", () => {
  it("从内置技能生成卡片", () => {
    const cards = buildExampleCards([
      skill({ name: "docx" }),
      skill({ name: "pdf", description: "处理 PDF 文件" }),
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[0].name).toBe("docx");
    expect(cards[0].subtitle).toBe("生成与编辑 Word 文档");
  });

  it("只取内置技能", () => {
    const cards = buildExampleCards([
      skill({ name: "market-one", source: "market" }),
      skill({ name: "local-one", source: "local" }),
      skill({ name: "docx" }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("docx");
  });

  it("不取被禁用的技能", () => {
    const cards = buildExampleCards([skill({ name: "docx", enabled: false })]);
    expect(cards).toHaveLength(0);
  });

  it("不取没有说明的技能", () => {
    const cards = buildExampleCards([skill({ name: "docx", description: "" })]);
    expect(cards).toHaveLength(0);
  });

  it("最多展示 MAX_CARDS 张", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      skill({ name: `s${i}`, description: `技能 ${i}` }),
    );
    expect(buildExampleCards(many)).toHaveLength(MAX_CARDS);
  });

  it("说明过长会截断并加省略号", () => {
    const cards = buildExampleCards([
      skill({ name: "long", description: "x".repeat(100) }),
    ]);
    expect(cards[0].subtitle.endsWith("…")).toBe(true);
    expect(cards[0].subtitle.length).toBeLessThan(100);
  });

  it("引导语带上技能名", () => {
    const cards = buildExampleCards([skill({ name: "docx" })]);
    expect(cards[0].prompt).toContain("docx");
  });

  it("空列表返回空数组", () => {
    expect(buildExampleCards([])).toEqual([]);
  });
});
