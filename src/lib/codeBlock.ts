/**
 * 代码块折叠的判定与行数统计。
 *
 * 抽成纯函数是为了能测：折叠阈值是个「20 行」这种经验值，
 * 一旦有人改了判定逻辑（比如从按行改成按字符），很容易在改样式时
 * 顺手改坏，而且没有测试会提醒。
 */

/** 超过这么多行就默认折叠 */
export const FOLD_THRESHOLD_LINES = 20;

/**
 * 代码行数。
 *
 * 按 `\n` 分割。末尾有换行时最后一段是空串，不算一行——
 * `a\nb\n` 是 2 行不是 3 行。
 */
export function countLines(code: string): number {
  if (!code) return 0;
  const lines = code.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    return lines.length - 1;
  }
  return lines.length;
}

/** 是否该默认折叠 */
export function shouldFold(code: string): boolean {
  return countLines(code) > FOLD_THRESHOLD_LINES;
}

/**
 * 折叠时显示的摘要行数——只留头部几行让人认出是什么代码，
 * 完整的要看展开。
 */
export const FOLD_PREVIEW_LINES = 6;

/** 取折叠时的预览内容（头部若干行） */
export function foldPreview(code: string, lines = FOLD_PREVIEW_LINES): string {
  const all = code.split("\n");
  return all.slice(0, lines).join("\n");
}
