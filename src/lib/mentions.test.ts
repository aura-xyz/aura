import { describe, expect, it } from "vitest";
import { fileItems, findTrigger, skillItems } from "./mentions";
import type { SkillView } from "./api";

/**
 * @ / 触发判定。
 *
 * 这里每条规则都对应一种「不该触发却触发了」的骚扰场景：
 * 邮箱里的 @、路径里的 /、打完空格后的残留触发。
 */
describe("findTrigger", () => {
  it("行首打 @ 即触发，过滤词为空", () => {
    const t = findTrigger("@", 1);
    expect(t).not.toBeNull();
    expect(t?.kind).toBe("file");
    expect(t?.char).toBe("@");
    expect(t?.start).toBe(0);
    expect(t?.query).toBe("");
  });

  it("打完若干字符后仍能识别出触发符，过滤词是中间那段", () => {
    const t = findTrigger("@store", 6);
    expect(t?.kind).toBe("file");
    expect(t?.start).toBe(0);
    expect(t?.query).toBe("store");
  });

  it("触发符前面是空白时也能触发", () => {
    // "看下 @store" → @ 在下标 3，光标在末尾（9）
    const t = findTrigger("看下 @store", 9);
    expect(t?.kind).toBe("file");
    expect(t?.start).toBe(3);
    expect(t?.query).toBe("store");
  });

  it("斜杠触发技能", () => {
    const t = findTrigger("/doc", 4);
    expect(t?.kind).toBe("skill");
    expect(t?.char).toBe("/");
    expect(t?.query).toBe("doc");
  });

  it("邮箱里的 @ 不触发", () => {
    // 触发符前面不是空白 → 不是引用
    expect(findTrigger("a@b.com", 6)).toBeNull();
  });

  it("路径里的斜杠不触发", () => {
    // src/lib 里的 / 前面是字母 → 不是技能调用
    expect(findTrigger("src/lib", 7)).toBeNull();
  });

  it("打了空格之后触发结束", () => {
    expect(findTrigger("@store extra", 12)).toBeNull();
  });

  it("光标不在触发处时不触发", () => {
    // 光标在 @ 之前
    expect(findTrigger("@store", 0)).toBeNull();
  });

  it("光标之后的内容不影响判定", () => {
    // 光标在中间：@st|ore，后面的内容不该被算进过滤词
    const t = findTrigger("@store", 3);
    expect(t?.query).toBe("st");
  });
});

describe("fileItems", () => {
  const files = [
    { path: "src/store.tsx", name: "store.tsx", dir: "src" },
    { path: "src/store/notes.md", name: "notes.md", dir: "src/store" },
    { path: "docs/readme.md", name: "readme.md", dir: "docs" },
  ];

  it("按文件名或路径过滤", () => {
    const items = fileItems(files, "store");
    expect(items.map((i) => i.label)).toEqual(["store.tsx", "notes.md"]);
  });

  it("插入格式是 @<路径>，与拖放文件一致", () => {
    const items = fileItems(files, "store.tsx");
    expect(items[0].insert).toBe("@<src/store.tsx>");
  });

  it("空过滤词返回全部", () => {
    expect(fileItems(files, "").length).toBe(3);
  });
});

describe("skillItems", () => {
  const skills: SkillView[] = [
    {
      name: "docx",
      description: "处理 Word 文档",
      version: "1",
      source: "builtin",
      allowed_tools: [],
      enabled: true,
      dir: "",
      path: "",
    },
    {
      name: "pdf",
      description: "处理 PDF",
      version: "1",
      source: "builtin",
      allowed_tools: [],
      enabled: false,
      dir: "",
      path: "",
    },
  ];

  it("只列已启用的技能", () => {
    // 被禁用的技能模型也看不见，列出来点了也白点
    expect(skillItems(skills, "").map((i) => i.label)).toEqual(["docx"]);
  });

  it("按名字过滤", () => {
    expect(skillItems(skills, "doc").map((i) => i.label)).toEqual(["docx"]);
  });

  it("插入格式是 /技能名", () => {
    expect(skillItems(skills, "docx")[0].insert).toBe("/docx");
  });
});
