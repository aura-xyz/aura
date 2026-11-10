import { describe, expect, it } from "vitest";
import {
  exportCommandItems,
  modeCommandItems,
  modelCommandItems,
  actionCommandItems,
  filterCommandItems,
  groupCommandItems,
  nextMode,
  rootCommandItems,
  skillCommandItems,
} from "./commandItems";
import type { ModelInfo, SkillView } from "./api";

const SKILLS: SkillView[] = [
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
    name: "hidden",
    description: "已禁用",
    version: "1",
    source: "builtin",
    allowed_tools: [],
    enabled: false,
    dir: "",
    path: "",
  },
];

const MODELS: ModelInfo[] = [
  {
    key: "p:a",
    id: "a",
    label: "模型甲",
    provider: "p",
    provider_name: "厂商",
    context_limit: 100,
    pinned: true,
  },
  {
    key: "p:b",
    id: "b",
    label: "模型乙",
    provider: "p",
    provider_name: "厂商",
    context_limit: 100,
    pinned: false,
  },
];

describe("命令面板数据", () => {
  it("根命令恰好 5 个且按定义顺序，/ 后前缀可过滤", () => {
    expect(rootCommandItems("").map((i) => i.id)).toEqual([
      "skill",
      "goal",
      "model",
      "mode",
      "export",
    ]);
    expect(rootCommandItems("sk").map((i) => i.id)).toEqual(["skill"]);
  });

  it("技能菜单沿用旧口径：只列已启用、可按名字过滤", () => {
    expect(skillCommandItems(SKILLS, "").map((i) => i.id)).toEqual(["docx"]);
    expect(skillCommandItems(SKILLS, "doc").map((i) => i.id)).toEqual(["docx"]);
    expect(skillCommandItems(SKILLS, "hidden")).toEqual([]);
  });

  it("模型菜单只列已收藏，并标出当前模型", () => {
    const items = modelCommandItems(MODELS, "p:a", "");
    expect(items.map((i) => i.id)).toEqual(["p:a"]);
    expect(items[0].detail).toContain("当前模型");
  });

  /// 实测反馈：/model 像没触发一样。根因是收藏为空时只剩空面板，
  /// 首次启动或收藏写入失败必然踩到，必须回退到全部可用模型。
  it("一个都没收藏时回退到全部模型，/model 不会变成空面板", () => {
    const unpinned = MODELS.map((m) => ({ ...m, pinned: false }));
    expect(modelCommandItems(unpinned, "p:a", "").map((i) => i.id)).toEqual([
      "p:a",
      "p:b",
    ]);
    expect(modelCommandItems([], "p:a", "")).toEqual([]);
  });

  it("模式菜单三档顺序与 ModeTabs 一致，选中项有标注", () => {
    expect(modeCommandItems("chat", "").map((i) => i.id)).toEqual([
      "chat",
      "plan",
      "build",
    ]);
    expect(modeCommandItems("plan", "")[1].detail).toContain("当前");
  });

  it("导出面板只有一个动作；Tab 循环切换模式", () => {
    expect(exportCommandItems()).toHaveLength(1);
    expect(nextMode("chat")).toBe("plan");
    expect(nextMode("plan")).toBe("build");
    expect(nextMode("build")).toBe("chat");
  });

});
describe("全局面板的分组与动作", () => {
  it("按动作/会话/技能/文件切开，组内保序，空组不返回", () => {
    const groups = groupCommandItems([
      { id: "s1", label: "会话 A", detail: "", group: "session" },
      { id: "a1", label: "动作 A", detail: "", group: "action" },
      { id: "f1", label: "文件 A", detail: "", group: "file" },
    ]);
    expect(groups.map((g) => g.group)).toEqual(["action", "session", "file"]);
    expect(groups[1].items[0].label).toBe("会话 A");
    // 缺省 group 归到动作
    expect(
      groupCommandItems([{ id: "x", label: "x", detail: "" }])[0].group,
    ).toBe("action");
  });

  it("过滤同时看标签与说明，空查询原样返回", () => {
    const items = [
      { id: "a", label: "打开设置", detail: "外观、模型服务" },
      { id: "b", label: "新建对话", detail: "Ctrl + N" },
    ];
    expect(filterCommandItems(items, "")).toBe(items);
    expect(filterCommandItems(items, "模型").map((i) => i.id)).toEqual(["a"]);
    expect(filterCommandItems(items, "ctrl").map((i) => i.id)).toEqual(["b"]);
  });

  it("动作项带稳定的执行键，当前模式/主题有标记", () => {
    const items = actionCommandItems({ mode: "plan", theme: "dark" });
    const ids = items.map((i) => i.id);
    expect(ids).toContain("action:new");
    expect(ids).toContain("action:mode:plan");
    expect(ids).toContain("action:theme:dark");
    expect(ids).toContain("action:export");
    expect(items.every((i) => i.group === "action")).toBe(true);
    expect(
      items.find((i) => i.id === "action:mode:plan")?.detail,
    ).toContain("当前");
    expect(
      items.find((i) => i.id === "action:theme:dark")?.detail,
    ).toBe("当前");
  });
});
