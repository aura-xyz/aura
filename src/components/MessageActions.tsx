import { RefreshCw } from "lucide-react";
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
export default function MessageActions({
  blocks,
  onRegenerate,
}: {
  blocks: Block[];
  /** 「重新生成本条回复」。不传则不显示该按钮 */
  onRegenerate?: () => void;
}) {
  const text = plainTextOf(blocks);
  if (!text && !onRegenerate) return null;

  return (
    <div className="pointer-events-none flex justify-end gap-1.5 opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          aria-label="重新生成本条回复"
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
        >
          <RefreshCw size={12} className="shrink-0" />
          <span>重新生成</span>
        </button>
      )}
      {text && (
        <div className="pointer-events-auto">
          <CopyButton text={text} label="复制全文" />
        </div>
      )}
    </div>
  );
}
