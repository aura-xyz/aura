import { describe, expect, it } from "vitest";
import type { ChatMessage, Session } from "../store";
import {
  groupSessionsByTime,
  keepThroughForResend,
  originalQuestion,
  relativeTime,
  sliceForResend,
  startOfLocalDay,
  userIndexForAssistant,
} from "./history";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 构造一条带 updated_at（秒）的会话，其余字段给测试够用的值。 */
function session(id: string, updatedAtSec: number): Session {
  return {
    id,
    title: id,
    workspace: "ws",
    updated_at: updatedAtSec,
    messages: [],
    todos: [],
  } as unknown as Session;
}


function user(content: string): ChatMessage {
  return { id: `u-${content}`, role: "user", content };
}

function assistant(content: string): ChatMessage {
  return {
    id: `a-${content}`,
    role: "assistant",
    blocks: [{ kind: "text", text: content }],
  };
}

/** u1 / a1 / u2 / a2 */
function sample(): ChatMessage[] {
  return [user("u1"), assistant("a1"), user("u2"), assistant("a2")];
}

describe("groupSessionsByTime", () => {
  // 本地时区 2026-11-09 15:00 作为「现在」，所有边界都用本地的日界推导，
  // 与真实时区无关——单测在任何机器上都应稳定。
  const now = new Date(2026, 10, 9, 15, 0, 0).getTime();
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  const sevenDaysStart = todayStart - 7 * DAY_MS;

  it("按本地日界分到四节（钉住跨日边界）", () => {
    const sToday = session("today", Math.floor(now / 1000));
    const sYesterdayLate = session(
      "yest-late",
      Math.floor((yesterdayStart + 1 * 60 * 60 * 1000) / 1000),
    );
    const sYesterdayJustAfter = session(
      "yest-edge",
      Math.floor((yesterdayStart + 1000) / 1000),
    );
    const sWeek = session(
      "week",
      Math.floor((sevenDaysStart + 1 * 60 * 60 * 1000) / 1000),
    );
    const sEarlier = session(
      "earlier",
      Math.floor((sevenDaysStart - 1000) / 1000),
    );

    const buckets = groupSessionsByTime(
      [sEarlier, sWeek, sYesterdayLate, sToday, sYesterdayJustAfter],
      now,
    );
    expect(buckets.map((b) => b.key)).toEqual([
      "today",
      "yesterday",
      "week",
      "earlier",
    ]);
    expect(buckets[0].sessions.map((s) => s.id)).toEqual(["today"]);
    expect(buckets[1].sessions.map((s) => s.id).sort()).toEqual([
      "yest-edge",
      "yest-late",
    ]);
    expect(buckets[2].sessions.map((s) => s.id)).toEqual(["week"]);
    expect(buckets[3].sessions.map((s) => s.id)).toEqual(["earlier"]);
  });

  it("正好落在昨日 0 点归昨天、落在 7 天前 0 点归更早", () => {
    const onYesterdayMidnight = session(
      "y0",
      Math.floor(yesterdayStart / 1000),
    );
    const onSevenDaysMidnight = session(
      "w0",
      Math.floor(sevenDaysStart / 1000),
    );
    const buckets = groupSessionsByTime(
      [onYesterdayMidnight, onSevenDaysMidnight],
      now,
    );
    expect(buckets[1].sessions.map((s) => s.id)).toEqual(["y0"]);
    expect(buckets[3].sessions.map((s) => s.id)).toEqual(["w0"]);
  });

  it("updated_at 为 0 归入更早", () => {
    const buckets = groupSessionsByTime([session("fresh", 0)], now);
    expect(buckets[3].sessions.map((s) => s.id)).toEqual(["fresh"]);
  });
});

describe("relativeTime", () => {
  const now = new Date(2026, 10, 9, 15, 0, 0).getTime();

  it("未落库（0）返回空串", () => {
    expect(relativeTime(0, now)).toBe("");
  });

  it("今天显示时刻、昨天显示「昨天」", () => {
    // 注意：必须早于 now（15:00），否则 diff 为负会被拦成空串。
    const today1430 = new Date(2026, 10, 9, 14, 30, 0).getTime();
    expect(relativeTime(today1430, now)).toBe("14:30");
    const yesterday = startOfLocalDay(now) - DAY_MS + 60 * 60 * 1000;
    expect(relativeTime(yesterday, now)).toBe("昨天");
  });

  it("一周内显示 N 天前、更久显示日期", () => {
    const threeDaysAgo = startOfLocalDay(now) - 3 * DAY_MS + 1000;
    expect(relativeTime(threeDaysAgo, now)).toBe("3 天前");
    const lastYear = new Date(2025, 0, 5, 9, 0, 0).getTime();
    expect(relativeTime(lastYear, now)).toBe("2025/1/5");
  });
});


describe("userIndexForAssistant", () => {
  it("找到该回答是由第几条用户消息触发的", () => {
    const m = sample();
    expect(userIndexForAssistant(m, 1)).toBe(1); // a1 ← u1
    expect(userIndexForAssistant(m, 2)).toBe(2); // a2 ← u2
  });

  it("序号非法返回 null", () => {
    expect(userIndexForAssistant(sample(), 0)).toBeNull();
    expect(userIndexForAssistant(sample(), 99)).toBeNull();
  });

  it("首条就是 assistant 的异常数据返回 null", () => {
    expect(userIndexForAssistant([assistant("a1")], 1)).toBeNull();
  });
});

describe("originalQuestion", () => {
  it("取到原问题文本", () => {
    expect(originalQuestion(sample(), 1)).toBe("u1");
    expect(originalQuestion(sample(), 2)).toBe("u2");
  });

  it("序号非法返回 null", () => {
    expect(originalQuestion(sample(), 0)).toBeNull();
    expect(originalQuestion(sample(), 99)).toBeNull();
  });
});

describe("sliceForResend", () => {
  it("删掉该用户消息及其后", () => {
    const kept = sliceForResend(sample(), 1);
    expect(kept).toHaveLength(0);
  });

  it("保留到它之前", () => {
    const kept = sliceForResend(sample(), 2);
    expect(kept).toHaveLength(2);
    expect(kept[0].role).toBe("user");
    expect(kept[1].role).toBe("assistant");
  });

  it("非法序号原样返回（不误删）", () => {
    expect(sliceForResend(sample(), 0)).toHaveLength(4);
    expect(sliceForResend(sample(), 99)).toHaveLength(4);
  });
});

describe("keepThroughForResend", () => {
  it("删掉第 k 条用户消息 → 保留到 k-1", () => {
    expect(keepThroughForResend(1)).toBe(0);
    expect(keepThroughForResend(2)).toBe(1);
  });

  it("不会返回负数", () => {
    expect(keepThroughForResend(0)).toBe(0);
    expect(keepThroughForResend(-5)).toBe(0);
  });
});

describe("重新生成与编辑的语义一致性", () => {
  /**
   * 两者后端截断点必须相同：都是「保留到 uIdx-1 条用户消息」。
   * 区别只在重新发送的内容（原文 / 新内容）。
   */
  it("同一 userIndex 推出同一截断点", () => {
    const m = sample();
    const uIdx = userIndexForAssistant(m, 2)!;
    expect(uIdx).toBe(2);
    // 重新生成第 2 条回答 → 截断点 1
    // 编辑第 2 条用户消息 → 截断点也是 1
    expect(keepThroughForResend(uIdx)).toBe(1);
    expect(keepThroughForResend(2)).toBe(1);
  });

  it("重新生成取到的原问题就是触发那条回答的问题", () => {
    const m = sample();
    const uIdx = userIndexForAssistant(m, 2)!;
    expect(originalQuestion(m, uIdx)).toBe("u2");
  });
});
