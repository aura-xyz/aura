import type { ChatMessage } from "../store";

/**
 * assistant 消息的多版本管理（v0.7.0）。
 *
 * ## 语义：切换版本只改显示，不回滚上下文
 *
 * 上下文始终基于**最新版本**。用户切回旧版本看的是历史内容，但后续
 * 对话仍然建立在最新版本之上。界面必须明确标注这一点——
 * 否则用户会以为「我切到这版，后面的对话就是基于这版」，那是欺骗。
 *
 * 之所以不回滚：回滚要求后端支持「把预设的回答注入历史」，那要改动
 * runner 的核心链路（跳过模型调用），风险与复杂度都远超收益。
 * 真正需要「基于旧版本继续」时，用「编辑并重跑」更直接。
 */

/** 消息里显示的版本总数（当前 + 历史） */
export function versionCount(m: ChatMessage): number {
  if (m.role !== "assistant") return 0;
  return 1 + (m.versions?.length ?? 0);
}

/** 当前正在显示第几个版本（1-based） */
export function viewingVersion(m: ChatMessage): number {
  if (m.role !== "assistant") return 0;
  return m.viewingVersion ?? versionCount(m);
}

/** 是否正在显示历史版本（不是最新） */
export function viewingHistory(m: ChatMessage): boolean {
  if (m.role !== "assistant") return false;
  return viewingVersion(m) < versionCount(m);
}

/**
 * 切到指定版本。
 *
 * @param m 目标消息
 * @param index 目标版本序号（1-based，1 = 最早）
 * @returns 切换后的消息；序号非法时原样返回
 */
export function switchVersion(m: ChatMessage, index: number): ChatMessage {
  if (m.role !== "assistant") return m;
  const total = versionCount(m);
  if (index < 1 || index > total) return m;

  // versions 是**从旧到新**排的（archiveCurrent 往末尾追加），
  // 所以第 index 个版本对应 versions[index - 1]。
  const versions = m.versions ?? [];

  if (index === total) {
    // 切回最新：恢复被挪走的 latestBlocks。
    // 本来就显示最新时原样返回——不要造新对象，那会触发无谓的重渲染。
    if (m.viewingVersion === undefined) return m;
    return {
      ...m,
      blocks: m.latestBlocks ?? m.blocks,
      viewingVersion: undefined,
      latestBlocks: undefined,
    };
  }

  const target = versions[index - 1];
  if (!target) return m;

  return {
    ...m,
    blocks: target.blocks,
    // 把最新那份挪走，切回来时才能恢复——否则「切走再切回」会弄丢最新版本
    latestBlocks: m.latestBlocks ?? m.blocks,
    viewingVersion: index,
  };
}

/**
 * 把旧版本归档，为「重新生成」做准备。
 *
 * 重新生成会替换当前 blocks；旧内容要先存进 versions 才切得回去。
 */
export function archiveCurrent(m: ChatMessage): ChatMessage {
  if (m.role !== "assistant") return m;
  // 空回答不归档（重试失败之类）
  if (m.blocks.length === 0) return m;
  const versions = m.versions ?? [];
  return {
    ...m,
    versions: [
      ...versions,
      { id: crypto.randomUUID(), blocks: m.blocks, createdAt: Date.now() },
    ],
  };
}

/**
 * 从一组消息里取出「被删掉的那条 assistant 消息」，用于重新生成时归档。
 *
 * 取**最后一个**被删的 assistant——它离保留区最近，也就是刚被回滚掉
 * 的那一条回答。
 *
 * @param before 截断前的消息
 * @param kept 截断后保留的消息
 * @returns 被删掉的那条 assistant 消息；没有则 undefined
 */
export function removedAssistant(
  before: ChatMessage[],
  kept: ChatMessage[],
): ChatMessage | undefined {
  const keptIds = new Set(kept.map((m) => m.id));
  for (let i = before.length - 1; i >= 0; i--) {
    const m = before[i];
    if (m.role === "assistant" && !keptIds.has(m.id)) return m;
  }
  return undefined;
}
