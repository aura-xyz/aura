import { useCallback, useEffect, useState } from "react";
import { type ThemeSettings, type ThemePreference, loadTheme, saveTheme, resolveTheme } from "../lib/theme";

const STORAGE_KEY = "aura-theme";

export type Theme = "light" | "dark";

export function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "dark" ? "dark" : "light";
}

export function useTheme() {
  const settings = loadTheme();
  const [theme, setTheme] = useState<Theme>(resolveTheme(settings.preference));
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [codeFontSize, setCodeFontSize] = useState(settings.codeFontSize);
  const [terminalFontSize, setTerminalFontSize] = useState(settings.terminalFontSize);

  const update = useCallback((next: ThemePreference) => {
    const nextSettings: ThemeSettings = {
      ...settings,
      preference: next,
    };
    saveTheme(nextSettings);
    setTheme(resolveTheme(next));
  }, [settings]);

  const updateFont = useCallback((role: "text" | "code" | "terminal", px: number) => {
    const nextSettings: ThemeSettings = { ...settings };
    if (role === "text") nextSettings.fontSize = px;
    if (role === "code") nextSettings.codeFontSize = px;
    if (role === "terminal") nextSettings.terminalFontSize = px;
    saveTheme(nextSettings);
    if (role === "text") setFontSize(px);
    if (role === "code") setCodeFontSize(px);
    if (role === "terminal") setTerminalFontSize(px);
  }, [settings]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    document.body.style.setProperty("--dsh-content-font-size", `${fontSize}px`);
    document.body.style.setProperty("--dsh-code-font-size", `${codeFontSize}px`);
    document.body.style.setProperty("--dsh-terminal-font-size", `${terminalFontSize}px`);
  }, [theme, fontSize, codeFontSize, terminalFontSize]);

  return {
    theme: settings.preference,
    resolved: theme,
    setTheme: update,
    fontSize,
    codeFontSize,
    terminalFontSize,
    setFontSize: (px: number) => updateFont("text", px),
    setCodeFontSize: (px: number) => updateFont("code", px),
    setTerminalFontSize: (px: number) => updateFont("terminal", px),
  };
}
