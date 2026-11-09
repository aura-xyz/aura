import { beforeEach, describe, expect, it } from "vitest";
import {
  FRECENCY_KEY,
  HALF_LIFE_MS,
  frecencyScore,
  loadFrecency,
  rankByFrecency,
  recordUse,
  resetFrecency,
  topRecentIds,
} from "./frecency";

const NOW = 1_700_000_000_000;

beforeEach(() => {
  localStorage.clear();
});

describe("frecencyScore", () => {
  it("次数越多分越高，越久没用分越低", () => {
    const fresh = frecencyScore({ count: 3, lastUsed: NOW }, NOW);
    const stale = frecencyScore({ count: 3, lastUsed: NOW - HALF_LIFE_MS }, NOW);
    const frequent = frecencyScore({ count: 6, lastUsed: NOW }, NOW);
    expect(fresh).toBe(3);
    expect(stale).toBeCloseTo(1.5, 5); // 一个半衰期后权重减半
    expect(frequent).toBe(6);
  });

  it("零次使用为 0 分", () => {
    expect(frecencyScore({ count: 0, lastUsed: NOW }, NOW)).toBe(0);
  });

  /// 时钟回拨（lastUsed 在未来）不能算出超过次数的分
  it("未来时间戳按年龄 0 处理", () => {
    expect(frecencyScore({ count: 2, lastUsed: NOW + 1000 }, NOW)).toBe(2);
  });
});

describe("rankByFrecency", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("用过的排前面，没用过的保持原顺序在后", () => {
    const table = { c: { count: 5, lastUsed: NOW }, a: { count: 1, lastUsed: NOW } };
    expect(rankByFrecency(items, table, NOW).map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("没有记录时原样返回", () => {
    expect(rankByFrecency(items, {}, NOW).map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  /// 次数多但很久没用，应当让位给最近用过的
  it("时效压过累计次数", () => {
    const table = {
      a: { count: 20, lastUsed: NOW - HALF_LIFE_MS * 8 }, // 两个月前用了 20 次
      b: { count: 3, lastUsed: NOW - 24 * 3600 * 1000 }, // 昨天用了 3 次
    };
    expect(rankByFrecency(items, table, NOW)[0].id).toBe("b");
  });
});

describe("持久化", () => {
  it("recordUse 累加次数并写回 localStorage", () => {
    recordUse("action:new", NOW);
    recordUse("action:new", NOW + 1);
    const table = loadFrecency();
    expect(table["action:new"].count).toBe(2);
    expect(table["action:new"].lastUsed).toBe(NOW + 1);
  });

  it("脏数据不炸，坏条目被丢弃", () => {
    localStorage.setItem(
      FRECENCY_KEY,
      JSON.stringify({ good: { count: 2, lastUsed: 5 }, bad: "x", worse: { count: "2" } }),
    );
    const table = loadFrecency();
    expect(Object.keys(table)).toEqual(["good"]);
  });

  it("非法 JSON 当作空表", () => {
    localStorage.setItem(FRECENCY_KEY, "{oops");
    expect(loadFrecency()).toEqual({});
  });

  it("resetFrecency 清空记录", () => {
    recordUse("action:new", NOW);
    resetFrecency();
    expect(loadFrecency()).toEqual({});
  });
});

describe("topRecentIds", () => {
  it("按分数取前三，零分项不参与", () => {
    const table = {
      a: { count: 1, lastUsed: NOW },
      b: { count: 9, lastUsed: NOW },
      c: { count: 5, lastUsed: NOW },
      d: { count: 2, lastUsed: NOW },
      zero: { count: 0, lastUsed: NOW },
    };
    expect([...topRecentIds(table, NOW)].sort()).toEqual(["b", "c", "d"]);
  });
});
