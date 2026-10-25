import { beforeEach, describe, expect, it, vi } from "vitest";

// v0.7.0 起，更新检查与下载都走我们自己的 Tauri 命令（后端负责多源探测与选源），
// 这里 mock 掉 invoke / listen，用可控的桩驱动各种结局。
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

let eventHandler: ((e: { payload: unknown }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: (e: { payload: unknown }) => void) => {
    eventHandler = cb;
    return () => {
      eventHandler = null;
    };
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  categorizeCheckError,
  checkForUpdate,
  describeInstallError,
  downloadAndInstall,
} from "./updater";

const mockInvoke = vi.mocked(invoke);

/** 按命令名分发的桩。 */
function dispatch(impl: (cmd: string, args?: unknown) => unknown) {
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) =>
    impl(cmd, args),
  );
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
    mockInvoke.mockReset();
  });

  it("有新版本时带上版本号、更新说明与候选下载源", async () => {
    dispatch((cmd) =>
      cmd === "check_update"
        ? {
            version: "0.6.0",
            notes: "修了一堆",
            date: "2026-10-17",
            sources: [
              { label: "ghfast", url: "https://ghfast.top/x" },
              { label: "GitHub 直连", url: "https://github.com/x" },
            ],
          }
        : null,
    );

    const result = await checkForUpdate();
    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;
    expect(result.info.version).toBe("0.6.0");
    expect(result.info.notes).toBe("修了一堆");
    expect(result.info.date).toBe("2026-10-17");
    // 候选源要透传给前端：用户能看到「从哪个源下」
    expect(result.info.sources.map((s) => s.label)).toEqual([
      "ghfast",
      "GitHub 直连",
    ]);
  });

  it("无可用更新与检查失败必须区分", async () => {
    dispatch((cmd) => (cmd === "check_update" ? null : null));
    expect(await checkForUpdate()).toEqual({ kind: "up-to-date" });
  });

  it("清单不存在（404 窗口期）归为服务暂不可用", async () => {
    dispatch((cmd) => {
      if (cmd === "check_update") {
        throw new Error("Could not fetch a valid release JSON from the remote");
      }
      return null;
    });
    expect(await checkForUpdate()).toEqual({ kind: "unavailable" });
  });

  it("网络故障带上原始原因，供 UI 展示详情", async () => {
    dispatch((cmd) => {
      if (cmd === "check_update") throw new Error("error sending request for url");
      return null;
    });
    expect(await checkForUpdate()).toEqual({
      kind: "failed",
      reason: "error sending request for url",
    });
  });

  /// 后端没有单请求超时：某个端点长时间无响应时，不能永远转圈。
  /// 超时归入 failed（带可读原因），UI 据此给出浏览器出口。
  it("超过总时限给出可读的超时原因，而不是无限等待", async () => {
    vi.useFakeTimers();
    try {
      dispatch((cmd) => {
        if (cmd === "check_update") return new Promise(() => {});
        return null;
      });
      const pending = checkForUpdate();
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

describe("downloadAndInstall", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    eventHandler = null;
  });

  it("把后端推送的下载进度转给调用方（含来源）", async () => {
    dispatch(() => null);
    const seen: Array<{ d: number; t: number | null; s?: string }> = [];
    const pending = downloadAndInstall((downloaded, total, source) => {
      seen.push({ d: downloaded, t: total, s: source });
    });
    // 等 listen 装好
    await Promise.resolve();
    eventHandler?.({
      payload: { downloaded: 1024, total: 2048, source: "ghfast" },
    });
    await pending;
    expect(seen).toEqual([{ d: 1024, t: 2048, s: "ghfast" }]);
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

  it("所有下载源都不可用时要给出明确的下一步", () => {
    const msg = describeInstallError(new Error("没有可用的下载源"));
    expect(msg).toContain("浏览器");
    expect(msg).toContain("重试");
  });

  it("更新句柄失效要提示重新检查", () => {
    expect(describeInstallError(new Error("没有待安装的更新，请先检查更新"))).toContain(
      "重新检查",
    );
  });

  it("认不出的错误原样返回，别把诊断信息吞掉", () => {
    expect(describeInstallError(new Error("磁盘已满"))).toBe("磁盘已满");
    expect(describeInstallError("纯字符串")).toBe("纯字符串");
  });
});
