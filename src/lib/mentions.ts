import type { SkillView } from "./api";

/**
 * 输入框里的 `@` / `/` 触发（v0.7.0）。
 *
 * 抽成纯函数是为了能测：触发判定与过滤规则很容易被「顺手改一下」改坏，
 * 而坏掉的方式很隐蔽——比如把 `src/lib` 里的斜杠当成技能触发，
 * 用户打路径时突然弹出一个技能列表。
 */

export type MentionKind = "file" | "skill";

export interface MentionTrigger {
  kind: MentionKind;
  /** 触发字符 */
  char: "@" | "/";
  /** 触发字符在文本中的下标 */
  start: number;
  /** 触发结束位置（= 光标） */
  end: number;
  /** 已输入的过滤词 */
  query: string;
}

/** 面板里的一条候选 */
export interface MentionItem {
  kind: MentionKind;
  /** 主标题（文件名 / 技能名） */
  label: string;
  /** 次要说明（所在目录 / 技能说明） */
  detail: string;
  /** 选中后插入输入框的文本 */
  insert: string;
  /** 是目录吗（文件类候选用） */
  isDir?: boolean;
}

/**
 * 找出光标处的触发符。
 *
 * 规则（每条都有代价，别随便改）：
 * 1. 从光标往回扫「非空白」字符，遇到触发符停下——这样 `@ab` 里的
 *    `ab` 才是过滤词，而不是「光标左边必须是触发符」（那样打两个字就失效）。
 * 2. 触发符**前面**必须是行首或空白：`a@b`（邮箱）、`src/lib`（路径）
 *    都不该触发。
 * 3. 过滤词里不能有空白：一旦打了空格，这次触发就结束了。
 */
export function findTrigger(text: string, cursor: number): MentionTrigger | null {
  if (cursor <= 0 || cursor > text.length) return null;

  let i = cursor;
  while (i > 0) {
    const c = text[i - 1];
    if (c === "@" || c === "/") break;
    if (/\s/.test(c)) return null;
    i -= 1;
  }
  if (i === 0) return null; // 扫到行首都没遇到触发符

  const char = text[i - 1];
  const before = i >= 2 ? text[i - 2] : "";
  if (before && !/\s/.test(before)) return null; // 邮箱 / 路径里的 @ 与 /

  return {
    kind: char === "@" ? "file" : "skill",
    char: char as "@" | "/",
    start: i - 1,
    end: cursor,
    query: text.slice(i, cursor),
  };
}

/**
 * 路径候选（文件与目录）。
 *
 * 插入格式 `@<路径>`——与拖放文件用的是同一种写法，模型看到的东西一致。
 * 目录保留结尾的 `/`（`@<app/>`），模型据此知道那是目录。
 */
export function fileItems(
  files: Array<{ path: string; name: string; dir: string; is_dir: boolean }>,
  query: string,
): MentionItem[] {
  const q = query.trim().toLowerCase();
  return files
    .filter((f) => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
    .map((f) => ({
      kind: "file" as const,
      label: f.name,
      detail: f.is_dir ? `${f.dir}（目录）` : f.dir,
      insert: `@<${f.path}>`,
      isDir: f.is_dir,
    }));
}

/**
 * 技能候选。
 *
 * 只列**已启用**的技能：被禁用的技能模型也看不见，列出来点了也白点。
 * 插入 `/技能名`——模型看到技能索引里的同名条目就会去 `load_skill`。
 */
export function skillItems(
  skills: SkillView[],
  query: string,
): MentionItem[] {
  const q = query.trim().toLowerCase();
  return skills
    .filter((s) => s.enabled)
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .map((s) => ({
      kind: "skill" as const,
      label: s.name,
      detail: s.description,
      insert: `/${s.name}`,
    }));
}
