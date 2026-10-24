import { describe, expect, it } from "vitest";
import type { AuditFinding, MarketSkillView, SkillView } from "./api";
import {
  auditCounts,
  auditHeadline,
  canDelete,
  canUpdate,
  deleteBlockedReason,
  enabledCount,
  filterMarket,
  formatBytes,
  groupFindings,
  groupSkills,
  permissionLines,
  SEVERITY_LABEL,
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
      registry: "官方",
      installed: false,
      installed_version: "",
    },
    {
      id: "code-review",
      name: "代码审查",
      description: "按清单逐条审查变更",
      version: "0.2.0",
      tags: ["review"],
      author: "aura",
      registry: "官方",
      installed: true,
      installed_version: "0.2.0",
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

describe("审查报告", () => {
  function finding(
    partial: Partial<AuditFinding> & Pick<AuditFinding, "severity" | "rule">,
  ): AuditFinding {
    return {
      file: "SKILL.md",
      line: 5,
      note: `${partial.rule} 的说明`,
      excerpt: "",
      ...partial,
    };
  }

  it("按严重度计数", () => {
    const counts = auditCounts({
      findings: [
        finding({ severity: "high", rule: "rm_rf" }),
        finding({ severity: "high", rule: "ssh_private_key" }),
        finding({ severity: "medium", rule: "sudo" }),
        finding({ severity: "info", rule: "ignore_previous" }),
      ],
    });
    expect(counts).toEqual({ high: 2, medium: 1, info: 1 });
    expect(auditCounts({ findings: [] })).toEqual({ high: 0, medium: 0, info: 0 });
  });

  it("高危排前面，同级保持后端顺序（文件+行号）", () => {
    const info = finding({ severity: "info", rule: "i", line: 1 });
    const high = finding({ severity: "high", rule: "h", line: 9 });
    const medium = finding({ severity: "medium", rule: "m", line: 3 });
    const high2 = finding({ severity: "high", rule: "h2", line: 2 });
    expect(groupFindings([info, high, medium, high2]).map((f) => f.rule)).toEqual([
      "h",
      "h2",
      "m",
      "i",
    ]);
  });

  it("摘要文案随最高严重度变化", () => {
    expect(auditHeadline({ high: 2, medium: 0, info: 0 })).toContain("2 条高危");
    expect(auditHeadline({ high: 0, medium: 1, info: 3 })).toContain("1 条需注意");
    expect(auditHeadline({ high: 0, medium: 0, info: 2 })).toContain("仅有提示");
    expect(auditHeadline({ high: 0, medium: 0, info: 0 })).toContain("未发现可疑");
  });

  it("权限说明：空工具范围要写清楚是「不限」", () => {
    expect(permissionLines([], false)).toEqual([
      "工具范围：不限（完全继承当前会话模式的权限）",
    ]);
    const withScript = permissionLines(["read_file", "run_script"], true);
    expect(withScript[0]).toContain("read_file、run_script");
    expect(withScript[1]).toContain("可执行脚本");
  });

  it("严重度文案齐全", () => {
    expect(SEVERITY_LABEL).toEqual({ high: "高危", medium: "注意", info: "提示" });
  });
});

describe("canUpdate", () => {
  const base: MarketSkillView = {
    id: "x",
    name: "X",
    description: "",
    version: "2.0.0",
    tags: [],
    author: "",
    registry: "官方",
    installed: true,
    installed_version: "1.0.0",
  };

  it("已安装且版本不同才提示更新", () => {
    expect(canUpdate(base)).toBe(true);
  });

  it("未安装不给更新", () => {
    expect(canUpdate({ ...base, installed: false })).toBe(false);
  });

  it("版本读不出（空串）时不给更新，避免每次刷新都提示", () => {
    expect(canUpdate({ ...base, installed_version: "" })).toBe(false);
    expect(canUpdate({ ...base, version: "" })).toBe(false);
  });

  it("版本相同不提示", () => {
    expect(canUpdate({ ...base, installed_version: "2.0.0" })).toBe(false);
  });
});

describe("formatBytes", () => {
  it("按量级切换单位", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
