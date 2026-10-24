import { beforeEach, describe, expect, it, vi } from "vitest";

// updater.ts 经 @tauri-apps/plugin-updater 的 check() 走 Tauri IPC。
// 这里 mock 掉整个模块，用可控的桩驱动三种成功结局与两种失败结局。
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

import { check } from "@tauri-apps/plugin-updater";
import { categorizeCheckError, checkForUpdate, describeInstallError } from "./updater";

const mockCheck = vi.mocked(check);

/** 构造插件 Update 对象的最小桩（本模块只用 version / body / date）。 */
function fakeUpdate(partial: { version: string; body?: string; date?: string }) {
  return partial as unknown as Awaited<ReturnType<typeof check>>;
}

/**
 * 版本号比较。updater 依赖服务端返回的 `latest.json` 判定是否有更新，
 * 这里只测我们自己的格式化与展示逻辑，避免依赖网络。
 */

/** 字节数转可读体积。 */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

describe("fmtSize", () => {
  it("字节", () => {
    expect(fmtSize(512)).toBe("512 B");
  });

  it("千字节", () => {
    expect(fmtSize(2048)).toBe("2.0 KB");
  });

  it("兆字节", () => {
    // 安装包约 45MB，下载进度显示的就是这个量级
    expect(fmtSize(45 * 1024 * 1024)).toBe("45.0 MB");
  });

  it("单位边界", () => {
    expect(fmtSize(1023)).toBe("1023 B");
    expect(fmtSize(1024)).toBe("1.0 KB");
    expect(fmtSize(1024 * 1024)).toBe("1.0 MB");
  });

  it("零值", () => {
    expect(fmtSize(0)).toBe("0 B");
  });
});

describe("categorizeCheckError", () => {
  it("端点未返回有效清单归为服务暂不可用，而非用户网络故障", () => {
    // 发布窗口期：Release 已公开但 latest.json 未上传，插件抛
    // ReleaseNotFound。若提示「检查网络」会误导网络完全正常的用户。
    expect(
      categorizeCheckError(
        new Error("Could not fetch a valid release JSON from the remote"),
      ),
    ).toBe("unavailable");
  });

  it("连接失败归为网络故障", () => {
    expect(
      categorizeCheckError(
        new Error("error sending request for url (https://github.com/): dns error"),
      ),
    ).toBe("failed");
  });

  it("TLS 证书错误归为网络故障", () => {
    expect(
      categorizeCheckError(new Error("invalid peer certificate: UnknownIssuer")),
    ).toBe("failed");
  });

  it("非 Error 对象也按网络故障处理", () => {
    expect(categorizeCheckError("boom")).toBe("failed");
  });
});

describe("checkForUpdate", () => {
  beforeEach(() => {
    mockCheck.mockReset();
  });

  it("有新版本时带上版本号、更新说明与安装句柄", async () => {
    const handle = fakeUpdate({
      version: "0.6.0",
      body: "修了一堆",
      date: "2026-10-17",
    });
    mockCheck.mockResolvedValue(handle);

    const result = await checkForUpdate("0.5.1");
    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;
    expect(result.info).toEqual({
      version: "0.6.0",
      currentVersion: "0.5.1",
      notes: "修了一堆",
      date: "2026-10-17",
    });
    // 必须原样带回插件给的句柄：安装时复用它，不再二次 check
    expect(result.update).toBe(handle);
  });

  it("无可用更新与检查失败必须区分", async () => {
    mockCheck.mockResolvedValue(null);
    expect(await checkForUpdate("0.5.1")).toEqual({ kind: "up-to-date" });
  });

  it("清单不存在（404 窗口期）归为服务暂不可用", async () => {
    mockCheck.mockRejectedValue(
      new Error("Could not fetch a valid release JSON from the remote"),
    );
    expect(await checkForUpdate("0.5.1")).toEqual({ kind: "unavailable" });
  });

  it("网络故障带上原始原因，供 UI 展示详情", async () => {
    mockCheck.mockRejectedValue(new Error("error sending request for url"));
    expect(await checkForUpdate("0.5.1")).toEqual({
      kind: "failed",
      reason: "error sending request for url",
    });
  });

  /// 插件没有单请求超时：某个端点长时间无响应时，不能永远转圈。
  /// 超时归入 failed（带可读原因），UI 据此给出浏览器出口。
  it("超过总时限给出可读的超时原因，而不是无限等待", async () => {
    vi.useFakeTimers();
    try {
      mockCheck.mockReturnValue(new Promise(() => {}));
      const pending = checkForUpdate("0.5.1");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await pending).toEqual({
        kind: "failed",
        reason: expect.stringContaining("超时"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("describeInstallError", () => {
  it("网络中断翻成人话（不再把整条 URL 甩给用户）", () => {
    const msg = describeInstallError(
      new Error(
        "error sending request for url (https://github.com/aura-xyz/aura/releases/latest/download/latest.json)",
      ),
    );
    expect(msg).toContain("网络中断");
    expect(msg).not.toContain("http");
  });

  it("超时同样归为网络问题", () => {
    expect(describeInstallError(new Error("operation timed out"))).toContain("网络中断");
  });

  it("签名校验失败要明确说清楚该怎么处置", () => {
    expect(
      describeInstallError(new Error("Signature verification failed")),
    ).toContain("重新下载");
  });

  it("认不出的错误原样返回，别把诊断信息吞掉", () => {
    expect(describeInstallError(new Error("磁盘已满"))).toBe("磁盘已满");
    expect(describeInstallError("纯字符串")).toBe("纯字符串");
  });
});
