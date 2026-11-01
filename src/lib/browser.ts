/**
 * 内置浏览器地址归一化（v0.8.0）。
 *
 * 用户输入可能是完整 URL、裸域名（`example.com`）或搜索词。
 * 这层只做纯字符串决策，便于单测；真正的加载由面板负责。
 */

/** 形如 `example.com`、`sub.example.co.uk` 的裸域名（可带路径/查询/锚点）。 */
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+([/?#].*)?$/i;

/**
 * 把地址栏输入归一化成一个可加载的 URL。
 *
 * - 已带 `http(s)://` 原样返回
 * - 裸域名补 `https://`
 * - 其余当作搜索词，交给搜索引擎
 * - 空输入返回空串（调用方据此忽略）
 *
 * @param input - 地址栏原始输入
 * @returns 归一化后的 URL，或空串
 */
export function normalizeBrowserUrl(input: string): string {
  const t = input.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (!/\s/.test(t) && BARE_DOMAIN.test(t)) {
    return `https://${t}`;
  }
  return `https://www.bing.com/search?q=${encodeURIComponent(t)}`;
}
