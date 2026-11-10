/**
 * 上下文水位（v0.8.0）。
 *
 * 分子取**上一轮请求实际送出的 input token**，而不是会话累计：上下文占用
 * 看的是「这次发出去多大一包」，累计值会一路涨到超过窗口上限，水位条就失去意义。
 * 分母是模型目录里的 `context_limit`（后端已提供，前端不再另维护一份常量表，
 * 免得两边对不上）。任一值缺失就返回 null，界面据此隐藏水位条而不是画个假条。
 */

/** 警示线：到 70% 提示归档，90% 强提示新开会话。 */
export const WATER_WARN = 0.7;
export const WATER_CRIT = 0.9;

export type WaterStage = "ok" | "warn" | "crit";

export interface WaterLevel {
  /** 0–1，已按上限裁剪 */
  ratio: number;
  /** 百分比整数，用于展示 */
  percent: number;
  stage: WaterStage;
}

export function waterLevel(
  usedTokens: number | null | undefined,
  contextLimit: number | null | undefined,
): WaterLevel | null {
  if (typeof usedTokens !== "number" || usedTokens <= 0) return null;
  if (typeof contextLimit !== "number" || contextLimit <= 0) return null;
  const ratio = Math.min(usedTokens / contextLimit, 1);
  const stage: WaterStage =
    ratio >= WATER_CRIT ? "crit" : ratio >= WATER_WARN ? "warn" : "ok";
  return { ratio, percent: Math.round(ratio * 100), stage };
}

/** 水位条右侧的提示文案；`ok` 也有话可说（剩余空间），不返回空串。 */
export function waterHint(level: WaterLevel): string {
  if (level.stage === "crit") {
    return "上下文即将占满，建议新开会话或 /export 归档后继续";
  }
  if (level.stage === "warn") {
    return "上下文已用七成，必要时可 /export 归档或新开会话";
  }
  return "上下文占用";
}

/** 占满 / 溢出线（v0.8.1 P13）。到这一档必须硬拦截发送，不能静默失败。 */
export const WATER_FULL = 1;

/**
 * 真实溢出判定。
 *
 * `WaterLevel.ratio` 被 `Math.min(..., 1)` 裁剪过，用 `ratio >= 1` 会把
 * 「刚好 100%」和「早就超了 3 倍」混为一谈；这里直接比原始数值。
 */
export function waterOverflow(
  usedTokens: number | null | undefined,
  contextLimit: number | null | undefined,
): boolean {
  if (typeof usedTokens !== "number" || usedTokens <= 0) return false;
  if (typeof contextLimit !== "number" || contextLimit <= 0) return false;
  return usedTokens >= contextLimit;
}

export type WaterAdviceStage = "none" | "warn" | "crit" | "full";

export interface WaterAdvice {
  stage: WaterAdviceStage;
  text: string;
  /** 是否展示「压缩历史 / 新开会话」动作 */
  showActions: boolean;
}

/** 把水位转换成一条可执行的建议（v0.8.1 P13）。 */
export function waterAdvice(
  level: WaterLevel | null,
  overflow: boolean,
): WaterAdvice {
  if (overflow) {
    return {
      stage: "full",
      text: "上下文已占满，已暂停发送。请压缩历史或新开会话后继续。",
      showActions: true,
    };
  }
  if (!level) return { stage: "none", text: "", showActions: false };
  if (level.stage === "crit") {
    return { stage: "crit", text: waterHint(level), showActions: true };
  }
  if (level.stage === "warn") {
    return { stage: "warn", text: waterHint(level), showActions: false };
  }
  return { stage: "none", text: "", showActions: false };
}
