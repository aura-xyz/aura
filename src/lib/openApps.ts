import type { OpenApp } from "./api";

/**
 * 菜单数据的兜底归一化：后端已保证资源管理器在首位，但列表来自
 * 本机探测，顺序和完整性不该由界面假设。默认项永远在第一位，
 * 重复 id 去掉，空 id 丢掉；未知 id 保留（用兜底图标显示）。
 */
export function normalizeOpenApps(apps: OpenApp[]): OpenApp[] {
  const seen = new Set<string>();
  const result: OpenApp[] = [];
  for (const app of apps) {
    if (!app.id || seen.has(app.id)) continue;
    seen.add(app.id);
    result.push(app);
  }
  const explorer: OpenApp =
    result.find((a) => a.id === "explorer") ?? {
      id: "explorer",
      name: "文件资源管理器",
    };
  return [explorer, ...result.filter((a) => a.id !== "explorer")];
}
