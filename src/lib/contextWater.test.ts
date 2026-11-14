import { describe, expect, it } from "vitest";
import {
  WATER_CRIT,
  WATER_FULL,
  WATER_WARN,
  waterAdvice,
  waterHint,
  waterLevel,
  waterOverflow,
} from "./contextWater";

describe("waterLevel", () => {
  it("任一值缺失就不给水位（界面据此隐藏，不画假条）", () => {
    expect(waterLevel(null, 128000)).toBeNull();
    expect(waterLevel(1000, null)).toBeNull();
    expect(waterLevel(undefined, undefined)).toBeNull();
    expect(waterLevel(0, 128000)).toBeNull();
    expect(waterLevel(1000, 0)).toBeNull();
  });

  it("按阈值分三档", () => {
    expect(waterLevel(1000, 10000)?.stage).toBe("ok");
    expect(waterLevel(WATER_WARN * 10000, 10000)?.stage).toBe("warn");
    expect(waterLevel(WATER_CRIT * 10000, 10000)?.stage).toBe("crit");
    expect(waterLevel(9500, 10000)?.percent).toBe(95);
  });

  /// 上游偶尔会报出超过窗口的数字（含预留 token），条不能画到 120%
  it("超过上限按 100% 计", () => {
    const level = waterLevel(20000, 10000);
    expect(level?.ratio).toBe(1);
    expect(level?.percent).toBe(100);
  });
});

describe("waterHint", () => {
  it("三档各给不同建议", () => {
    const ok = waterLevel(1000, 10000)!;
    const warn = waterLevel(8000, 10000)!;
    const crit = waterLevel(9500, 10000)!;
    expect(waterHint(ok)).toBe("上下文占用");
    expect(waterHint(warn)).toContain("/export");
    expect(waterHint(crit)).toContain("新开会话");
    expect(waterHint(crit)).not.toBe(waterHint(warn));
  });
});

describe("上下文阈值预警（v0.8.1 P13）", () => {
  it("waterOverflow 用原始值判断，不被裁剪后的 ratio 骗过", () => {
    expect(WATER_FULL).toBe(1);
    expect(waterOverflow(9999, 10000)).toBe(false);
    expect(waterOverflow(10000, 10000)).toBe(true);
    expect(waterOverflow(30000, 10000)).toBe(true);
    // 数据缺失时不该误判为溢出并拦下发送
    expect(waterOverflow(null, 10000)).toBe(false);
    expect(waterOverflow(10000, undefined)).toBe(false);
    expect(waterOverflow(10000, 0)).toBe(false);
  });

  it("70% 只给提示、90% 给动作、100% 变成硬拦截", () => {
    const warn = waterLevel(7500, 10000)!;
    const crit = waterLevel(9500, 10000)!;
    const full = waterLevel(10000, 10000)!;

    expect(waterAdvice(warn, false)).toMatchObject({
      stage: "warn",
      showActions: false,
    });
    expect(waterAdvice(crit, false)).toMatchObject({
      stage: "crit",
      showActions: true,
    });
    const blocked = waterAdvice(full, true);
    expect(blocked.stage).toBe("full");
    expect(blocked.showActions).toBe(true);
    expect(blocked.text).toContain("已暂停发送");
  });

  it("没有水位数据时不给建议", () => {
    expect(waterAdvice(null, false).stage).toBe("none");
  });
});
