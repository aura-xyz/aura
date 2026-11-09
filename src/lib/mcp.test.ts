import { describe, expect, it } from "vitest";
import {
  DEMO_SERVERS,
  MCP_STATUS_META,
  commandSummary,
  type McpServerView,
} from "./mcp";

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

describe("MCP_STATUS_META", () => {
  it("三态各有标签与颜色点", () => {
    for (const status of ["connected", "disconnected", "error"] as const) {
      const meta = MCP_STATUS_META[status];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.dot.startsWith("bg-")).toBe(true);
    }
  });
});

describe("DEMO_SERVERS", () => {
  it("示例数据满足视图契约（id 唯一、transport 为 stdio）", () => {
    const ids = new Set<string>();
    for (const s of DEMO_SERVERS as McpServerView[]) {
      expect(s.transport).toBe("stdio");
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
  });
});
