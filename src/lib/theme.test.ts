import { describe, expect, it } from "vitest";
import {
  clampFontSize,
  fontSizeField,
  resolvedFontSizeVariable,
  resolveTheme,
} from "./theme";

describe("主题字号变量", () => {
  it("三角色变量名必须与 useTheme 写入 body 的名字一致", () => {
    // 旧实现拼出 --dsh-font-size-text，而 useTheme 写的是
    // --dsh-content-font-size —— 两个名字对不上，设置页调了也不会生效。
    expect(resolvedFontSizeVariable("text")).toBe("--dsh-content-font-size");
    expect(resolvedFontSizeVariable("code")).toBe("--dsh-code-font-size");
    expect(resolvedFontSizeVariable("terminal")).toBe("--dsh-terminal-font-size");
  });

  it("字号字段映射与上下限钳制", () => {
    expect(fontSizeField("text")).toBe("fontSize");
    expect(fontSizeField("code")).toBe("codeFontSize");
    expect(fontSizeField("terminal")).toBe("terminalFontSize");
    expect(clampFontSize(999)).toBe(22);
    expect(clampFontSize(1)).toBe(10);
  });

  it("固定档直接解析，不依赖系统媒体查询", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });
});
