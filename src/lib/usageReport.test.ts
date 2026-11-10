import { describe, expect, it } from "vitest";
import { usageCsv, usageRows } from "./usageReport";
import type { Session } from "../store";

function session(partial: Partial<Session> = {}): Session {
  return {
    id: "s1",
    title: "会话",
    workspace: "E:/dev/aura",
    messages: [],
    todos: [],
    ...partial,
  } as unknown as Session;
}

describe("usageRows", () => {
  it("有累计用量时给出输入/输出/总计/轮次，并折算成本", () => {
    const rows = usageRows(
      session({
        usageTotals: { input: 120_000, output: 30_000, total: 150_000, turns: 4 },
        llmMs: 65_000,
      }),
      "gpt-4o",
    );
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["输入"]).toBe("120,000 tokens");
    expect(byLabel["总计"]).toBe("150,000 tokens");
    expect(byLabel["轮次"]).toBe("4 轮");
    expect(byLabel["模型耗时"]).toBe("1m5s");
    // 0.12M*2.5 + 0.03M*10 = 0.3 + 0.3
    expect(byLabel["估算成本"]).toBe("$0.600");
    expect(rows.find((r) => r.label === "估算成本")?.note).toContain("牌价");
  });

  it("还没有真实用量时全是「—」，不编造数字", () => {
    const rows = usageRows(session(), "gpt-4o");
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["输入"]).toBe("—");
    expect(byLabel["估算成本"]).toBe("—");
    expect(rows.find((r) => r.label === "估算成本")?.note).toContain("还没有真实用量");
  });

  it("有用量但模型无牌价时成本显示「—」", () => {
    const rows = usageRows(
      session({ usageTotals: { input: 1000, output: 1000, total: 2000, turns: 1 } }),
      "my-local-llama",
    );
    expect(rows.find((r) => r.label === "估算成本")?.value).toBe("—");
    expect(rows.find((r) => r.label === "估算成本")?.note).toContain("没有公开牌价");
  });
});

describe("usageCsv", () => {
  it("带 BOM、表头与转义后的两列", () => {
    const csv = usageCsv(
      session({ usageTotals: { input: 1000, output: 500, total: 1500, turns: 1 } }),
      "gpt-4o",
    );
    expect(csv.startsWith("\ufeff")).toBe(true);
    // 首行前带 BOM（Excel 识别 UTF-8 用）
    expect(csv.split("\n")[0]).toBe("\ufeff项目,数值");
    expect(csv).toContain('"输入","1,000 tokens"');
  });
});
