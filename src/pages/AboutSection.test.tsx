import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 更新检查与系统能力全部 mock：这一组只验证「失败时用户看得见什么、能做什么」。
const { checkForUpdateMock, openUrlMock } = vi.hoisted(() => ({
  checkForUpdateMock: vi.fn(),
  openUrlMock: vi.fn(async () => {}),
}));

vi.mock("../lib/updater", () => ({
  checkForUpdate: checkForUpdateMock,
  downloadAndInstall: vi.fn(),
  restartApp: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.6.1"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

import AboutSection from "./AboutSection";

beforeEach(() => {
  checkForUpdateMock.mockReset();
  openUrlMock.mockClear();
});

/** 等版本号加载完（按钮在 version 为空时是禁用的）。 */
async function clickCheck() {
  const btn = screen.getByRole("button", { name: /检查更新|检查中/ });
  await waitFor(() => expect(btn).toBeEnabled());
  await userEvent.click(btn);
}

describe("AboutSection 更新", () => {
  /// 检查失败时必须同时给出「真实原因」和「浏览器出口」：
  /// GitHub 发布资产域名在国内常不可达，应用内检查会稳定失败，
  /// 只留一句「请检查网络」等于把用户困死。
  it("检查失败时显示原因并提供浏览器下载出口", async () => {
    checkForUpdateMock.mockResolvedValue({
      kind: "failed",
      reason: "error sending request for url",
    });
    render(<AboutSection />);
    await clickCheck();

    expect(await screen.findByText("检查失败，请检查网络连接后重试。")).toBeInTheDocument();
    expect(screen.getByText("error sending request for url")).toBeInTheDocument();

    const fallback = screen.getByRole("button", { name: /在浏览器中打开下载页/ });
    await userEvent.click(fallback);
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/aura-xyz/aura/releases/latest",
    );
  });

  it("已是最新时不打扰：没有失败提示也没有浏览器出口", async () => {
    checkForUpdateMock.mockResolvedValue({ kind: "up-to-date" });
    render(<AboutSection />);
    await clickCheck();

    expect(await screen.findByText("已是最新版本")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /在浏览器中打开下载页/ })).toBeNull();
  });

  it("发现新版本时展示版本号与更新说明", async () => {
    checkForUpdateMock.mockResolvedValue({
      kind: "available",
      info: {
        version: "0.7.0",
        currentVersion: "0.6.1",
        notes: "## 更新内容\n- 修复若干问题",
      },
    });
    render(<AboutSection />);
    await clickCheck();

    expect(await screen.findByText(/发现新版本 0\.7\.0/)).toBeInTheDocument();
    expect(screen.getByText(/修复若干问题/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下载并安装/ })).toBeInTheDocument();
  });
});
