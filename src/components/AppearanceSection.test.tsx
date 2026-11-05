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
    resetFontSizes: vi.fn(),
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

  it("恢复默认字号按钮走统一的 reset 入口", () => {
    const t = api();
    render(<AppearanceSection theme={t} />);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认字号" }));
    expect(t.resetFontSizes).toHaveBeenCalledTimes(1);
  });

  it("当前档位用 aria-pressed 标出来", () => {
    const t = api({ theme: "system" });
    render(<AppearanceSection theme={t} />);
    expect(
      screen.getByRole("button", { name: "跟随系统" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("输入框 Markdown 实时渲染开关可关闭并持久化", () => {
    const t = api();
    render(<AppearanceSection theme={t} />);
    const toggle = screen.getByRole("switch", {
      name: "输入框 Markdown 实时渲染",
    });
    const before = toggle.getAttribute("aria-checked");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).not.toBe(before);
    // 再点回来，避免测试之间把默认开启的状态改脏
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe(before);
  });
});
