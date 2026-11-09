import { describe, expect, it } from "vitest";
import { estimateCost, formatUsd, priceOf } from "./pricing";

describe("priceOf", () => {
  it("按模型族匹配，日期后缀不影响", () => {
    expect(priceOf("gpt-4o-2024-08-06")?.family).toBe("GPT-4o");
    expect(priceOf("claude-3-5-sonnet-20241022")?.family).toBe("Claude Sonnet");
    expect(priceOf("deepseek-chat")?.family).toBe("DeepSeek Chat");
    expect(priceOf("deepseek-reasoner")?.family).toBe("DeepSeek Reasoner");
  });

  /// 精确匹配会漏掉绝大多数真实 id，这里专门钉住"更具体的规则优先"
  it("更具体的规则优先于泛化规则", () => {
    expect(priceOf("gpt-4o-mini")?.family).toBe("GPT-4o mini");
    expect(priceOf("claude-3-opus")?.family).toBe("Claude Opus");
  });

  it("没有牌价的模型返回 null，不编数字", () => {
    expect(priceOf("my-local-llama")).toBeNull();
    expect(priceOf("")).toBeNull();
  });
});

describe("estimateCost", () => {
  it("按每百万 token 单价折算", () => {
    // gpt-4o：输入 2.5 / 输出 10 美元每百万
    const cost = estimateCost("gpt-4o", 1_000_000, 1_000_000);
    expect(cost).toBe(12.5);
    expect(estimateCost("gpt-4o", 1000, 1000)).toBeCloseTo(0.0125, 6);
  });

  it("无牌价时返回 null", () => {
    expect(estimateCost("unknown-model", 1000, 1000)).toBeNull();
  });
});

describe("formatUsd", () => {
  it("小额保留更多小数，避免一行全是 $0.00", () => {
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(0.5)).toBe("$0.500");
    expect(formatUsd(0.0012)).toBe("$0.0012");
  });
});
