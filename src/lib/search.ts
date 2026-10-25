/**
 * 会话搜索的匹配逻辑。
 *
 * 抽成纯函数是为了能测：搜索的排序规则（命中标题 vs 命中消息）很容易
 * 在改 UI 时被改坏，而搜索结果对不对用户立刻能感觉到。
 */

/** 一条可被搜索的消息 */
export interface SearchableMessage {
  role: "user" | "assistant";
  /** 消息的纯文本 */
  text: string;
}

/** 一条会话的搜索数据 */
export interface SearchableSession {
  id: string;
  title: string;
  messages: SearchableMessage[];
}

/** 一条搜索结果 */
export interface SearchHit {
  sessionId: string;
  sessionTitle: string;
  /**
   * 命中的消息序号（0-based）。
   * **-1 表示命中的是会话标题本身**，不是某条消息。
   */
  messageIndex: number;
  /** 命中的那段文本（带上下文） */
  snippet: string;
  /** 命中位置在文本中的起点 */
  matchStart: number;
}

/** 命中位置在片段中的偏移（用于高亮） */
export const SNIPPET_PADDING = 24;

/**
 * 截取命中位置周围的文本作为片段。
 *
 * 边界要处理干净：片段的开始/结束不能切在多字节字符中间——
 * JS 字符串是 UTF-16，直接 slice 可能切出半个代理对（emoji 会变乱码）。
 */
export function makeSnippet(
  text: string,
  matchStart: number,
  matchLength: number,
): string {
  const start = Math.max(0, matchStart - SNIPPET_PADDING);
  const end = Math.min(text.length, matchStart + matchLength + SNIPPET_PADDING);
  let s = text.slice(start, end);
  // 避免切出半个代理对
  if (start > 0) {
    const code = s.charCodeAt(0);
    if (code >= 0xd800 && code <= 0xdbff) s = s.slice(1);
  }
  if (end < text.length) {
    const code = s.charCodeAt(s.length - 1);
    if (code >= 0xdc00 && code <= 0xdfff) s = s.slice(0, -1);
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + s + suffix;
}

/**
 * 在一组会话里搜索。
 *
 * 排序：**标题命中优先**，其次按消息序号靠前优先。
 * 用户搜会话名通常是想找那个会话，搜正文内容才是在找具体的话。
 *
 * @param query 关键词（空串返回空数组）
 */
export function searchSessions(
  sessions: SearchableSession[],
  query: string,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: SearchHit[] = [];
  for (const s of sessions) {
    // 标题命中本身也算一条结果：用户搜会话名就是想找那个会话，
    // 即使它的消息内容里没有这个关键词。
    const titleAt = s.title.toLowerCase().indexOf(q);
    if (titleAt >= 0) {
      hits.push({
        sessionId: s.id,
        sessionTitle: s.title,
        messageIndex: -1,
        snippet: makeSnippet(s.title, titleAt, q.length),
        matchStart: titleAt,
      });
    }
    s.messages.forEach((m, idx) => {
      const lower = m.text.toLowerCase();
      const at = lower.indexOf(q);
      if (at < 0) return;
      hits.push({
        sessionId: s.id,
        sessionTitle: s.title,
        messageIndex: idx,
        snippet: makeSnippet(m.text, at, q.length),
        matchStart: at,
      });
    });
  }

  // 排序：标题命中的会话整体提前，其次按会话 id、消息序号。
  const titleMatched = new Set(
    sessions
      .filter((s) => s.title.toLowerCase().includes(q))
      .map((s) => s.id),
  );
  hits.sort((a, b) => {
    const at = titleMatched.has(a.sessionId) ? 0 : 1;
    const bt = titleMatched.has(b.sessionId) ? 0 : 1;
    if (at !== bt) return at - bt;
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
    return a.messageIndex - b.messageIndex;
  });

  return hits;
}
