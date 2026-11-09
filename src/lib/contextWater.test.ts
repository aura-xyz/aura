import { describe, expect, it } from "vitest";
import { WATER_CRIT, WATER_WARN, waterHint, waterLevel } from "./contextWater";

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
