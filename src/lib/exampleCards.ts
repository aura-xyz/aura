import type { SkillView } from "./api";

/**
 * 空状态示例卡片（v0.7.0）。
 *
 * 卡片内容**从内置技能列表动态生成**，不写死：
 * 后续加了新技能，卡片自动跟着变，不用改代码。
 *
 * 卡片同时承担**技能入口的分发职能**——点一下就把引导语填进输入框，
 * 用户改改就能发。
 */

/** 最多展示几张卡片。技能多了卡片区会过长，反而挡路。 */
export const MAX_CARDS = 3;

/** 一张示例卡片 */
export interface ExampleCard {
  /** 技能名 */
  name: string;
  /** 卡片标题（技能名） */
  title: string;
  /** 卡片副标题（技能说明，截断） */
  subtitle: string;
  /** 点击后填入输入框的引导语 */
  prompt: string;
}

/** 说明文字的长度上限 */
const SUBTITLE_MAX = 40;

/** 引导语的模板。按技能名生成，用户一眼知道这条消息会做什么 */
function promptFor(name: string): string {
  return `用 ${name} 技能帮我`;
}

/**
 * 从技能列表生成示例卡片。
 *
 * 只取**内置**技能：内置技能是随包发布的，出厂即有、必定可用。
 * 市场/本地技能依赖用户自己装，出现在引导卡片里可能点不动。
 */
export function buildExampleCards(skills: SkillView[]): ExampleCard[] {
  const builtin = skills.filter(
    (s) => s.source === "builtin" && s.enabled && s.description,
  );
  return builtin.slice(0, MAX_CARDS).map((s) => ({
    name: s.name,
    title: s.name,
    subtitle:
      s.description.length > SUBTITLE_MAX
        ? `${s.description.slice(0, SUBTITLE_MAX)}…`
        : s.description,
    prompt: promptFor(s.name),
  }));
}
