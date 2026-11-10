/**
 * 文件图标的分类与排序（v0.8.0，右栏文件面板用）。
 *
 * 抽成纯函数：扩展名映射最容易被后来的「顺手加一条」搞乱，
 * 排序规则（目录恒在前）也只有纯函数能干净地钉住。
 */
import type { DirEntry } from "./api";

/** 图标档次。颜色与图标都由调用方按档位取，这里只管分类。 */
export type FileKind = "markdown" | "code" | "data" | "image" | "style" | "text";

const CODE = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go", "java", "kt",
  "c", "h", "cpp", "hpp", "cs", "rb", "php", "swift", "sh", "bash", "ps1",
  "sql", "lua", "toml",
]);
const DATA = new Set(["json", "jsonc", "yaml", "yml", "csv", "tsv", "lock"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);
const STYLE = new Set(["css", "scss", "sass", "less", "html", "htm", "vue", "svelte"]);

/** 取扩展名（小写，不含点）；无扩展名返回空串。 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  // 以点开头的隐藏文件（.gitignore）不算有扩展名
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function fileKindOf(name: string): FileKind {
  const ext = extensionOf(name);
  if (ext === "md" || ext === "mdx") return "markdown";
  if (CODE.has(ext)) return "code";
  if (DATA.has(ext)) return "data";
  if (IMAGE.has(ext)) return "image";
  if (STYLE.has(ext)) return "style";
  return "text";
}

/**
 * 档位 → 图标颜色（低饱和，取语义色的 80% 权重）。
 * 比 mono 灰更容易扫读，又不至于把面板变成调色板。
 */
export const FILE_KIND_TINT: Record<FileKind, string> = {
  markdown: "text-brand",
  code: "text-link",
  data: "text-warning",
  image: "text-success",
  style: "text-danger",
  text: "text-subtle",
};

/**
 * 目录恒在前，其次按名称排序。
 *
 * 后端返回的顺序不保证（不同平台 readdir 顺序不同），面板自己定序，
 * 用户每次打开同一个目录看到的是同一份顺序。
 */
export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });
  });
}
