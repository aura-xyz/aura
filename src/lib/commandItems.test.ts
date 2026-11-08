import { describe, expect, it } from "vitest";
import {
  exportCommandItems,
  modeCommandItems,
  modelCommandItems,
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
