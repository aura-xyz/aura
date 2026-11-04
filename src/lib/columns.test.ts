import { describe, expect, it } from "vitest";
import {
  CENTER_MIN,
  RIGHTBAR_MIN,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_COLLAPSED,
  clampWidth,
  computeColumns,
} from "./columns";

describe("三栏几何", () => {
  it("宽视口下三栏共存，中栏不被挤到保底以下", () => {
    const c = computeColumns(1600, 256, 320, false, true);
    expect(c.sidebar).toBe(256);
    expect(c.rightbar).toBe(320);
    expect(c.center).toBeGreaterThanOrEqual(CENTER_MIN);
  });

  it("右栏同时受中栏保底与视口 70% 上限约束", () => {
    const wide = computeColumns(1600, 256, 5000, false, true);
    expect(wide.rightbar).toBeLessThanOrEqual(1600 * 0.7);

    const narrow = computeColumns(1000, 256, 900, false, true);
    expect(narrow.rightbar).toBe(1000 - 256 - CENTER_MIN);
    expect(narrow.center).toBeGreaterThanOrEqual(CENTER_MIN);
  });

  it("空间不足时右栏不占轨道，左栏按折叠宽度计算", () => {
    const c = computeColumns(700, 256, 320, true, true);
    expect(c.sidebar).toBe(SIDEBAR_COLLAPSED);
    expect(c.rightbar).toBe(0);
    expect(700).toBeLessThan(SIDEBAR_AUTO_COLLAPSE);
    expect(RIGHTBAR_MIN).toBeGreaterThan(0);
  });

  it("右栏关闭时中栏吃掉全部剩余宽度", () => {
    const c = computeColumns(1200, 300, 320, false, false);
    expect(c.rightbar).toBe(0);
    expect(c.center).toBe(900);
  });

  it("拖拽宽度被钳制在区间内", () => {
    expect(clampWidth(10, 220, 420)).toBe(220);
    expect(clampWidth(999, 220, 420)).toBe(420);
    expect(clampWidth(300, 220, 420)).toBe(300);
  });
});
