/**
 * 主题状态（v0.8.0）。
 *
 * 支持 light / dark / system 三档，以及内容、代码、终端三角色的字体大小。
 * 语义色令牌统一用 --dsw-alias-* 前缀，与 dsh 的 ui-theme 包对齐，
 * 后续组件统一引用，避免颜色分散在各个组件里。
 */

export type ThemePreference = "light" | "dark" | "system";

export type FontRole = "text" | "code" | "terminal";

/** 强调色五档。`blue` 是默认值，与 v0.6.3 起的品牌色一致。 */
export type AccentId = "blue" | "purple" | "green" | "orange" | "pink";

export interface AccentPalette {
  /** 品牌锚点：发送按钮、进行中指示、选中竖线 */
  brand: string;
  link: string;
  /** 用户气泡底色（2 成 tint，v0.6.3 定的对比度下限） */
  bubbleUser: string;
}

/**
 * 强调色表：index.css 里的 `[data-accent]` 覆盖块必须与此同步
 * （contrast.test 会把这张表逐档过一遍 AA，CSS 则是实际渲染值）。
 */
export const ACCENTS: Record<
  AccentId,
  { label: string; light: AccentPalette; dark: AccentPalette }
> = {
  blue: {
    label: "蓝",
    light: { brand: "#0066cc", link: "#0066cc", bubbleUser: "#cce0f5" },
    dark: { brand: "#4da3ff", link: "#4da3ff", bubbleUser: "#233040" },
  },
  purple: {
    label: "紫",
    light: { brand: "#6b3fd4", link: "#6b3fd4", bubbleUser: "#e2dbf7" },
    dark: { brand: "#b39cff", link: "#b39cff", bubbleUser: "#2a2338" },
  },
  green: {
    label: "绿",
    light: { brand: "#1f7a45", link: "#1f7a45", bubbleUser: "#d6ebdf" },
    dark: { brand: "#4ade80", link: "#4ade80", bubbleUser: "#1f2a24" },
  },
  orange: {
    label: "橙",
    light: { brand: "#b25000", link: "#b25000", bubbleUser: "#fae0c9" },
    dark: { brand: "#ffb066", link: "#ffb066", bubbleUser: "#33261a" },
  },
  pink: {
    label: "粉",
    light: { brand: "#b8005e", link: "#b8005e", bubbleUser: "#fbd9e8" },
    dark: { brand: "#ff8fc0", link: "#ff8fc0", bubbleUser: "#331f28" },
  },
};

export const ACCENT_IDS: AccentId[] = ["blue", "purple", "green", "orange", "pink"];

/** 未知值一律回落到默认强调色，避免脏 localStorage 让界面失去主色。 */
export function normalizeAccent(value: unknown): AccentId {
  return typeof value === "string" && ACCENT_IDS.includes(value as AccentId)
    ? (value as AccentId)
    : "blue";
}

export interface ThemeSettings {
  preference: ThemePreference;
  /** 强调色（v0.8.0） */
  accent: AccentId;
  fontSize: number;        // 内容字体大小 (px)
  codeFontSize: number;    // 代码字体大小 (px)
  terminalFontSize: number; // 终端字体大小 (px)
}

export const DEFAULT_THEME: ThemeSettings = {
  preference: "system",
  accent: "blue",
  fontSize: 15,
  codeFontSize: 11,
  terminalFontSize: 13,
};

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 22;

const STORAGE_KEY = "aura-theme";

export function loadTheme(): ThemeSettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* localStorage 不可用时使用默认值 */
  }
  if (!raw) return { ...DEFAULT_THEME };
  try {
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return {
      ...DEFAULT_THEME,
      accent: normalizeAccent(parsed.accent),
      preference:
        parsed.preference === "light" || parsed.preference === "dark" || parsed.preference === "system"
          ? parsed.preference
          : DEFAULT_THEME.preference,
      fontSize: clampFontSize(parsed.fontSize ?? DEFAULT_THEME.fontSize),
      codeFontSize: clampFontSize(parsed.codeFontSize ?? DEFAULT_THEME.codeFontSize),
      terminalFontSize: clampFontSize(parsed.terminalFontSize ?? DEFAULT_THEME.terminalFontSize),
    };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function saveTheme(settings: ThemeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 忽略写入失败 */
  }
}

export function clampFontSize(px: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(px)));
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return preference;
}

/** useTheme 写入 body 的变量名。三角色名字不统一是历史遗留，别再靠拼字符串取。 */
export function resolvedFontSizeVariable(role: FontRole): string {
  switch (role) {
    case "text":
      return "--dsw-alias-font-size-content";
    case "code":
      return "--dsw-alias-font-size-code";
    case "terminal":
      return "--dsw-alias-font-size-terminal";
  }
}

/** 字号设置在 ThemeSettings 里对应的字段名。 */
export function fontSizeField(
  role: FontRole,
): "fontSize" | "codeFontSize" | "terminalFontSize" {
  switch (role) {
    case "text":
      return "fontSize";
    case "code":
      return "codeFontSize";
    case "terminal":
      return "terminalFontSize";
  }
}
