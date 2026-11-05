import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOpenApps: vi.fn(),
  openInApp: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  listOpenApps: mocks.listOpenApps,
  openInApp: mocks.openInApp,
}));

import OpenInMenu from "./OpenInMenu";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listOpenApps.mockResolvedValue([
    { id: "explorer", name: "文件资源管理器" },
    { id: "vscode", name: "VS Code" },
    { id: "rider", name: "Rider" },
  ]);
  mocks.openInApp.mockResolvedValue(undefined);
});

describe("在…中打开", () => {
  it("列出探测到的应用，默认项带标记，点选后按会话打开", async () => {
    render(<OpenInMenu sessionId="s1" workspace="E:/work/aura" />);
    const trigger = screen.getByRole("button", { name: "在…中打开" });
    await waitFor(() => expect(trigger).not.toBeDisabled());

    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    // 抓语义而不是拼接措辞：默认项必须在第一位且带「默认」标记
    expect(items[0].textContent).toContain("文件资源管理器");
    expect(items[0].textContent).toContain("默认");
    const vscode = screen.getByRole("menuitem", { name: /VS Code/ });
    fireEvent.click(vscode);

    await waitFor(() =>
      expect(mocks.openInApp).toHaveBeenCalledWith("vscode", "s1"),
    );
  });

  it("未选工作区时按钮禁用，且不会打开任何应用", async () => {
    render(<OpenInMenu sessionId="s1" workspace="" />);
    const trigger = screen.getByRole("button", { name: "在…中打开" });
    await waitFor(() => expect(mocks.listOpenApps).toHaveBeenCalled());
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("打开失败给出可见提示", async () => {
    mocks.openInApp.mockRejectedValueOnce("工作区目录不存在");
    render(<OpenInMenu sessionId="s1" workspace="E:/work/aura" />);
    const trigger = screen.getByRole("button", { name: "在…中打开" });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /VS Code/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("工作区目录不存在"));
  });
});
