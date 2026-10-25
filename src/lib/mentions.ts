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
 * 1. 从光标往回扫到**词元开头**（前一个字符是空白，或已到文首），
 *    再看词元的**首字符**是不是触发符。
 *    —— 不能「往回撞见第一个 `@` 或 `/` 就停」：那样 `@app/src` 会先撞上
 *    内层的 `/`，被当成技能触发，文件面板直接消失。词元首字符才是触发符。
 * 2. 词元首字符必须是触发符：`a@b.com`（邮箱）、`src/lib`（路径）都不是触发。
 * 3. 过滤词 = 词元首字符之后、光标之前的那一段（所以 `@ab` 的过滤词是 `ab`，
 *    光标停在中间时只取到光标为止）。
 */
export function findTrigger(text: string, cursor: number): MentionTrigger | null {
  if (cursor <= 0 || cursor > text.length) return null;

  // 往回扫到词元开头
  let start = cursor;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  if (start === cursor) return null; // 光标左边是空白：没有词元

  const char = text[start];
  if (char !== "@" && char !== "/") return null;

  return {
    kind: char === "@" ? "file" : "skill",
    char,
    start,
    end: cursor,
    query: text.slice(start + 1, cursor),
  };
}
/**
 * 归一化路径查询。
 *
 * **反斜杠转正斜杠**——Windows 用户习惯手打 `app\src\assets`，
 * 而内部一律用正斜杠。用户没义务知道我们内部怎么存路径。
 *
 * 前后端的归一化必须**一致**：前端若按原样过滤，
 * 后端已经归一化后返回的结果会被前端全部滤掉（面板空空如也）。
 */
export function normalizePathQuery(query: string): string {
  return query
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
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
  const q = normalizePathQuery(query);
  return files
    .filter((f) => {
      if (!q) return true;
      const p = f.path.toLowerCase();
      // 带路径的查询按**路径前缀**理解（与后端一致）
      if (q.includes("/")) return p.startsWith(q);
      return f.name.toLowerCase().includes(q) || p.includes(q);
    })
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
