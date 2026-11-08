import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebBrowserPanel } from "./WebBrowserPanel";

const { openUrlMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...(args as [])),
}));

function go(raw: string) {
  const input = screen.getByLabelText("网址");
  fireEvent.change(input, { target: { value: raw } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("内置浏览器面板", () => {
  it("未输入网址时不渲染 iframe", () => {
    render(<WebBrowserPanel />);
    expect(screen.queryByTitle("内置浏览器")).toBeNull();
    expect(screen.getByText(/输入网址开始浏览/)).toBeInTheDocument();
  });

  /// 暗色下 bg-white 是一块刺眼的白板；背景必须跟 --surface 走。
  it("iframe 背景使用 surface 令牌而非硬编码白色", () => {
    render(<WebBrowserPanel />);
    go("example.com");

    const frame = screen.getByTitle("内置浏览器");
    expect(frame).toHaveAttribute("src", "https://example.com");
    expect(frame.className).toContain("bg-surface");
    expect(frame.className).not.toContain("bg-white");
  });

  it("加载完成前显示骨架屏，onLoad 后移除", () => {
    render(<WebBrowserPanel />);
    go("example.com");

    expect(
      screen.getByRole("status", { name: "正在加载网页" }),
    ).toBeInTheDocument();
    fireEvent.load(screen.getByTitle("内置浏览器"));
    expect(screen.queryByRole("status", { name: "正在加载网页" })).toBeNull();
  });

  /// 跨域站点不会回报「被拒绝嵌入」，只能靠超时推断；此时必须给出出口。
  it("8 秒未触发 onLoad 时提示拒绝嵌入，可转系统浏览器打开", () => {
    vi.useFakeTimers();
    render(<WebBrowserPanel />);
    go("example.com");

    expect(screen.queryByText("该站点拒绝嵌入")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(screen.getByText("该站点拒绝嵌入")).toBeInTheDocument();
    // 工具栏也有同名按钮，限定在引导卡内部点击。
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button"));
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com");
  });

  it("页面正常加载后即使超时也不误报拒绝嵌入", () => {
    vi.useFakeTimers();
    render(<WebBrowserPanel />);
    go("example.com");

    fireEvent.load(screen.getByTitle("内置浏览器"));
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(screen.queryByText("该站点拒绝嵌入")).toBeNull();
  });
});
