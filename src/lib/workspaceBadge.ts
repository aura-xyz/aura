/**
 * 折叠态工作区图标的显示规则（v0.8.0）。
 *
 * 折叠后只剩 56px 宽，一个圆点区分不了三个工作区——改成一枚首字方块。
 * 抽成纯函数是为了能钉住两件事：同一个工作区永远同一个颜色（不能随
 * 列表顺序漂移），以及首字在多字节字符上不能切坏。
 */

/** 低饱和底色档位，取自现有语义色的 10% tint，深浅两套主题自动适配。 */
const TINTS = [
  "bg-brand/10 text-brand",
  "bg-success/10 text-success",
  "bg-warning/10 text-warning",
  "bg-danger/10 text-danger",
  "bg-link/10 text-link",
] as const;

/** 工作区名首字（大写英文；中文原样）。 */
export function workspaceInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // Array.from 按码点切，emoji 与中文都不会被切成半个代理对
  return Array.from(trimmed)[0].toUpperCase();
}

/** 名称 → 稳定档位：同名同色，与列表顺序无关。 */
export function workspaceTint(name: string): string {
  let hash = 0;
  for (const ch of name) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return TINTS[hash % TINTS.length];
}
