/**
 * 命令面板的数据层（v0.8.0）。
 *
 * 根命令、技能、模型、模式、导出都统一成 CommandItem[]，渲染交给
 * CommandMenu。放在纯函数里是为了「过滤规则」能被单测钉住，不必开 jsdom。
 */
import {
  Cpu,
  Download,
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

export interface CommandItem {
  id: string;
  label: string;
  detail: string;
  icon?: LucideIcon;
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
