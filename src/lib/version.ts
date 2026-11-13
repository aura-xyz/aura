/**
 * 构建期注入的版本号（v0.8.1）。
 *
 * 由 `vite.config.ts` 的 `define` 从 `package.json` 读入，与打包产物同源，
 * 因此升版只需改 `package.json`（及 `tauri.conf.json` 等既有位置），
 * 不必再手工同步标题栏。
 *
 * 非打包环境没有注入（`define` 未生效）时退回 `dev`——
 * 宁可显示“未注入”，也不要冒出一个看起来像真版本号的假值。
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
