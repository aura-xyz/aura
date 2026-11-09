import type { OpenApp } from "./api";

/**
 * 菜单数据的兜底归一化。
 *
 * **平台默认项由后端保证在首位**（Windows 资源管理器 / Linux xdg-open），
 * 前端不再凭空注入——此前这里硬编码插入 `explorer`，导致 Linux 上首项变成
 * 一个打不开的「文件资源管理器」（后端没有该 id，点击报「未安装该应用」）。
 *
 * 这里只做两件事：去重（保留首次出现）、丢弃空 id；顺序完全沿用后端。
 * 未知 id 保留，由渲染层用中性图标兜底。
 */
export function normalizeOpenApps(apps: OpenApp[]): OpenApp[] {
  const seen = new Set<string>();
  const result: OpenApp[] = [];
  for (const app of apps) {
    if (!app.id || seen.has(app.id)) continue;
    seen.add(app.id);
    result.push(app);
  }
  return result;
}
