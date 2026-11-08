import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
  setSystemSettings: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getSystemSettings: mocks.getSystemSettings,
  setSystemSettings: mocks.setSystemSettings,
}));

import SystemSettingsSection from "./SystemSettingsSection";

const BASE = {
  prevent_sleep: false,
  autostart: false,
  prevent_sleep_supported: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSystemSettings.mockResolvedValue({ ...BASE });
  mocks.setSystemSettings.mockImplementation(
    async (prevent_sleep: boolean, autostart: boolean) => ({
      ...BASE,
      prevent_sleep,
      autostart,
    }),
  );
});

describe("系统集成设置", () => {
  it("渲染防休眠与开机自启两个开关", async () => {
    render(<SystemSettingsSection />);
    expect(
      await screen.findByRole("switch", { name: "运行时防止系统休眠" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "开机自动启动" }),
    ).toBeInTheDocument();
  });

  it("切换防休眠时带上另一个设置的当前值，并用后端回读覆盖显示", async () => {
    mocks.getSystemSettings.mockResolvedValue({ ...BASE, autostart: true });
    render(<SystemSettingsSection />);
    const sleep = await screen.findByRole("switch", {
      name: "运行时防止系统休眠",
    });
    fireEvent.click(sleep);
    await waitFor(() =>
      expect(mocks.setSystemSettings).toHaveBeenCalledWith(true, true),
    );
    await waitFor(() => expect(sleep.getAttribute("aria-checked")).toBe("true"));
  });

  it("切换开机自启不影响防休眠", async () => {
    render(<SystemSettingsSection />);
    const autostart = await screen.findByRole("switch", {
      name: "开机自动启动",
    });
    fireEvent.click(autostart);
    await waitFor(() =>
      expect(mocks.setSystemSettings).toHaveBeenCalledWith(false, true),
    );
  });

  it("平台不支持防休眠时置灰，但开机自启仍可用", async () => {
    mocks.getSystemSettings.mockResolvedValue({
      ...BASE,
      prevent_sleep_supported: false,
    });
    render(<SystemSettingsSection />);
    const sleep = await screen.findByRole("switch", {
      name: "运行时防止系统休眠",
    });
    expect(sleep).toBeDisabled();
    expect(screen.getByRole("switch", { name: "开机自动启动" })).not.toBeDisabled();
    expect(screen.getByText(/当前平台暂不支持/)).toBeInTheDocument();
  });

  it("写入失败给出可见提示且不乐观改状态", async () => {
    mocks.setSystemSettings.mockRejectedValueOnce("设置开机自启失败：拒绝访问");
    render(<SystemSettingsSection />);
    const autostart = await screen.findByRole("switch", {
      name: "开机自动启动",
    });
    fireEvent.click(autostart);
    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("设置开机自启失败");
    expect(autostart.getAttribute("aria-checked")).toBe("false");
  });
});
