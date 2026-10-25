import CopyButton from "./CopyButton";
import { plainTextOf } from "../lib/messageText";
import type { Block } from "../store";

/**
 * 气泡悬停操作条。
 *
 * v0.6.3 之前消息区是只读传送带：想复制一段回复得手动划选，
 * 想换个模型重问只能清空重来。主流客户端的小按钮不是随机堆砌，
 * 而是沿「读完想复制」这类下一步意图分布。
 *
 * 呈现纪律：**悬停才出现**。平时完全隐形，保住极简的第一观感；
 * 键盘聚焦时也要出现（focus-within），否则纯键盘用户永远够不到它。
 */
export default function MessageActions({ blocks }: { blocks: Block[] }) {
  const text = plainTextOf(blocks);
  if (!text) return null;

  return (
    <div className="pointer-events-none flex justify-end opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
      <div className="pointer-events-auto">
        <CopyButton text={text} label="复制全文" />
      </div>
    </div>
  );
}
