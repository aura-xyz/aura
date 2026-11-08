import { describe, expect, it } from "vitest";
import {
  SNIPPET_PADDING,
  buildSearchable,
  makeSnippet,
  messageSearchText,
  searchSessions,
  type SearchableSession,
} from "./search";
import type { ChatMessage, Session } from "./store";

function session(
  id: string,
  title: string,
  messages: string[],
): SearchableSession {
  return {
    id,
    title,
    messages: messages.map((text) => ({ role: "user" as const, text })),
  };
}

describe("makeSnippet", () => {
  it("短文本原样返回", () => {
    expect(makeSnippet("hello", 0, 5)).toBe("hello");
  });

  it("命中位置靠前时不加前缀省略号", () => {
    const s = makeSnippet("hello world", 0, 5);
    expect(s).toBe("hello world");
  });

  it("命中位置靠后时加前后省略号", () => {
    const text = "a".repeat(100) + "needle" + "b".repeat(100);
    const s = makeSnippet(text, 100, 6);
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("needle");
  });

  it("截取范围不超过原文长度", () => {
    const s = makeSnippet("short", 0, 5);
    expect(s.length).toBeLessThanOrEqual(5 + SNIPPET_PADDING * 2);
  });
});

describe("searchSessions", () => {
  const sessions = [
    session("s1", "修 bug", ["这个错误怎么修", "已经修好了"]),
    session("s2", "写测试", ["给 parse 写个测试"]),
    session("s3", "别的组", ["无关内容"]),
  ];

  it("空查询返回空数组", () => {
    expect(searchSessions(sessions, "")).toEqual([]);
    expect(searchSessions(sessions, "   ")).toEqual([]);
  });

  it("按消息内容命中", () => {
    const hits = searchSessions(sessions, "测试");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sessionId).toBe("s2");
  });

  it("不区分大小写", () => {
    expect(searchSessions(sessions, "PARSE").length).toBe(1);
  });

  it("标题命中的会话排前面", () => {
    const hits = searchSessions(sessions, "bug");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sessionId).toBe("s1");
  });

  it("只命中标题的会话也算一条结果", () => {
    // s1 的消息里没有「bug」，只有标题有——但用户搜会话名就是想找它
    const hits = searchSessions(sessions, "bug");
    expect(hits).toHaveLength(1);
    expect(hits[0].messageIndex).toBe(-1);
    expect(hits[0].snippet).toContain("bug");
  });

  it("命中片段包含关键词", () => {
    const hits = searchSessions(sessions, "错误");
    expect(hits[0].snippet).toContain("错误");
  });

  it("无匹配时返回空数组", () => {
    expect(searchSessions(sessions, "不存在的关键词")).toEqual([]);
  });

  it("记录命中的消息序号", () => {
    const hits = searchSessions(sessions, "修好了");
    expect(hits[0].messageIndex).toBe(1);
  });

  it("同一条消息只命中一次（取首个匹配位置）", () => {
    const s = [session("x", "t", ["abcabc"])];
    const hits = searchSessions(s, "abc");
    expect(hits).toHaveLength(1);
  });
});

describe("buildSearchable", () => {
  const user = { id: "m1", role: "user", content: "帮我看下 store" } as ChatMessage;
  const assistant = {
    id: "m2",
    role: "assistant",
    blocks: [
      { kind: "text", text: "先读文件" },
      { kind: "action", text: "read_file" },
      { kind: "text", text: "读完再改" },
    ],
  } as ChatMessage;

  it("用户消息取 content，助手只拼正文块（不含动作卡片）", () => {
    expect(messageSearchText(user)).toBe("帮我看下 store");
    expect(messageSearchText(assistant)).toBe("先读文件\n读完再改");
  });

  /// 消息对象不可变：流式更新会换新对象，缓存才不会吃到旧文本。
  it("同一条消息换了新对象后立刻反映新文本", () => {
    const before = messageSearchText(assistant);
    const grown = {
      ...assistant,
      blocks: [
        { kind: "text", text: "先读文件" },
        { kind: "action", text: "read_file" },
        { kind: "text", text: "读完再改，然后又想了想" },
      ],
    } as ChatMessage;
    expect(messageSearchText(assistant)).toBe(before);
    expect(messageSearchText(grown)).toContain("又想了想");
  });

  it("整份索引保留会话标题与消息顺序", () => {
    const sessions = [
      { id: "s1", title: "重构 store", messages: [user, assistant] },
    ] as unknown as Session[];
    const built = buildSearchable(sessions);
    expect(built).toHaveLength(1);
    expect(built[0].title).toBe("重构 store");
    expect(built[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    // 建完索引后仍可正常搜到（只命中用户消息正文，标题不含该词）
    expect(searchSessions(built, "帮我看下")).toHaveLength(1);
  });
});
