/**
 * 模型牌价与成本估算（v0.8.0）。
 *
 * 单价取自各厂商官网公开价（美元 / 百万 token，2026-11 快照）。这是**估算**：
 * 实际账单受缓存命中、批量折扣、阶梯定价影响，界面上必须标明口径。
 *
 * 匹配用模型 id 的子串：各厂商的写法五花八门（`gpt-4o-2024-08-06`、
 * `claude-3-5-sonnet-20241022`），精确相等匹配不到几条。
 */
export interface ModelPrice {
  /** 每百万输入 token 的美元价 */
  input: number;
  /** 每百万输出 token 的美元价 */
  output: number;
  /** 牌价对应的模型族，用于界面标注 */
  family: string;
}

const PRICES: { match: RegExp; price: ModelPrice }[] = [
  { match: /gpt-4o-mini/i, price: { input: 0.15, output: 0.6, family: "GPT-4o mini" } },
  { match: /gpt-4o/i, price: { input: 2.5, output: 10, family: "GPT-4o" } },
  { match: /gpt-4\.1-mini/i, price: { input: 0.4, output: 1.6, family: "GPT-4.1 mini" } },
  { match: /gpt-4\.1/i, price: { input: 2, output: 8, family: "GPT-4.1" } },
  { match: /claude.*opus/i, price: { input: 15, output: 75, family: "Claude Opus" } },
  { match: /claude.*haiku/i, price: { input: 0.8, output: 4, family: "Claude Haiku" } },
  { match: /claude/i, price: { input: 3, output: 15, family: "Claude Sonnet" } },
  { match: /deepseek-reasoner/i, price: { input: 0.55, output: 2.19, family: "DeepSeek Reasoner" } },
  { match: /deepseek/i, price: { input: 0.28, output: 0.42, family: "DeepSeek Chat" } },
  { match: /gemini-1\.5-pro/i, price: { input: 1.25, output: 5, family: "Gemini 1.5 Pro" } },
  { match: /gemini/i, price: { input: 0.3, output: 1.2, family: "Gemini" } },
];

/** 查牌价；查不到返回 null（界面显示「—」，绝不编一个数字）。 */
export function priceOf(model: string): ModelPrice | null {
  if (!model) return null;
  for (const entry of PRICES) {
    if (entry.match.test(model)) return entry.price;
  }
  return null;
}

/** 估算成本（美元）。任一参数缺失就无法算，返回 null。 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = priceOf(model);
  if (!price) return null;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

/** 成本展示：小额保留 4 位，避免一行全是「$0.00」。 */
export function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}
