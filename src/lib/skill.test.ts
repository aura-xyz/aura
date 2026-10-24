import { describe, expect, it } from "vitest";
import type { MarketSkillView, SkillView } from "./api";
import {
  canDelete,
  deleteBlockedReason,
  enabledCount,
  filterMarket,
  groupSkills,
  SOURCE_LABEL,
  toolsLabel,
} from "./skill";

function skill(partial: Partial<SkillView> & Pick<SkillView, "name" | "source">): SkillView {
  return {
    description: "说明",
    version: "0.1.0",
    allowed_tools: [],
    enabled: true,
    dir: `E:/skills/${partial.name}`,
    path: `E:/skills/${partial.name}/SKILL.md`,
    ...partial,
  };
}

const BUILTIN = skill({ name: "code-explainer", source: "builtin" });
const LOCAL = skill({ name: "my-helper", source: "local", enabled: false });
const WORKSPACE = skill({ name: "ws-skill", source: "workspace" });
const MARKET = skill({ name: "market-skill", source: "market" });

describe("groupSkills", () => {
  it("内置单独一组，其余都算已安装", () => {
    const g = groupSkills([BUILTIN, LOCAL, WORKSPACE, MARKET]);
    expect(g.builtin.map((s) => s.name)).toEqual(["code-explainer"]);
    expect(g.installed.map((s) => s.name)).toEqual([
      "my-helper",
      "ws-skill",
      "market-skill",
    ]);
  });

  it("保持后端给的顺序，不重排", () => {
    const a = skill({ name: "z-last", source: "local" });
    const b = skill({ name: "a-first", source: "local" });
    expect(groupSkills([a, b]).installed.map((s) => s.name)).toEqual([
      "z-last",
      "a-first",
    ]);
  });

  it("空列表两组都为空", () => {
    const g = groupSkills([]);
    expect(g.builtin).toEqual([]);
    expect(g.installed).toEqual([]);
  });
});

describe("toolsLabel", () => {
  it("有白名单时逐一列出", () => {
    expect(toolsLabel({ allowed_tools: ["read_file", "list_files"] })).toBe(
      "read_file、list_files",
    );
  });

  /// 空白名单 = 继承模式权限。若显示成空白，用户会读成「不能用任何工具」，
  /// 与事实恰好相反。
  it("空白名单要说清是继承权限，而不是留空", () => {
    expect(toolsLabel({ allowed_tools: [] })).toBe("不限工具（继承模式权限）");
  });
});

describe("删除策略", () => {
  it("只有本地与市场技能可删", () => {
    expect(canDelete("local")).toBe(true);
    expect(canDelete("market")).toBe(true);
    expect(canDelete("builtin")).toBe(false);
    expect(canDelete("workspace")).toBe(false);
  });

  it("不可删的来源各有原因，可删的没有原因", () => {
    expect(deleteBlockedReason("builtin")).toContain("禁用");
    expect(deleteBlockedReason("workspace")).toContain(".agents/skills");
    expect(deleteBlockedReason("local")).toBe("");
    expect(deleteBlockedReason("market")).toBe("");
  });
});

describe("杂项", () => {
  it("来源角标四种齐全", () => {
    expect(Object.keys(SOURCE_LABEL).sort()).toEqual([
      "builtin",
      "local",
      "market",
      "workspace",
    ]);
  });

  it("已启用计数", () => {
    expect(enabledCount([BUILTIN, LOCAL, WORKSPACE])).toBe(2);
    expect(enabledCount([])).toBe(0);
  });
});

describe("filterMarket", () => {
  const items: MarketSkillView[] = [
    {
      id: "mcp-builder",
      name: "MCP 服务器构建",
      description: "指导构建兼容 MCP 协议的服务器",
      version: "1.0.0",
      tags: ["development", "mcp"],
      author: "anthropics",
      installed: false,
    },
    {
      id: "code-review",
      name: "代码审查",
      description: "按清单逐条审查变更",
      version: "0.2.0",
      tags: ["review"],
      author: "aura",
      installed: true,
    },
  ];

  it("空查询原样返回（同一个引用，不白建数组）", () => {
    expect(filterMarket(items, "")).toBe(items);
    expect(filterMarket(items, "   ")).toBe(items);
  });

  it("名称、id、说明、标签都能命中", () => {
    expect(filterMarket(items, "MCP").map((m) => m.id)).toEqual(["mcp-builder"]);
    expect(filterMarket(items, "code-rev").map((m) => m.id)).toEqual(["code-review"]);
    // 只出现在说明里
    expect(filterMarket(items, "逐条").map((m) => m.id)).toEqual(["code-review"]);
    // 只出现在标签里
    expect(filterMarket(items, "development").map((m) => m.id)).toEqual([
      "mcp-builder",
    ]);
  });

  it("大小写不敏感，无匹配返回空", () => {
    expect(filterMarket(items, "MCP").length).toBe(1);
    expect(filterMarket(items, "mcp").length).toBe(1);
    expect(filterMarket(items, "zzz")).toEqual([]);
  });
});
