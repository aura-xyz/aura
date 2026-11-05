import { describe, expect, it } from "vitest";
import {
  clampFontSize,
  fontSizeField,
  resolvedFontSizeVariable,
  resolveTheme,
} from "./theme";

describe("主题字号变量", () => {
  it("三角色变量名必须与 useTheme 写入 body 的名字一致", () => {
    // 旧实现把字号、动效、圆角拆成 --dsh-* / --ds-* / --dsw-* 四套前缀，
    // 现在统一到 --dsw-alias-*，写入端与消费端必须同名。
    expect(resolvedFontSizeVariable("text")).toBe("--dsw-alias-font-size-content");
    expect(resolvedFontSizeVariable("code")).toBe("--dsw-alias-font-size-code");
    expect(resolvedFontSizeVariable("terminal")).toBe("--dsw-alias-font-size-terminal");
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
