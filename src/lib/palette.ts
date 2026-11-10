/**
 * 全局面板的数据组装（v0.8.0）。
 *
 * 会话、技能、文件三类数据形状各异，统一成 `CommandItem` 再交给面板渲染。
 * 抽成纯函数是为了让「空查询时列哪些、有查询时怎么排序」能被单测钉住。
 */
import { Folder, MessageSquare, Sparkles } from "lucide-react";
import type { FileCandidate, SkillView } from "./api";
import type { CommandItem } from "./commandItems";
import { buildSearchable, searchSessions } from "./search";
import type { Session } from "../store";

/** 每类最多给几条。面板是「找东西」的地方，不是列表页。 */
export const PALETTE_LIMIT = 6;

/**
 * 会话项。
 *
 * 空查询给最近几条（按会话列表顺序倒取——`updated_at` 落地后再改时间序）；
 * 有查询走 `lib/search`，标题命中优先的排序规则与 Ctrl+F 面板一致。
 */
export function sessionPaletteItems(
  sessions: Session[],
  query: string,
  limit = PALETTE_LIMIT,
): CommandItem[] {
  const q = query.trim();
  if (!q) {
    return sessions
      .filter((s) => s.messages.length > 0)
      .slice(-limit)
      .reverse()
      .map((s) => ({
        id: `session:${s.id}:-1`,
        label: s.title,
        detail: `${s.messages.length} 条消息`,
        icon: MessageSquare,
        group: "session" as const,
      }));
  }
  return searchSessions(buildSearchable(sessions), q)
    .slice(0, limit)
    .map((hit) => ({
      id: `session:${hit.sessionId}:${hit.messageIndex}`,
      label: hit.sessionTitle,
      detail: hit.snippet,
      icon: MessageSquare,
      group: "session" as const,
    }));
}

/** 技能项：只列已启用技能，选中即把 `/name` 插进输入框。 */
export function skillPaletteItems(
  skills: SkillView[],
  query: string,
  limit = PALETTE_LIMIT,
): CommandItem[] {
  const q = query.trim().toLowerCase();
  return skills
    .filter((s) => s.enabled)
    .filter((s) => !q || `${s.name}\n${s.description}`.toLowerCase().includes(q))
    .slice(0, limit)
    .map((s) => ({
      id: `skill:${s.name}`,
      label: `/${s.name}`,
      detail: s.description,
      icon: Sparkles,
      group: "skill" as const,
    }));
}

/** 文件项：由 App 带着查询去后端捞，这里只做形状转换。 */
export function filePaletteItems(
  files: FileCandidate[],
  limit = PALETTE_LIMIT,
): CommandItem[] {
  return files.slice(0, limit).map((f) => ({
    id: `file:${f.path}`,
    label: f.name,
    detail: f.dir,
    icon: Folder,
    group: "file" as const,
  }));
}
