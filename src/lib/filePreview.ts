/**
 * 大文件预览的分块拼接与截断提示（v0.8.1 P06）。
 *
 * 后端 `read_file_stream` 用 Channel 按 256KB 推块；这里只做纯数据整理，
 * 让「拼接顺序」「忽略结束标记」「提示文案」都能脱离 Tauri 直接单测。
 */

export interface FileChunk {
  index: number;
  text: string;
  done: boolean;
}

/**
 * 按 index 还原文本，丢弃 `done` 标记块。
 *
 * Channel 正常是有序的，但按 index 排一次是零成本的保险：块本身已经按
 * 行边界切开，多字节字符不会被切断，直接 join 即可。
 */
export function assembleChunks(chunks: FileChunk[]): string {
  return chunks
    .filter((c) => !c.done)
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((c) => c.text)
    .join("");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** 文件被截断时给用户的说明；未截断返回 null。 */
export function truncationNotice(totalBytes: number, sentBytes: number): string | null {
  if (totalBytes <= sentBytes) return null;
  return `文件较大，仅预览前 ${formatBytes(sentBytes)}（共 ${formatBytes(totalBytes)}）。完整内容请在本机应用中打开。`;
}

/** 目录被截断时给用户的说明；未截断返回 null。 */
export function directoryNotice(total: number, shown: number): string | null {
  if (total <= shown) return null;
  return `目录条目过多，仅显示前 ${shown} 条（共 ${total} 条），可用筛选框定位文件。`;
}
