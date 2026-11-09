/**
 * 最近使用排序（v0.8.0）。
 *
 * 常用命令应该自己浮上来，不该每次都从头翻。分数用「次数 × 指数衰减」：
 * 用了 20 次但都是三个月前的，不如上周用过 3 次的更该排前面。
 *
 * 半衰期取 7 天：一周前的一次使用权重降到一半，符合「最近」的直觉。
 * 数据存 localStorage，与主题偏好同一个位置（都属于界面偏好，不入库）。
 */
export interface FrecencyEntry {
  /** 累计使用次数 */
  count: number;
  /** 最后一次使用的时间戳（毫秒） */
  lastUsed: number;
}

export type FrecencyTable = Record<string, FrecencyEntry>;

export const FRECENCY_KEY = "aura-frecency";

/** 半衰期：7 天。 */
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** 面板里标「最近」的条数。 */
export const RECENT_BADGE_COUNT = 3;

/** 单条目的时效分数：次数 × 0.5^(年龄/半衰期)。 */
export function frecencyScore(
  entry: FrecencyEntry,
  now: number,
  halfLife = HALF_LIFE_MS,
): number {
  if (entry.count <= 0) return 0;
  const age = Math.max(0, now - entry.lastUsed);
  return entry.count * Math.pow(0.5, age / halfLife);
}

/**
 * 按最近使用重排。
 *
 * 没用过的项**保持原顺序排在后面**——它们的位置本来就经过设计（动作 →
 * 会话 → 技能 → 文件），不能因为「零分」被打乱。
 */
export function rankByFrecency<T extends { id: string }>(
  items: T[],
  table: FrecencyTable,
  now: number,
): T[] {
  const scored = items.map((item, index) => {
    const entry = table[item.id];
    return {
      item,
      index,
      score: entry ? frecencyScore(entry, now) : 0,
    };
  });
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.index - b.index;
  });
  return scored.map((s) => s.item);
}

function isEntry(value: unknown): value is FrecencyEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<FrecencyEntry>;
  return typeof v.count === "number" && typeof v.lastUsed === "number";
}

export function loadFrecency(): FrecencyTable {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(FRECENCY_KEY);
  } catch {
    /* localStorage 不可用时当作空表 */
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const table: FrecencyTable = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (isEntry(value)) table[id] = { count: value.count, lastUsed: value.lastUsed };
    }
    return table;
  } catch {
    return {};
  }
}

function save(table: FrecencyTable): void {
  try {
    localStorage.setItem(FRECENCY_KEY, JSON.stringify(table));
  } catch {
    /* 存储满或隐私模式：排序退化成默认顺序，不影响功能 */
  }
}

/** 记一次使用。返回写回后的表，方便调用方就地更新。 */
export function recordUse(
  id: string,
  now = Date.now(),
): FrecencyTable {
  const table = loadFrecency();
  const prev = table[id];
  table[id] = { count: (prev?.count ?? 0) + 1, lastUsed: now };
  save(table);
  return table;
}

/** 清空最近使用（设置页的「重置」）。 */
export function resetFrecency(): void {
  try {
    localStorage.removeItem(FRECENCY_KEY);
  } catch {
    /* 同上 */
  }
}

/**
 * 取排名前 N 的 id，用于渲染「最近」徽章。
 * 只认真正用过的条目，零分项不参与。
 */
export function topRecentIds(
  table: FrecencyTable,
  now: number,
  limit = RECENT_BADGE_COUNT,
): Set<string> {
  const ranked = Object.entries(table)
    .map(([id, entry]) => ({ id, score: frecencyScore(entry, now) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.id);
  return new Set(ranked);
}
