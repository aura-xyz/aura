import { describe, expect, it } from "vitest";
import { MCP_STATUS_META, commandSummary, envToText, parseEnv, toLines } from "./mcp";

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
