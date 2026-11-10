import { describe, expect, it } from "vitest";
import {
  MCP_STATUS_META,
  capabilityDomains,
  commandSummary,
  envToText,
  parseEnv,
  resourceLabel,
  toLines,
  type McpCapabilities,
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
