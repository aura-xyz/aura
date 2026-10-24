import type {
  AuditFinding,
  FindingSeverity,
  MarketSkillView,
  SkillAudit,
  SkillView,
} from "./api";

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

// ── 审查报告 ────────────────────────────────────────────────────

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  high: "高危",
  medium: "注意",
  info: "提示",
};

/** 该风险的严重度排序值，用于报告里高危排前面。 */
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  high: 0,
  medium: 1,
  info: 2,
};

export interface AuditCounts {
  high: number;
  medium: number;
  info: number;
}

/** 按严重度计数。后端已排好序，这里只统计，不改顺序。 */
export function auditCounts(audit: Pick<SkillAudit, "findings">): AuditCounts {
  const counts: AuditCounts = { high: 0, medium: 0, info: 0 };
  for (const f of audit.findings) {
    counts[f.severity] += 1;
  }
  return counts;
}

/**
 * 报告分组：按严重度聚在一起，组内保持后端顺序（文件序 + 行号）。
 * 空组不返回，界面就不用自己判空。
 */
export function groupFindings(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** 一行摘要，放在安装按钮旁边提示风险规模。 */
export function auditHeadline(counts: AuditCounts): string {
  if (counts.high > 0) {
    return `${counts.high} 条高危内容，安装前请逐条确认`;
  }
  if (counts.medium > 0) {
    return `${counts.medium} 条需注意的写法，可以安装`;
  }
  if (counts.info > 0) {
    return "未发现危险操作，仅有提示信息";
  }
  return "未发现可疑内容";
}

/** 技能申请的权限（工具范围 + 是否带脚本），用于安装前高亮。 */
export function permissionLines(tools: string[], hasScripts: boolean): string[] {
  const lines: string[] = [];
  lines.push(
    tools.length === 0
      ? "工具范围：不限（完全继承当前会话模式的权限）"
      : `工具范围：${tools.join("、")}`,
  );
  if (hasScripts) {
    lines.push("包含可执行脚本：模型可能用它在你选定的工作区里跑命令");
  }
  return lines;
}

/** 已安装且有新版本 → 提示更新。版本号读不出时按「已安装」处理，不给更新按钮。 */
export function canUpdate(item: MarketSkillView): boolean {
  if (!item.installed || !item.installed_version || !item.version) return false;
  return item.installed_version !== item.version;
}

/** 字节数的人类可读形式。 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
