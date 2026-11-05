/**
 * `/` 根命令（v0.8.0）。
 *
 * 旧行为是输入 `/` 直接弹技能列表；现在 `/` 是**命令入口**，
 * 只有 `/skill`（或 `/技能`）才进入技能二级菜单。
 * 判定与过滤放纯函数，方便单测钉住别名与参数切分。
 */
export type CommandId = "skill" | "goal" | "model" | "mode" | "export";

export interface SlashCommand {
  id: CommandId;
  label: string;
  aliases: string[];
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "skill", label: "技能", aliases: ["skill", "技能"], description: "选择并插入一个技能" },
  { id: "goal", label: "目标", aliases: ["goal", "目标"], description: "设置或查看长期任务目标" },
  { id: "model", label: "模型", aliases: ["model", "模型"], description: "选择本会话使用的模型" },
  { id: "mode", label: "模式", aliases: ["mode", "模式"], description: "切换对话 / 规划 / 执行" },
  { id: "export", label: "下载日志", aliases: ["export", "导出"], description: "将当前会话导出为 ZIP" },
];

export interface SlashResolution {
  /** 已精确匹配的命令：打开它的二级面板 */
  command?: CommandId;
  /** 该命令后面输入的参数（`/目标 写完报告` → "写完报告"） */
  args: string;
  /** 根列表里匹配当前输入的命令 */
  matches: SlashCommand[];
}

export interface SlashTrigger {
  /** 触发 `/` 在文本中的下标 */
  start: number;
  /** 光标位置 */
  end: number;
  /** `/` 之后到光标的整段文本（可含参数，如 "goal 写完报告"） */
  query: string;
}

/**
 * 找出光标所处的 `/` 命令词元。
 *
 * 与 `findTrigger` 不同：命令**参数可以带空格**（`/目标 写完报告`），
 * 所以从光标往回找到最近一个词首 `/` 后，把它到光标的整段都当 query，
 * 由 resolveSlashQuery 再切头与参数。
 *
 * 两条护栏：
 * - 只认词首 `/`（前一字符是空白或行首）：`src/lib` 不是命令；
 * - 遇到换行即停：多行 textarea 里不能把上一行的 `/foo` 误判成当前触发。
 */
export function findSlashTrigger(line: string, caret: number): SlashTrigger | null {
  const end = Math.min(Math.max(caret, 0), line.length);
  if (end === 0) return null;
  let start = -1;
  for (let i = end - 1; i >= 0; i -= 1) {
    const ch = line[i];
    if (ch === "\n") break;
    if (ch === "/") {
      if (i === 0 || /\s/.test(line[i - 1])) start = i;
      break;
    }
  }
  if (start < 0) return null;
  return { start, end, query: line.slice(start + 1, end) };
}

/** 解析 `/` 后面的文本（不含触发符本身）。 */
export function resolveSlashQuery(query: string): SlashResolution {
  const raw = query.trim();
  const head = raw.split(/\s+/)[0] ?? "";
  const lower = head.toLowerCase();
  const exact = SLASH_COMMANDS.find((c) =>
    c.aliases.some((a) => a.toLowerCase() === lower),
  );
  if (exact) {
    return {
      command: exact.id,
      args: raw.slice(head.length).trim(),
      matches: [exact],
    };
  }
  const matches = SLASH_COMMANDS.filter(
    (c) =>
      !head ||
      c.label.toLowerCase().includes(lower) ||
      c.aliases.some((a) => a.toLowerCase().startsWith(lower)),
  );
  return { args: "", matches };
}
