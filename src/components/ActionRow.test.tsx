import { describe, expect, it } from "vitest";
import { formatMs } from "./ActionRow";

describe("formatMs", () => {
  it("毫秒级原样显示", () => {
    expect(formatMs(0)).toBe("0ms");
    expect(formatMs(340)).toBe("340ms");
    expect(formatMs(999)).toBe("999ms");
  });

  it("秒级保留一位小数", () => {
    expect(formatMs(1000)).toBe("1.0s");
    expect(formatMs(1200)).toBe("1.2s");
    expect(formatMs(9999)).toBe("10.0s");
  });

  it("十秒以上取整，避免无意义的小数", () => {
    expect(formatMs(10000)).toBe("10s");
    expect(formatMs(12345)).toBe("12s");
    expect(formatMs(60000)).toBe("60s");
  });

  it("负值与 0 都按 0ms 显示（时钟回拨时不该出现 -5ms）", () => {
    expect(formatMs(0)).toBe("0ms");
    expect(formatMs(-5)).toBe("0ms");
  });
});
