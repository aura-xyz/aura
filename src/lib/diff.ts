/**
 * 行级差异计算。
 *
 * 只做**行级**增删高亮，不做字符级：字符级 diff 的实现复杂度陡增
 * （要处理词边界、空白、Unicode），而用户看文件改动时，行级已经够用。
 *
 * 算法是标准 LCS 动态规划。为避免大文件把 O(n×m) 的表撑爆，
 * 超过阈值时退化成「整体替换」。
 */

/** 参与 LCS 的最大行数。超过就退化成整体替换。 */
export const MAX_DIFF_LINES = 500;

/** 差异的一行 */
export type DiffLine = {
  /** "context" 未变 | "add" 新增 | "del" 删除 */
  type: "context" | "add" | "del";
  /** 行内容 */
  text: string;
  /** 在旧文件中的行号（1-based）；新增行为 null */
  oldLine: number | null;
  /** 在新文件中的行号（1-based）；删除行为 null */
  newLine: number | null;
};

export type DiffResult = {
  lines: DiffLine[];
  /** 是否因为文件太大而退化成了整体替换 */
  degraded: boolean;
  added: number;
  removed: number;
};

/** 按行切分。保留空行，不做 trim——缩进差异本身是要看出来的。 */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // 末尾换行不算多出来的一行
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * 计算行级差异。
 *
 * @param before 修改前的内容
 * @param after 修改后的内容
 */
export function diffLines(before: string, after: string): DiffResult {
  const a = splitLines(before);
  const b = splitLines(after);

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    // 太大：退化成「删掉全部 + 加全部」
    const lines: DiffLine[] = [
      ...a.map((text, i) => ({
        type: "del" as const,
        text,
        oldLine: i + 1,
        newLine: null,
      })),
      ...b.map((text, i) => ({
        type: "add" as const,
        text,
        oldLine: null,
        newLine: i + 1,
      })),
    ];
    return {
      lines,
      degraded: true,
      added: b.length,
      removed: a.length,
    };
  }

  // LCS 动态规划：lcs[i][j] = a[0..i) 与 b[0..j) 的最长公共子序列长度
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // 回溯生成差异序列
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: "context", text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null });
      removed++;
      i++;
    } else {
      lines.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 });
      added++;
      j++;
    }
  }
  while (i < n) {
    lines.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null });
    removed++;
    i++;
  }
  while (j < m) {
    lines.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 });
    added++;
    j++;
  }

  return { lines, degraded: false, added, removed };
}
