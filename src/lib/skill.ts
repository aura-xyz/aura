import type { MarketSkillView, SkillView } from "./api";

/** 来源角标文案。 */
export const SOURCE_LABEL: Record<SkillView["source"], string> = {
  builtin: "内置",
  market: "市场",
  local: "本地",
  workspace: "工作区",
};

export interface SkillGroups {
  /** 随应用发布，只读（可禁用，不可删） */
  builtin: SkillView[];
  /** 市场、本地、当前工作区——用户可管理的那一档 */
  installed: SkillView[];
}

/**
 * 按「内置 / 已安装」分组。组内顺序保持后端给的名称序，不重排——
 * 用户按名字找技能，乱序反而难找。
 */
export function groupSkills(skills: SkillView[]): SkillGroups {
  const builtin: SkillView[] = [];
  const installed: SkillView[] = [];
  for (const s of skills) {
    (s.source === "builtin" ? builtin : installed).push(s);
  }
  return { builtin, installed };
}

/**
 * 工具范围的可读描述。
 *
 * 空白名单 = 继承模式权限，必须显式说出来：「没有工具」和「不限工具」
 * 是完全相反的两件事，界面不能都显示成空白。
 */
export function toolsLabel(skill: Pick<SkillView, "allowed_tools">): string {
  return skill.allowed_tools.length === 0
    ? "不限工具（继承模式权限）"
    : skill.allowed_tools.join("、");
}

/** 是否允许删除。与后端 `skill::deletable` 同一策略，界面据此提前隐藏按钮。 */
export function canDelete(source: SkillView["source"]): boolean {
  return source === "local" || source === "market";
}

/** 不能删除时的原因（与后端文案对齐，避免两处说法不一致）。 */
export function deleteBlockedReason(source: SkillView["source"]): string {
  if (source === "builtin") return "内置技能随应用发布，不能删除；如不需要可以禁用";
  if (source === "workspace")
    return "工作区技能随项目共享，请在项目的 .agents/skills/ 里删除";
  return "";
}

/** 已启用数量，用于页头概览。 */
export function enabledCount(skills: SkillView[]): number {
  return skills.filter((s) => s.enabled).length;
}

/**
 * 市场清单的本地筛选：匹配 id / 展示名 / 说明 / 标签。
 *
 * 纯客户端过滤——清单只有几十条，不必为一个搜索框再走一次网络。
 * 空查询返回原列表（保持注册表给的顺序）。
 */
export function filterMarket<T extends MarketSkillView>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((m) =>
    [m.id, m.name, m.description, ...m.tags]
      .join("\n")
      .toLowerCase()
      .includes(q),
  );
}
