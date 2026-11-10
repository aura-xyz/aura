import { describe, expect, it } from "vitest";
import { filePaletteItems, sessionPaletteItems, skillPaletteItems } from "./palette";
import type { Session } from "../store";
import type { FileCandidate, SkillView } from "./api";

function session(id: string, title: string, messages = 1): Session {
  return {
    id,
    title,
    workspace: "E:/dev/aura",
    updated_at: 0,
    messages: Array.from({ length: messages }, (_, i) => ({
      id: `${id}-m${i}`,
      role: "user",
      content: `${title} 的内容`,
    })),
    todos: [],
  } as unknown as Session;
}

function skill(name: string, enabled = true): SkillView {
  return {
    name,
    description: `${name} 的说明`,
    version: "1.0.0",
    source: "builtin",
    allowed_tools: [],
    enabled,
    dir: "",
    path: "",
  };
}

describe("sessionPaletteItems", () => {
  it("空查询给最近几条，且草稿会话不计入", () => {
    const items = sessionPaletteItems(
      [session("s1", "旧的"), session("s2", "新的"), session("s3", "草稿", 0)],
      "",
    );
    expect(items.map((i) => i.label)).toEqual(["新的", "旧的"]);
    expect(items[0].group).toBe("session");
  });

  it("有查询走搜索，标题命中排前面", () => {
    const items = sessionPaletteItems(
      [session("s1", "修登录"), session("s2", "写文档")],
      "登录",
    );
    // 标题与正文各命中一条（正文里也含标题），标题命中排最前
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.label === "修登录")).toBe(true);
    // id 里带会话与命中下标：-1 表示命中标题本身
    expect(items[0].id).toBe("session:s1:-1");
  });
});

describe("skillPaletteItems", () => {
  it("只列已启用技能，并按名称/说明过滤", () => {
    const skills = [skill("docx"), skill("hidden", false), skill("xlsx")];
    expect(skillPaletteItems(skills, "").map((i) => i.label)).toEqual([
      "/docx",
      "/xlsx",
    ]);
    expect(skillPaletteItems(skills, "说明").length).toBe(2);
    expect(skillPaletteItems(skills, "xls").map((i) => i.label)).toEqual(["/xlsx"]);
  });
});

describe("filePaletteItems", () => {
  it("把目录项转成文件组，保留完整路径在 id 里", () => {
    const files: FileCandidate[] = [
      { path: "/src/main.tsx", name: "main.tsx", dir: "/src", is_dir: false },
    ];
    const [item] = filePaletteItems(files);
    expect(item.group).toBe("file");
    expect(item.label).toBe("main.tsx");
    expect(item.id).toBe("file:/src/main.tsx");
  });
});
