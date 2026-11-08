import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getVersion } from "@tauri-apps/api/app";
import TitleBar from "./TitleBar";

// TitleBar 直接调用 Tauri 的 window/app API，单测里替换成可控桩。
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("0.8.0")),
}));

beforeEach(() => vi.clearAllMocks());

describe("标题栏贴边", () => {
  /// 实测反馈：红色关闭按钮右侧空出约 8px，怀疑是自定义滚动条。
  /// 真正来源是 header 的 pr-2；同时根容器必须禁止 body 级滚动条占位。
  it("窗口控制按钮组右侧没有内边距", async () => {
    const { container } = render(<TitleBar />);
    // 等 getVersion 的异步 setState 落定，免得测试里出现 act 警告
    await screen.findByText(/v0\.8\.0/);
    const header = container.querySelector("header");
    expect(header?.className).not.toMatch(/(?:^|\s)pr-\d/);
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });
});

describe("标题栏版本号", () => {
  /// 硬编码兜底 0.7.2-rc.2 曾在升版后继续显示，等于对用户谎报版本。
  /// 读不到运行时版本时应显示 dev，且不得再出现那个过期号。
  it("读不到运行时版本时显示 dev", async () => {
    vi.mocked(getVersion).mockRejectedValueOnce(new Error("no runtime version"));
    const { container } = render(<TitleBar />);

    await screen.findByText("dev");
    expect(container.textContent).not.toContain("0.7.2-rc.2");
  });
});
