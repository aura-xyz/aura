/**
 * 主题状态（v0.8.0）。
 *
 * 支持 light / dark / system 三档，以及内容、代码、终端三角色的字体大小。
 * 语义色令牌统一用 --dsw-alias-* 前缀，与 dsh 的 ui-theme 包对齐，
 * 后续组件统一引用，避免颜色分散在各个组件里。
 */

export type ThemePreference = "light" | "dark" | "system";

export type FontRole = "text" | "code" | "terminal";

export interface ThemeSettings {
  preference: ThemePreference;
  fontSize: number;        // 内容字体大小 (px)
  codeFontSize: number;    // 代码字体大小 (px)
  terminalFontSize: number; // 终端字体大小 (px)
}

export const DEFAULT_THEME: ThemeSettings = {
  preference: "system",
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
      return "--dsh-content-font-size";
    case "code":
      return "--dsh-code-font-size";
    case "terminal":
      return "--dsh-terminal-font-size";
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
