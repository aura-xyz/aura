import { describe, expect, it } from "vitest";
import {
  MCP_STATUS_META,
  capabilityDomains,
  commandSummary,
  defaultPolicy,
  policyLabel,
  envToText,
  parseEnv,
  resourceLabel,
  toLines,
  mcpPromptCommandId,
  mcpPromptCommandItems,
  promptPlainText,
  type McpCapabilities,
  type McpPromptItemView,
  type McpResourceView,
} from "./mcp";

function caps(over: Partial<McpCapabilities> = {}): McpCapabilities {
  return {
    protocol_version: "2025-06-18",
    server_name: "",
    server_version: "",
    tools: false,
    tools_list_changed: false,
    resources: false,
    resources_subscribe: false,
    prompts: false,
    prompts_list_changed: false,
    ...over,
  };
}

describe("commandSummary", () => {
  it("拼接命令与参数", () => {
    expect(commandSummary({ command: "npx", args: ["-y", "server"] })).toBe(
      "npx -y server",
    );
  });

  it("无参数只回命令", () => {
    expect(commandSummary({ command: "aura-mcp", args: [] })).toBe("aura-mcp");
  });
});

describe("parseEnv / envToText", () => {
  it("解析 KEY=VALUE，忽略空行与注释", () => {
    const env = parseEnv("A=1\n\n# 注释\nB = two words \n坏行\n=C");
    expect(env).toEqual({ A: "1", B: "two words" });
  });

  it("往返保持一致", () => {
    const env = parseEnv("TOKEN=abc\nX=1");
    expect(parseEnv(envToText(env))).toEqual(env);
  });
});

describe("toLines", () => {
  it("按行切分并去掉空行与首尾空白", () => {
    expect(toLines(" a \n\n b \r\n")).toEqual(["a", "b"]);
  });
});

describe("MCP_STATUS_META", () => {
  it("四态各有标签与颜色点", () => {
    for (const status of ["running", "connecting", "down", "disabled"] as const) {
      const meta = MCP_STATUS_META[status];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.dot.startsWith("bg-")).toBe(true);
    }
  });
});

describe("MCP 策略默认值（M2-08）", () => {
  it("默认严格、不自动重连、串行、50 上限", () => {
    expect(defaultPolicy()).toEqual({
      trust_level: "strict",
      auto_reconnect: false,
      tool_limit: 50,
      concurrent: false,
    });
  });

  it("只有显式 trusted 才显示已信任", () => {
    expect(policyLabel(defaultPolicy())).toBe("严格");
    expect(policyLabel({ ...defaultPolicy(), trust_level: "trusted" })).toBe(
      "已信任",
    );
    expect(policyLabel({ ...defaultPolicy(), trust_level: "admin" })).toBe("严格");
    expect(policyLabel(undefined)).toBe("严格");
  });
});

describe("resourceLabel（M2-04）", () => {
  const base: McpResourceView = {
    uri: "file:///workspace/src/a.txt",
    name: "",
    description: "",
    mime_type: null,
    template: false,
  };

  it("服务器给了 name 就优先用", () => {
    expect(resourceLabel({ ...base, name: "项目说明" })).toBe("项目说明");
  });

  it("没有 name 时回退到 URI 尾段", () => {
    expect(resourceLabel(base)).toBe("a.txt");
  });
});

describe("MCP 提示词契约（M2-06）", () => {
  const p: McpPromptItemView = {
    server_id: 3,
    server_name: "fs",
    name: "review",
    description: "代码评审",
    arguments: [{ name: "path", description: "路径", required: true }],
  };

  it("单条消息不带角色前缀，多条带角色", () => {
    expect(promptPlainText([{ role: "user", text: "正文" }])).toBe("正文");
    expect(
      promptPlainText([
        { role: "system", text: "规则" },
        { role: "user", text: "问题" },
      ]),
    ).toBe("[system] 规则\n\n[user] 问题");
  });

  it("命令 id 带服务器 id，避免跨服重名", () => {
    expect(mcpPromptCommandId(p)).toBe("mcp-prompt:3:review");
    expect(mcpPromptCommandId({ ...p, server_id: 9 })).toBe(
      "mcp-prompt:9:review",
    );
  });

  it("候选项按名称 / 服务器 / 说明过滤", () => {
    expect(mcpPromptCommandItems([p], "")[0].label).toBe("mcp:fs/review");
    expect(mcpPromptCommandItems([p], "FIRST")).toHaveLength(0);
    expect(mcpPromptCommandItems([p], "fs")).toHaveLength(1);
    expect(mcpPromptCommandItems([p], "评审")).toHaveLength(1);
    expect(mcpPromptCommandItems([p], "review")[0].group).toBe("skill");
  });
});

describe("capabilityDomains（M2-02）", () => {
  it("三个域固定顺序，未声明的域也返回并标为关", () => {
    expect(capabilityDomains(caps({ tools: true }))).toEqual([
      { label: "tools", on: true },
      { label: "resources", on: false },
      { label: "prompts", on: false },
    ]);
  });

  it("全声明时三个都为开", () => {
    expect(
      capabilityDomains(caps({ tools: true, resources: true, prompts: true })).every(
        (d) => d.on,
      ),
    ).toBe(true);
  });

  it("快照缺失时不抛错，全部置灰", () => {
    expect(capabilityDomains(null).every((d) => !d.on)).toBe(true);
  });
});
