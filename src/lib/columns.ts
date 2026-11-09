/**
 * 三栏几何（v0.8.0，参照 dsh ui-layout/columns.ts）。
 *
 * 规则：中栏有保底宽度，右栏先让位；左栏只按用户拖拽的宽度取值，
 * 不参与挤压。视口过窄时左栏自动收成图标轨，由 App 决定。
 * 纯函数，不碰 DOM，便于单测钉住边界。
 */
export const SIDEBAR_DEFAULT = 256;
export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_COLLAPSED = 56;
export const SIDEBAR_AUTO_COLLAPSE = 1024;

export const RIGHTBAR_DEFAULT = 440;
export const RIGHTBAR_MIN = 320;
export const RIGHTBAR_MAX_RATIO = 0.7;

export const CENTER_MIN = 400;

export interface Columns {
  sidebar: number;
  center: number;
  rightbar: number;
}

export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/**
 * 右栏的默认宽度（v0.8.1）。
 *
 * 固定 320px 时，网页与终端在 1080p 屏上都窄到不可用：百度这类按桌面布局
 * 排版的站点会被横向裁掉，终端一行放不下 60 列。改成按视口比例取值——
 * 屏幕够宽就多给，屏幕窄时才退回最小值。
 *
 * 上下限的作用不同：下限 360 保证「一打开就能用」，上限 640 防止超宽屏
 * 把对话区挤成一条缝（对话才是主战场）。
 */
export function rightbarDefaultWidth(viewport: number): number {
  return clampWidth(viewport * 0.32, 360, 640);
}

/**
 * 求三栏实际宽度。
 *
 * @param viewport 可用视口宽度（px）
 * @param sidebarPref 用户拖出来的左栏宽度
 * @param rightbarPref 用户拖出来的右栏宽度
 * @param sidebarCollapsed 左栏是否收成图标轨
 * @param rightbarShown 右栏是否占位
 *
 * 右栏轨道为 0 时由 App 以覆盖层呈现，中栏因此始终不低于 CENTER_MIN
 * （除非视口本身连左栏 + 中栏都放不下）。
 */
export function computeColumns(
  viewport: number,
  sidebarPref: number,
  rightbarPref: number,
  sidebarCollapsed: boolean,
  rightbarShown: boolean,
): Columns {
  const sidebar = sidebarCollapsed
    ? SIDEBAR_COLLAPSED
    : clampWidth(sidebarPref, SIDEBAR_MIN, SIDEBAR_MAX);
  const available = viewport - sidebar - CENTER_MIN;
  const rightbar =
    !rightbarShown || available < RIGHTBAR_MIN
      ? 0
      : Math.min(
          available,
          clampWidth(rightbarPref, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO),
        );
  return {
    sidebar,
    center: Math.max(0, viewport - sidebar - rightbar),
    rightbar,
  };
}
