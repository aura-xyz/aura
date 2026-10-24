import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 更新检查与系统能力全部 mock：这一组只验证「失败时用户看得见什么、能做什么」。
const { checkForUpdateMock, downloadMock, restartMock, openUrlMock } = vi.hoisted(() => ({
  checkForUpdateMock: vi.fn(),
  downloadMock: vi.fn(async () => {}),
  restartMock: vi.fn(async () => {}),
  openUrlMock: vi.fn(async () => {}),
}));

vi.mock("../lib/updater", () => ({
  checkForUpdate: checkForUpdateMock,
  // describeInstallError 走真实实现：它是纯函数，值得一起测
  describeInstallError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  downloadAndInstall: downloadMock,
  restartApp: restartMock,
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.6.1"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

import AboutSection from "./AboutSection";

beforeEach(() => {
  checkForUpdateMock.mockReset();
  downloadMock.mockClear();
  restartMock.mockClear();
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
      update: { version: "0.7.0" },
    });
    render(<AboutSection />);
    await clickCheck();

    expect(await screen.findByText(/发现新版本 0\.7\.0/)).toBeInTheDocument();
    expect(screen.getByText(/修复若干问题/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下载并安装/ })).toBeInTheDocument();
  });

  /// 回归：安装必须复用检查阶段拿到的 Update 句柄。
  /// 曾经在 downloadAndInstall 内部再 check() 一次，第二次请求失败就会
  /// 报「安装失败：error sending request for ... latest.json」。
  it("点下载并安装时复用检查阶段的句柄，不重新检查", async () => {
    const handle = { version: "0.7.0" };
    checkForUpdateMock.mockResolvedValue({
      kind: "available",
      info: { version: "0.7.0", currentVersion: "0.6.1" },
      update: handle,
    });
    render(<AboutSection />);
    await clickCheck();

    await userEvent.click(await screen.findByRole("button", { name: /下载并安装/ }));
    expect(downloadMock).toHaveBeenCalledTimes(1);
    // vi.fn 无参签名推不出实参类型，这里显式取第一个参数
    const [passed] = downloadMock.mock.calls[0] as unknown as [unknown];
    expect(passed).toBe(handle);
    // 检查只发生一次：安装阶段不再打清单端点
    expect(checkForUpdateMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/正在重启/)).toBeInTheDocument();
  });

  it("官网与问题反馈都走系统浏览器", async () => {
    render(<AboutSection />);

    await userEvent.click(screen.getByRole("button", { name: /官方网站/ }));
    expect(openUrlMock).toHaveBeenCalledWith("https://aura-xyz.github.io/");

    await userEvent.click(screen.getByRole("button", { name: /问题反馈/ }));
    expect(openUrlMock).toHaveBeenCalledWith("https://github.com/aura-xyz/aura/issues");
  });
});
