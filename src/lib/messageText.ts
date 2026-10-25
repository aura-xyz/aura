import type { Block } from "../store";

/**
 * 从 assistant 消息的 blocks 提取纯文本。
 *
 * 只取 text 块——action/notice/error 是工具过程记录，复制给用户没意义
 * （用户点「复制全文」想要的是模型的回答）。
 */
export function plainTextOf(blocks: Block[]): string {
  return blocks
    .filter((b) => b.kind === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}
