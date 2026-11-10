/**
 * 可配置的全局快捷键表（v0.8.1）。
 *
 * 以前键位硬编码在 App.tsx 的 keydown 里，用户改不了；这里把「动作 → 键位」
 * 抽成一张可持久化、可校验的表，全局监听只负责查表分发。
 *
 * 设计要点：
 * - 主键按 `KeyboardEvent.code` 推导，不用 `key`：Ctrl+Shift+M 的 `key`
 *   会变成大写 M，Ctrl+, 在不同键盘布局下也会漂移，而 code 是物理键位。
 * - 键位一律规范化成「Ctrl+Alt+Shift+Meta+键」的固定顺序，比较/查重/展示
 *   全用同一个字符串，不会出现「Ctrl+Shift+K」和「Shift+Ctrl+K」两套。
 * - 快照缓存在模块级：useSyncExternalStore 要求 getSnapshot 返回稳定引用，
 *   每次现造一个对象会让 React 无限重渲染。
 */

export const SHORTCUT_ACTIONS = [
  { id: "newSession", label: "新建对话", group: "对话", default: "Ctrl+N" },
  { id: "cycleMode", label: "切换工作模式", group: "对话", default: "Ctrl+Shift+M" },
  { id: "openSessionSearch", label: "会话搜索", group: "对话", default: "Ctrl+F" },
  { id: "openCommandPalette", label: "命令面板", group: "对话", default: "Ctrl+K" },
  { id: "openSettings", label: "打开 / 返回设置", group: "导航", default: "Ctrl+," },
  { id: "toggleSidebar", label: "展开 / 收起左侧栏", group: "导航", default: "Ctrl+B" },
  { id: "toggleRightbar", label: "展开 / 收起右侧栏", group: "导航", default: "Ctrl+Shift+B" },
  { id: "openFiles", label: "打开「文件」面板", group: "面板", default: "Ctrl+P" },
  { id: "openWeb", label: "打开「网页」面板", group: "面板", default: "Ctrl+T" },
  { id: "openTerminal", label: "打开「终端」面板", group: "面板", default: "Ctrl+`" },
] as const;

export type ShortcutId = (typeof SHORTCUT_ACTIONS)[number]["id"];
export type ShortcutBindings = Record<ShortcutId, string>;

export interface KeyCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

/** 键盘事件的最小子集：让键位逻辑可以不依赖真实 DOM 事件做单测。 */
export type KeyEventLike = Pick<
  KeyboardEvent,
  "code" | "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

const STORAGE_KEY = "aura-shortcuts";

export const DEFAULT_BINDINGS: ShortcutBindings = Object.fromEntries(
  SHORTCUT_ACTIONS.map((a) => [a.id, a.default]),
) as ShortcutBindings;

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
  "AltLeft", "AltRight", "MetaLeft", "MetaRight",
]);
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "CapsLock"]);
const CODE_TO_KEY: Record<string, string> = {
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Space: "Space",
};

/** 系统 / 编辑操作常用的组合，不允许占用，否则全局拦截会吃掉打字与复制。 */
const RESERVED_BINDINGS = new Set([
  "Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+A", "Ctrl+Z", "Ctrl+Y",
  "Ctrl+S", "Ctrl+W", "Ctrl+Q", "Ctrl+R",
  "Alt+F4", "Ctrl+Tab", "Alt+Tab",
  "Ctrl+Shift+I", "Ctrl+Shift+J", "Ctrl+Shift+C",
]);

function keyFromEvent(e: KeyEventLike): string | null {
  const code = e.code || "";
  if (MODIFIER_CODES.has(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (CODE_TO_KEY[code]) return CODE_TO_KEY[code];
  const k = e.key || "";
  if (!k || MODIFIER_KEYS.has(k)) return null;
  return k.length === 1 ? k.toUpperCase() : k;
}

export function comboFromEvent(e: KeyEventLike): KeyCombo | null {
  const key = keyFromEvent(e);
  if (!key) return null;
  return {
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    key,
  };
}

export function formatShortcut(c: KeyCombo): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push("Ctrl");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  if (c.meta) parts.push("Meta");
  parts.push(c.key);
  return parts.join("+");
}

export function parseShortcut(raw: string): KeyCombo | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const key = parts.pop() as string;
  if (!key || MODIFIER_KEYS.has(key)) return null;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    ctrl: mods.has("ctrl"),
    alt: mods.has("alt"),
    shift: mods.has("shift"),
    meta: mods.has("meta"),
    key,
  };
}

/** 规范化并校验一个键位串；非法返回 null。 */
export function normalizeBinding(raw: string): string | null {
  const c = parseShortcut(raw);
  if (!c) return null;
  // 纯字母 / 纯 Shift+字母 会与打字冲突，必须带 Ctrl / Alt / Meta 之一
  if (!c.ctrl && !c.alt && !c.meta) return null;
  // 单字母统一大写，否则「Ctrl+Shift+m」和「Ctrl+Shift+M」会被当成两套键位
  const key = /^[a-z]$/i.test(c.key) ? c.key.toUpperCase() : c.key;
  const normalized = formatShortcut({ ...c, key });
  if (RESERVED_BINDINGS.has(normalized)) return null;
  return normalized;
}

export function matchShortcut(binding: string, e: KeyEventLike): boolean {
  const want = parseShortcut(binding);
  const got = comboFromEvent(e);
  if (!want || !got) return false;
  return (
    want.ctrl === got.ctrl &&
    want.alt === got.alt &&
    want.shift === got.shift &&
    want.meta === got.meta &&
    want.key.toLowerCase() === got.key.toLowerCase()
  );
}

/** 查表分发：返回第一个命中的动作 id；没有则 null。 */
export function resolveAction(
  e: KeyEventLike,
  bindings: ShortcutBindings,
): ShortcutId | null {
  for (const a of SHORTCUT_ACTIONS) {
    if (matchShortcut(bindings[a.id] ?? "", e)) return a.id;
  }
  return null;
}

/** 返回中文错误原因；null 表示可以保存。 */
export function validateBinding(
  actionId: ShortcutId,
  binding: string,
  bindings: ShortcutBindings,
): string | null {
  const normalized = normalizeBinding(binding);
  if (!normalized) {
    return "请使用「Ctrl / Alt / Meta + 按键」组合；纯按键与系统保留键不能绑定";
  }
  const clash = SHORTCUT_ACTIONS.find(
    (a) => a.id !== actionId && normalizeBinding(bindings[a.id] ?? "") === normalized,
  );
  if (clash) return `与「${clash.label}」的键位冲突，请换一个组合`;
  return null;
}

// —— 持久化 ——

const listeners = new Set<() => void>();
let cache: ShortcutBindings | null = null;

function fresh(): ShortcutBindings {
  return { ...DEFAULT_BINDINGS };
}

function fromStorage(): ShortcutBindings {
  const result = fresh();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    for (const a of SHORTCUT_ACTIONS) {
      const v = saved[a.id];
      if (typeof v !== "string") continue;
      const n = normalizeBinding(v);
      if (n) result[a.id] = n;
    }
  } catch {
    /* 存档损坏 / localStorage 不可用：静默回落默认键位 */
  }
  return result;
}

/** 稳定快照：useSyncExternalStore 的 getSnapshot。 */
export function loadShortcuts(): ShortcutBindings {
  if (!cache) cache = fromStorage();
  return cache;
}

export function saveShortcuts(bindings: ShortcutBindings): void {
  const next = fresh();
  for (const a of SHORTCUT_ACTIONS) {
    const n = normalizeBinding(bindings[a.id] ?? "");
    if (n) next[a.id] = n;
  }
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 存档不可用时仍让本次会话生效 */
  }
  listeners.forEach((fn) => fn());
}

export function resetShortcuts(): void {
  cache = fresh();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 同上 */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeShortcuts(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 仅供单测：丢弃内存快照，强制下次从 localStorage 重读。 */
export function _dropShortcutCache(): void {
  cache = null;
}
