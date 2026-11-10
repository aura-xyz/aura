/**
 * 命令面板的数据层（v0.8.0）。
 *
 * 根命令、技能、模型、模式、导出都统一成 CommandItem[]，渲染交给
 * CommandMenu。放在纯函数里是为了「过滤规则」能被单测钉住，不必开 jsdom。
 */
import {
  Cpu,
  Download,
  History,
  MessageSquarePlus,
  Palette,
  Plug,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { ModelInfo, SkillView } from "./api";
import { MODES, MODE_HINT, MODE_LABEL, type Mode } from "./mode";
import {
  resolveSlashQuery,
  type CommandId,
  type SlashCommand,
} from "./slashCommands";
import { skillItems } from "./mentions";

/** 全局面板的分组。输入框里的 `/` 面板不分组（group 缺省即 action）。 */
export type CommandGroup = "action" | "session" | "skill" | "file";

export interface CommandItem {
  id: string;
  label: string;
  detail: string;
  icon?: LucideIcon;
  group?: CommandGroup;
}

export const GROUP_LABEL: Record<CommandGroup, string> = {
  action: "动作",
  session: "会话",
  skill: "技能",
  file: "文件",
};

/** 分组顺序固定：动作 → 会话 → 技能 → 文件。顺序变了用户的手感就变了。 */
const GROUP_ORDER: CommandGroup[] = ["action", "session", "skill", "file"];

/** 按分组切开，组内保持原序，空组不返回。 */
export function groupCommandItems(
  items: CommandItem[],
): { group: CommandGroup; items: CommandItem[] }[] {
  const buckets = new Map<CommandGroup, CommandItem[]>();
  for (const item of items) {
    const group = item.group ?? "action";
    const bucket = buckets.get(group);
    if (bucket) bucket.push(item);
    else buckets.set(group, [item]);
  }
  return GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({
    group: g,
    items: buckets.get(g) as CommandItem[],
  }));
}

/** 关键词过滤：标签与说明都参与，空查询原样返回。 */
export function filterCommandItems(
  items: CommandItem[],
  query: string,
): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) =>
    `${i.label}\n${i.detail}`.toLowerCase().includes(q),
  );
}

/** 全局面板的动作项。id 是稳定的执行键，由 App 按 id 分派。 */
export function actionCommandItems(ctx: {
  mode: Mode;
  theme: "light" | "dark" | "system";
}): CommandItem[] {
  const modes = MODES.map((m) => ({
    id: `action:mode:${m}`,
    label: `切换到${MODE_LABEL[m]}模式`,
    detail: m === ctx.mode ? "当前模式" : MODE_HINT[m],
    icon: SlidersHorizontal,
    group: "action" as const,
  }));
  const themes = (
    [
      { id: "light", label: "亮色" },
      { id: "dark", label: "暗色" },
      { id: "system", label: "跟随系统" },
    ] as const
  ).map((t) => ({
    id: `action:theme:${t.id}`,
    label: `切换主题：${t.label}`,
    detail: t.id === ctx.theme ? "当前" : "",
    icon: Palette,
    group: "action" as const,
  }));

  return [
    {
      id: "action:new",
      label: "新建对话",
      detail: "Ctrl + N",
      icon: MessageSquarePlus,
      group: "action",
    },
    ...modes,
    {
      id: "action:settings",
      label: "打开设置",
      detail: "外观、模型服务、通用、关于",
      icon: Settings,
      group: "action",
    },
    {
      id: "action:skills",
      label: "打开 Skills",
      detail: "内置 / 已安装 / 市场",
      icon: Sparkles,
      group: "action",
    },
    {
      id: "action:mcp",
      label: "打开 MCP",
      detail: "服务器与权限",
      icon: Plug,
      group: "action",
    },
    {
      id: "action:timeline",
      label: "打开操作时间线",
      detail: "本会话的全部工具调用与耗时",
      icon: History,
      group: "action",
    },
    ...themes,
    {
      id: "action:export",
      label: "导出会话日志",
      detail: "打包会话、时间线与更新日志为 ZIP",
      icon: Download,
      group: "action",
    },
  ];
}

const ROOT_ICONS: Record<CommandId, LucideIcon> = {
  skill: Sparkles,
  goal: Target,
  model: Cpu,
  mode: SlidersHorizontal,
  export: Download,
};

/** 根命令列表。query 是 `/` 后面已输入的部分。 */
export function rootCommandItems(query: string): CommandItem[] {
  return resolveSlashQuery(query).matches.map((c: SlashCommand) => ({
    id: c.id,
    label: `/${c.aliases[0]}`,
    detail: `${c.label} · ${c.description}`,
    icon: ROOT_ICONS[c.id],
  }));
}

/** 技能二级菜单：只列已启用技能，与旧 `/` 行为一致。 */
export function skillCommandItems(
  skills: SkillView[],
  query: string,
): CommandItem[] {
  return skillItems(skills, query).map((s) => ({
    id: s.label,
    label: `/${s.label}`,
    detail: s.detail,
    icon: Sparkles,
  }));
}

/**
 * 模型二级菜单：优先列已收藏模型（与 ModelSelect 口径一致）。
 *
 * 一个都没收藏时**回退到全部可用模型**：首次启动、或收藏写入失败时，
 * `/model` 不能变成一个空面板，否则用户会以为命令没触发（实测反馈）。
 */
export function modelCommandItems(
  models: ModelInfo[],
  selectedKey: string,
  query: string,
): CommandItem[] {
  const q = query.trim().toLowerCase();
  const pinned = models.filter((m) => m.pinned);
  const pool = pinned.length > 0 ? pinned : models;
  return pool
    .filter((m) => !q || `${m.label} ${m.id}`.toLowerCase().includes(q))
    .map((m) => ({
      id: m.key,
      label: m.label.trim() || m.id,
      detail:
        m.key === selectedKey ? `当前模型 · ${m.provider_name || m.provider}` : m.provider_name || m.provider,
      icon: Cpu,
    }));
}

/** 模式二级菜单：三档顺序固定，与 ModeTabs 一致。 */
export function modeCommandItems(current: Mode, query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  return MODES.filter(
    (m) => !q || m.includes(q) || MODE_LABEL[m].toLowerCase().includes(q),
  ).map((m) => ({
    id: m,
    label: MODE_LABEL[m],
    detail: m === current ? `当前 · ${MODE_HINT[m]}` : MODE_HINT[m],
    icon: SlidersHorizontal,
  }));
}

/** 导出面板：只有一个动作，点击即执行。 */
export function exportCommandItems(): CommandItem[] {
  return [
    {
      id: "export",
      label: "下载会话日志",
      detail: "打包会话、时间线与更新日志为 ZIP",
      icon: Download,
    },
  ];
}

/** 下一个模式，供输入框 Tab 快捷切换。 */
export function nextMode(current: Mode): Mode {
  const i = MODES.indexOf(current);
  return MODES[(i + 1) % MODES.length];
}
