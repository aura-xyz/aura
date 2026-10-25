/**
 * 输入框草稿的读写（按会话隔离）。
 *
 * v0.6.3 之前输入框的 value 是组件内 useState，切换会话即丢——
 * 用户常在几个对话间来回切，写了一半的话一去不回。
 *
 * 存 localStorage 而非 SQLite：这是纯 UI 便利数据，不该进用户数据库，
 * 也不该跟着备份走。清掉浏览器数据即清掉草稿，语义正确。
 *
 * 命名注意：store 里已有一个 `draft` 概念指「空对话」，
 * 这里一律用 inputDraft* 前缀，避免混为一谈。
 */

const KEY = "aura:input-drafts";
const MAX_DRAFTS = 50;
/** 单条草稿长度上限，防止 localStorage 被异常输入撑爆 */
const MAX_LEN = 20000;

function readAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && k) out[k] = v;
    }
    return out;
  } catch {
    // 内容损坏时当空处理，不要因此让输入区打不开
    return {};
  }
}

function writeAll(map: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // 超出配额等：静默失败。草稿是便利功能，不该弹错挡住用户输入
  }
}

/** 取某会话的草稿；没有则空串 */
export function loadInputDraft(sessionId: string): string {
  if (!sessionId) return "";
  return readAll()[sessionId] ?? "";
}

/** 存草稿。空串等价于删除——不让空草稿占满配额 */
export function saveInputDraft(sessionId: string, text: string): void {
  if (!sessionId) return;
  const map = readAll();
  if (!text.trim()) {
    if (!(sessionId in map)) return;
    delete map[sessionId];
  } else {
    map[sessionId] = text.slice(0, MAX_LEN);
  }

  // 超量时淘汰最旧的（localStorage 无插入序，用 JSON 键序近似即可：
  // 这里简单地保留最近写入的一批）
  const keys = Object.keys(map);
  if (keys.length > MAX_DRAFTS) {
    for (const k of keys.slice(0, keys.length - MAX_DRAFTS)) delete map[k];
  }
  writeAll(map);
}

/** 清掉某会话的草稿（会话删除时调用） */
export function clearInputDraft(sessionId: string): void {
  if (!sessionId) return;
  const map = readAll();
  if (!(sessionId in map)) return;
  delete map[sessionId];
  writeAll(map);
}

/** 全部草稿（排障用） */
export function allInputDrafts(): Record<string, string> {
  return readAll();
}
