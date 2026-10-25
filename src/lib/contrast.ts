// WCAG 2.1 对比度计算。
//
// 为什么要有这个文件：v0.6.3 的验收标准之一是「暗色模式下全部前景色与背景
// 对比度不低于 4.5:1」。人工看截图不可靠（v0.6.x 多次靠单测才守住契约），
// 所以把它变成可执行门禁。令牌值改动时必须重跑本测试。

/** #rgb 或 #rrggbb → [r,g,b]（0-255） */
function toRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`不是合法的十六进制颜色：${hex}`);
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** 相对亮度（WCAG 定义） */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 对比度，范围 1（同色）到 21（黑白）。
 * 顺序无关，内部自动排序。
 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 保留两位小数，便于测试断言与错误信息阅读 */
export function contrastRatioFixed(a: string, b: string): number {
  return Math.round(contrastRatio(a, b) * 100) / 100;
}

/** WCAG AA 正文文本标准 */
export const AA_THRESHOLD = 4.5;

/** 前景色在给定背景上是否达到 AA */
export function meetsAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= AA_THRESHOLD;
}
