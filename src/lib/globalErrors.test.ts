import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGlobalErrorHandlers } from "./globalErrors";
import { noticesSnapshot, resetNotices } from "./notices";

function rejection(reason: unknown) {
  const e = new Event("unhandledrejection") as Event & { reason?: unknown };
  e.reason = reason;
  window.dispatchEvent(e);
}

beforeEach(() => {
  resetNotices();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  resetNotices();
});

describe("全局错误兜底", () => {
  it("window error 推一条错误 toast", () => {
    const un = installGlobalErrorHandlers();
    window.dispatchEvent(
      new ErrorEvent("error", { message: "boom", error: new Error("boom") }),
    );
    expect(noticesSnapshot()).toHaveLength(1);
    expect(noticesSnapshot()[0].kind).toBe("error");
    un();
  });

  it("未处理的 Promise 拒绝映射到可读文案", () => {
    const un = installGlobalErrorHandlers();
    rejection(new Error("请求超时"));
    expect(noticesSnapshot()[0].text).toContain("网络");
    un();
  });

  it("相同文案短时间内去重，避免刷屏", () => {
    const un = installGlobalErrorHandlers();
    rejection(new Error("请求超时"));
    rejection(new Error("请求超时"));
    expect(noticesSnapshot()).toHaveLength(1);
    un();
  });

  it("卸载后不再提示", () => {
    const un = installGlobalErrorHandlers();
    un();
    rejection(new Error("boom"));
    expect(noticesSnapshot()).toHaveLength(0);
  });
});
