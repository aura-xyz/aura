import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppearanceSection from "./AppearanceSection";

type ThemeApi = ReturnType<typeof import("../hooks/useTheme").useTheme>;

function api(overrides: Partial<ThemeApi> = {}): ThemeApi {
  return {
    theme: "light",
    resolved: "light",
    setTheme: vi.fn(),
    fontSize: 15,
    codeFontSize: 11,
    terminalFontSize: 13,
    setFontSize: vi.fn(),
    setCodeFontSize: vi.fn(),
    setTerminalFontSize: vi.fn(),
    ...overrides,
  };
}

describe("外观设置", () => {
  it("主题三档都能选，跟随系统不是摆设", () => {
    const t = api();
    render(<AppearanceSection theme={t} />);
    fireEvent.click(screen.getByRole("button", { name: "跟随系统" }));
    expect(t.setTheme).toHaveBeenCalledWith("system");
    fireEvent.click(screen.getByRole("button", { name: "暗色" }));
    expect(t.setTheme).toHaveBeenCalledWith("dark");
    expect(screen.getByRole("button", { name: "亮色" })).toBeTruthy();
  });

  it("三角色字号各调到自己的 setter，互不串线", () => {
    const t = api();
    render(<AppearanceSection theme={t} />);
    fireEvent.change(screen.getByLabelText("正文字号"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("代码字号"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("终端字号"), { target: { value: "16" } });
    expect(t.setFontSize).toHaveBeenCalledWith(18);
    expect(t.setCodeFontSize).toHaveBeenCalledWith(14);
    expect(t.setTerminalFontSize).toHaveBeenCalledWith(16);
    expect(t.setFontSize).toHaveBeenCalledTimes(1);
  });

  it("当前档位用 aria-pressed 标出来", () => {
    const t = api({ theme: "system" });
    render(<AppearanceSection theme={t} />);
    expect(
      screen.getByRole("button", { name: "跟随系统" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
