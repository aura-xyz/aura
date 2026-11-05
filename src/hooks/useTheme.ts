import { useCallback, useEffect, useState } from "react";
import {
  type ThemeSettings,
  type ThemePreference,
  type FontRole,
  clampFontSize,
  fontSizeField,
  loadTheme,
  DEFAULT_THEME,
  resolvedFontSizeVariable,
  saveTheme,
} from "../lib/theme";

/** 主题偏好三档；`resolved` 才是实际生效的亮/暗。 */
export type Theme = ThemePreference;

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function initialTheme(): Theme {
  return loadTheme().preference;
}

/**
 * 单一状态源：settings 变化后由 effect 统一投影到 DOM。
 *
 * 旧实现把 theme 与三个字号拆成四份 useState，且 update 闭包捕获的是渲染时的
 * settings —— 连点两次设置就会写回旧值。跟随系统还要监听 media query，
 * 否则系统切换主题时应用不会跟着变。
 */
export function useTheme() {
  const [settings, setSettings] = useState<ThemeSettings>(() => loadTheme());
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const resolved: "light" | "dark" =
    settings.preference === "system"
      ? systemDark
        ? "dark"
        : "light"
      : settings.preference;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const update = useCallback((next: ThemePreference) => {
    setSettings((prev) => {
      const nextSettings = { ...prev, preference: next };
      saveTheme(nextSettings);
      return nextSettings;
    });
  }, []);

  const updateFont = useCallback((role: FontRole, px: number) => {
    setSettings((prev) => {
      const value = clampFontSize(px);
      const nextSettings: ThemeSettings =
        role === "text"
          ? { ...prev, fontSize: value }
          : role === "code"
            ? { ...prev, codeFontSize: value }
            : { ...prev, terminalFontSize: value };
      saveTheme(nextSettings);
      return nextSettings;
    });
  }, []);

  const resetFontSizes = useCallback(() => {
    setSettings((prev) => {
      const nextSettings: ThemeSettings = {
        ...prev,
        fontSize: DEFAULT_THEME.fontSize,
        codeFontSize: DEFAULT_THEME.codeFontSize,
        terminalFontSize: DEFAULT_THEME.terminalFontSize,
      };
      saveTheme(nextSettings);
      return nextSettings;
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
    // 与 dsh theme-presenter 一致，供将来原生标题栏跟随主题
    root.dataset.dsThemeSource = settings.preference;
    const body = document.body;
    for (const role of ["text", "code", "terminal"] as const) {
      const value = settings[fontSizeField(role)];
      body.style.setProperty(resolvedFontSizeVariable(role), `${value}px`);
    }
  }, [resolved, settings]);

  return {
    theme: settings.preference,
    resolved,
    setTheme: update,
    fontSize: settings.fontSize,
    codeFontSize: settings.codeFontSize,
    terminalFontSize: settings.terminalFontSize,
    setFontSize: (px: number) => updateFont("text", px),
    setCodeFontSize: (px: number) => updateFont("code", px),
    setTerminalFontSize: (px: number) => updateFont("terminal", px),
    resetFontSizes,
  };
}
