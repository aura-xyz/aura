import { describe, expect, it } from "vitest";
import { contrastRatioFixed, meetsAA } from "./contrast";

// 令牌值镜像 src/index.css。改动 index.css 时必须同步这里，
// 否则测试会变成「校验旧值」的假阴性。
const LIGHT = {
  surface: "#ffffff",
  surfaceSunken: "#f5f5f7",
  foreground: "#3a3a3c",
  subtle: "#6e6e73",
  line: "#e5e5ea",
  bubble: "#f5f5f7",
  bubbleUser: "#cce0f5",
  danger: "#d70015",
  link: "#0066cc",
  success: "#2f6b4a",
  warning: "#b25000",
  brand: "#0066cc",
};

const DARK = {
  surface: "#0a0a0a",
  surfaceSunken: "#1c1c1e",
  foreground: "#f5f5f7",
  subtle: "#98989d",
  line: "#454547",
  bubble: "#1c1c1e",
  bubbleUser: "#233040",
  danger: "#ff453a",
  link: "#4da3ff",
  success: "#30d158",
  warning: "#ff9f0a",
  brand: "#4da3ff",
};

// 前景色 × 实际会出现在其上的背景。
// 这一组穷尽了当前界面里的真实组合，不是随意枚举。
const PAIRS: Array<[name: string, fg: keyof typeof LIGHT, bg: keyof typeof LIGHT]> = [
  ["正文", "foreground", "surface"],
  ["正文（凹陷面）", "foreground", "surfaceSunken"],
  ["次级文字", "subtle", "surface"],
  ["次级文字（凹陷面）", "subtle", "surfaceSunken"],
  ["AI 气泡文字", "foreground", "bubble"],
  ["用户气泡文字", "foreground", "bubbleUser"],
  ["危险文字", "danger", "surface"],
  ["链接文字", "link", "surface"],
  ["成功文字", "success", "surface"],
  ["成功文字（凹陷面）", "success", "surfaceSunken"],
  ["警告文字", "warning", "surface"],
  ["警告文字（凹陷面）", "warning", "surfaceSunken"],
  ["品牌文字", "brand", "surface"],
];

describe("contrastRatio", () => {
  it("黑白为最高对比度 21", () => {
    expect(contrastRatioFixed("#000000", "#ffffff")).toBe(21);
  });

  it("同色为最低对比度 1", () => {
    expect(contrastRatioFixed("#3a3a3c", "#3a3a3c")).toBe(1);
  });

  it("顺序无关", () => {
    expect(contrastRatioFixed("#000000", "#ffffff")).toBe(
      contrastRatioFixed("#ffffff", "#000000"),
    );
  });

  it("支持三位缩写形式", () => {
    expect(contrastRatioFixed("#fff", "#000")).toBe(21);
  });

  it("拒绝非十六进制输入", () => {
    // 签名是 string，所以类型层不拦；靠 toRgb 的正则在运行时抛错。
    expect(() => contrastRatioFixed("red", "#ffffff")).toThrow();
  });
});

describe("令牌对比度（验收标准）", () => {
  for (const [themeName, theme] of [
    ["亮色", LIGHT],
    ["暗色", DARK],
  ] as const) {
    describe(themeName, () => {
      for (const [name, fg, bg] of PAIRS) {
        it(`${name}：${theme[fg]} 于 ${theme[bg]}`, () => {
          const ratio = contrastRatioFixed(theme[fg], theme[bg]);
          expect(
            meetsAA(theme[fg], theme[bg]),
            `${themeName}「${name}」对比度 ${ratio}:1，低于 AA 4.5:1`,
          ).toBe(true);
        });
      }
    });
  }
});

describe("气泡底可辨识度", () => {
  // 用户气泡与 AI 气泡底色必须能分辨——这是「对话归属一眼可辨」的量化版。
  // 阈值 1.2 是经验值：低于它肉眼难以区分深浅，高于它又不至于像两个主题。
  it("亮色下用户/AI 气泡底可区分", () => {
    expect(contrastRatioFixed(LIGHT.bubbleUser, LIGHT.bubble)).toBeGreaterThan(1.2);
  });

  it("暗色下用户/AI 气泡底可区分", () => {
    expect(contrastRatioFixed(DARK.bubbleUser, DARK.bubble)).toBeGreaterThan(1.2);
  });
});
