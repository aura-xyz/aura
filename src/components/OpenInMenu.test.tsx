import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  localStorage.clear();
  mocks.listOpenApps.mockResolvedValue([
    { id: "explorer", name: "文件资源管理器" },
    { id: "vscode", name: "VS Code" },
    { id: "rider", name: "Rider" },
  ]);
  mocks.openInApp.mockResolvedValue(undefined);
});

async function mount(workspace = "E:/work/aura") {
  render(<OpenInMenu sessionId="s1" workspace={workspace} />);
  const main = screen.getByRole("button", { name: /用 .* 打开|在…中打开/ });
  await waitFor(() => expect(main).not.toBeDisabled());
  return main;
}

describe("在…中打开（拆分按钮）", () => {
  it("左半边直接用默认应用打开，不弹菜单", async () => {
    const main = await mount();
    fireEvent.click(main);
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() =>
      expect(mocks.openInApp).toHaveBeenCalledWith("explorer", "s1"),
    );
  });

  it("右半边才展开菜单，默认项带标记且按会话打开", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "选择打开方式" }));
    const items = screen.getAllByRole("menuitem");
    // 抓语义而不是拼接措辞：默认项必须在第一位且带「默认」标记
    expect(items[0].textContent).toContain("文件资源管理器");
    expect(items[0].textContent).toContain("默认");

    fireEvent.click(screen.getByRole("menuitem", { name: /VS Code/ }));
    await waitFor(() =>
      expect(mocks.openInApp).toHaveBeenCalledWith("vscode", "s1"),
    );
  });

  it("记住上次选择，之后左半边直接打开它", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "选择打开方式" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rider/ }));
    await waitFor(() =>
      expect(mocks.openInApp).toHaveBeenCalledWith("rider", "s1"),
    );

    // 重新挂载，模拟下次启动；清掉调用记录避免上一次的 rider 误判通过
    cleanup();
    mocks.openInApp.mockClear();
    const main = await mount();
    expect(main).toHaveAccessibleName("用 Rider 打开");
    fireEvent.click(main);
    await waitFor(() =>
      expect(mocks.openInApp).toHaveBeenCalledWith("rider", "s1"),
    );
  });

  it("菜单走 portal 的 fixed 定位，不会挂在右上角被窗口裁掉", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "选择打开方式" }));
    const menu = screen.getByRole("menu");
    expect(menu.style.position).toBe("fixed");
    expect(menu.parentElement).toBe(document.body);
    expect(menu.className).toContain("overflow-y-auto");
    expect(menu.className).toContain("max-h-");
  });

  it("未选工作区时按钮禁用，且不会打开任何应用", async () => {
    render(<OpenInMenu sessionId="s1" workspace="" />);
    await waitFor(() => expect(mocks.listOpenApps).toHaveBeenCalled());
    const main = screen.getByRole("button", { name: /用 .* 打开|在…中打开/ });
    expect(main).toBeDisabled();
    fireEvent.click(main);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(mocks.openInApp).not.toHaveBeenCalled();
  });

  it("打开失败给出可见提示", async () => {
    mocks.openInApp.mockRejectedValueOnce("工作区目录不存在");
    const main = await mount();
    fireEvent.click(main);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("工作区目录不存在"),
    );
  });
});
