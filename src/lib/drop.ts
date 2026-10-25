/**
 * 拖放路径的判定与格式化。
 *
 * 抽成纯函数是为了能测：拖放要区分「直接附加 / 需授权 / 拒绝」三档，
 * 这套判断内联在组件里时既测不了、也容易在改样式时被顺手改坏。
 */

/** 判定结果的三档，与后端 `check_allowlist_path` 对应 */
export type DropVerdict = "allow" | "confirm" | "reject" | "unknown";

export interface DropDecision {
  /** 是否附加到输入框 */
  attach: boolean;
  /** 提示文案（无提示时为 null） */
  notice: string | null;
}

/**
 * 取路径所在目录。白名单管的是目录，文件跟随其目录。
 *
 * `C:/a/b.txt` → `C:/a`；`C:/a` → `C:/a`（已是目录时原样）。
 */
export function parentDir(path: string): string {
  // 盘符根直接返回。`C:/` 的父目录就是它自己，再往上没有意义；
  // 而且尾部斜杠清理会把 `C:/` 变成 `C:`（那是相对路径，不是根）。
  if (/^[A-Za-z]:[\\/]*$/.test(path)) return path.replace(/\\/g, "/");
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx < 0) return trimmed;
  // 截到分隔符**之前**：`C:/a/b.txt` → `C:/a`。
  const cut = trimmed.slice(0, idx);
  // 盘符要补回斜杠：`C:/a.txt` 的父目录是 `C:/` 而不是 `C:`
  return cut.endsWith(":") ? `${cut}/` : cut;
}

/**
 * 取更严的那一档。
 *
 * 拖入的路径可能是文件也可能是目录，字符串上看不出来：
 * `C:/Users/x/Desktop` 既是「名为 Desktop 的目录」，也可能是「名为 Desktop 的文件」。
 * 所以两个都判，取更严的——漏判的风险（该拦的没拦）比误判大。
 */
export function stricter(a: DropVerdict, b: DropVerdict): DropVerdict {
  const rank: Record<DropVerdict, number> = {
    allow: 0,
    unknown: 1,
    confirm: 2,
    reject: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

/** 格式化成插入输入框的引用 */
export function formatAttachment(paths: string[]): string {
  return paths.map((p) => `@<${p}>`).join(" ");
}

/**
 * 根据每个路径的判定结果，决定附加哪些、提示什么。
 *
 * @param verdicts 每个路径的判定（与 paths 同序）
 */
export function decideDrop(paths: string[], verdicts: DropVerdict[]): DropDecision {
  const accepted: string[] = [];
  let needAuth = 0;
  let rejected = 0;

  paths.forEach((_, i) => {
    const v = verdicts[i] ?? "unknown";
    if (v === "reject") {
      rejected += 1;
      return;
    }
    if (v === "confirm") needAuth += 1;
    accepted.push(paths[i]);
  });

  const notes: string[] = [];
  if (needAuth > 0) {
    notes.push(`${needAuth} 个路径所在目录需要先在设置里授权，模型才能访问`);
  }
  if (rejected > 0) {
    notes.push(`${rejected} 个路径属于系统或密钥目录，已跳过`);
  }

  return {
    attach: accepted.length > 0,
    notice: notes.length > 0 ? notes.join("；") : null,
  };
}
