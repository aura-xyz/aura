import { describe, expect, it } from "vitest";
import { errorText, toAppError, toStreamFailure } from "./apiError";

describe("toAppError 归类", () => {
  it("超时与断连归为可重试的网络错误", () => {
    for (const raw of [
      "请求超时",
      "connection timeout",
      "连接中断：stream closed",
      "ECONNRESET",
    ]) {
      const e = toAppError(raw);
      expect(e.code).toBe("net_timeout");
      expect(e.retryable).toBe(true);
      expect(e.detail).toBe(raw);
    }
  });

  it("鉴权与密钥错误不可重试，重试只会再失败一次", () => {
    for (const raw of ["401 Unauthorized", "invalid api key", "密钥无效"]) {
      const e = toAppError(raw);
      expect(e.code).toBe("auth");
      expect(e.retryable).toBe(false);
    }
  });

  it("限流可重试", () => {
    expect(toAppError("429 Too Many Requests").code).toBe("rate_limit");
    expect(toAppError("触发限流").retryable).toBe(true);
  });

  it("上下文溢出不可重试，并引导压缩 / 新开会话", () => {
    const e = toAppError("context length exceeded");
    expect(e.code).toBe("context_overflow");
    expect(e.retryable).toBe(false);
    expect(e.message).toContain("压缩历史");
  });

  it("本地模型离线单独归类", () => {
    const e = toAppError("无法连接本地模型服务 (connection refused)");
    expect(e.code).toBe("local_down");
    expect(e.retryable).toBe(true);
  });

  it("用户主动停止不算失败", () => {
    expect(toAppError("已停止生成").code).toBe("cancelled");
    expect(toAppError("已停止生成").retryable).toBe(false);
  });

  it("认不出的文案落到 unknown，原文不丢", () => {
    const e = toAppError("某个从没见过的错误");
    expect(e.code).toBe("unknown");
    expect(e.detail).toBe("某个从没见过的错误");
    expect(e.retryable).toBe(true);
  });

  it("接受 Error、带 message 的对象与 null，不抛二次异常", () => {
    expect(toAppError(new Error("boom timeout")).code).toBe("net_timeout");
    expect(toAppError({ message: "401" }).code).toBe("auth");
    expect(toAppError(null).code).toBe("unknown");
    expect(toAppError(undefined).code).toBe("unknown");
  });

  it("errorText 等价于归类后的用户文案", () => {
    expect(errorText("请求超时")).toBe(toAppError("请求超时").message);
  });
});

describe("toStreamFailure 终态", () => {
  it("网络超时与本地服务离线是「中断」，可重试", () => {
    for (const raw of ["请求超时", "connection refused"]) {
      const f = toStreamFailure(raw);
      expect(f.kind).toBe("interrupted");
      expect(f.retryable).toBe(true);
    }
  });

  it("鉴权、限流、上下文溢出是「失败」", () => {
    expect(toStreamFailure("401 Unauthorized").kind).toBe("failed");
    expect(toStreamFailure("429").kind).toBe("failed");
    expect(toStreamFailure("context length exceeded").kind).toBe("failed");
  });

  it("限流虽是 failed 但仍可重试", () => {
    const f = toStreamFailure("429 Too Many Requests");
    expect(f.kind).toBe("failed");
    expect(f.retryable).toBe(true);
  });

  it("原始错误文本保留在 detail 里", () => {
    expect(toStreamFailure("连接中断：stream closed").detail).toBe(
      "连接中断：stream closed",
    );
  });
});
