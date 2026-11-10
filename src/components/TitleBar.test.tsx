import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getVersion } from "@tauri-apps/api/app";
import TitleBar, { resetDesktopCache } from "./TitleBar";

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
const { platformMock } = vi.hoisted(() => ({
  platformMock: vi.fn((): string => "windows"),
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: platformMock }));

beforeEach(() => {
  vi.clearAllMocks();
  platformMock.mockReturnValue("windows");
  // 平台结果缓存在模块级，用例之间必须清掉
  resetDesktopCache();
});

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

describe("标题栏搜索位与版本徽标", () => {
  /// A2：把 Ctrl+K 这个隐藏快捷键变成看得见的入口，点击要真的能开面板。
  it("点击搜索胶囊触发回调", async () => {
    const onSearch = vi.fn();
    render(<TitleBar onSearch={onSearch} />);
    await screen.findByText(/v0\.8\.0/);

    const capsule = screen.getByRole("button", { name: /搜索会话、技能与命令/ });
    expect(capsule).toHaveTextContent("Ctrl K");
    await userEvent.click(capsule);
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("不传 onSearch 时不渲染搜索胶囊", async () => {
    render(<TitleBar />);
    await screen.findByText(/v0\.8\.0/);
    expect(screen.queryByRole("button", { name: /搜索会话/ })).toBeNull();
  });

  /// rc 期要标出来：预发布通道的用户该知道自己在哪条通道上。
  it("预发布版本号追加 RC 徽标，正式版没有", async () => {
    vi.mocked(getVersion).mockResolvedValueOnce("0.8.0-rc.1");
    const { unmount } = render(<TitleBar />);
    await screen.findByText(/v0\.8\.0-rc\.1/);
    expect(screen.getByText("RC")).toBeInTheDocument();
    unmount();

    render(<TitleBar />);
    await screen.findByText(/v0\.8\.0$/);
    expect(screen.queryByText("RC")).toBeNull();
  });
});

describe("标题栏平台判定", () => {
  /// C26：平台从 plugin-os 取（启动时已注入，同步），不再依赖 navigator.platform
  /// 的 UA 字符串——Linux 上 UA 常常是 "Linux x86_64"，mac 上又可能被 WebView 改写。
  it("linux 显示 data-platform=linux，关闭按钮改淡色悬停", async () => {
    platformMock.mockReturnValue("linux");
    resetDesktopCache();
    const { container } = render(<TitleBar />);
    await screen.findByText(/v0\.8\.0/);

    const header = container.querySelector("header");
    expect(header).toHaveAttribute("data-platform", "linux");
    const close = screen.getByRole("button", { name: "关闭" });
    expect(close.className).toContain("hover:bg-danger/15");
  });

  it("windows 保持整块红悬停，按钮仍在右侧", async () => {
    const { container } = render(<TitleBar />);
    await screen.findByText(/v0\.8\.0/);

    expect(container.querySelector("header")).toHaveAttribute(
      "data-platform",
      "windows",
    );
    const close = screen.getByRole("button", { name: "关闭" });
    expect(close.className).toContain("hover:bg-danger");
    expect(close.className).not.toContain("hover:bg-danger/15");
  });

  it("macos 映射成 darwin，标题栏更高一档", async () => {
    platformMock.mockReturnValue("macos");
    resetDesktopCache();
    const { container } = render(<TitleBar />);
    await screen.findByText(/v0\.8\.0/);

    const header = container.querySelector("header");
    expect(header).toHaveAttribute("data-platform", "darwin");
    expect(header?.className).toContain("h-10");
  });

  /// 插件没注册 / 权限缺失时不能白屏：退回 UA 猜测（jsdom 下按 Windows）。
  it("plugin-os 抛错时退回 UA 猜测", async () => {
    platformMock.mockImplementation(() => {
      throw new Error("plugin not registered");
    });
    resetDesktopCache();
    const { container } = render(<TitleBar />);
    await screen.findByText(/v0\.8\.0/);
    expect(container.querySelector("header")).toHaveAttribute(
      "data-platform",
      "windows",
    );
  });
});
