/**
 * 粘贴文本是否值得按 Markdown 解析（v0.8.0）。
 *
 * 输入框是所见即所得编辑器，直接把 `# 标题`、`- 列表` 当成纯文本粘进去
 * 会留一坨星号和井号。但普通一句话不该被强行走 Markdown 转换（会吞掉
 * 多余空格、把 `1. 2.` 之类误判成列表），所以先做一次保守判定。
 *
 * 抽成纯函数便于单测钉住「什么该转、什么不该转」。
 */
const BLOCK_SYNTAX = /^\s*(?:#{1,6}\s|>\s|[-*+]\s+\[[ xX]\]\s+|[-*+]\s|\d+[.)]\s|```|---+\s*$)/m;
const INLINE_SYNTAX = /\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|~~[^~\n]+~~/;

export function isMarkdownPaste(text: string): boolean {
  if (!text) return false;
  // 块级语法必须出现在行首；内联语法要求有明确闭合，避免误伤普通文本
  return BLOCK_SYNTAX.test(text) || INLINE_SYNTAX.test(text);
}
