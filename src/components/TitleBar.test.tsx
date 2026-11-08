import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  getVersion: () => Promise.resolve("0.8.0"),
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
