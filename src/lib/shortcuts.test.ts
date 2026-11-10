import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BINDINGS,
  SHORTCUT_ACTIONS,
  _dropShortcutCache,
  comboFromEvent,
  formatShortcut,
  loadShortcuts,
  matchShortcut,
  normalizeBinding,
  parseShortcut,
  resetShortcuts,
  resolveAction,
  saveShortcuts,
  subscribeShortcuts,
  validateBinding,
  type KeyEventLike,
} from "./shortcuts";

const ev = (over: Partial<KeyEventLike> = {}): KeyEventLike => ({
  code: "",
  key: "",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  resetShortcuts();
  _dropShortcutCache();
});

describe("键位解析与规范化", () => {
  it("code 推导主键，不受 Shift / 键盘大小写影响", () => {
    const c = comboFromEvent(ev({ code: "KeyM", key: "M", ctrlKey: true, shiftKey: true }));
    expect(formatShortcut(c!)).toBe("Ctrl+Shift+M");
  });

  it("标点键用物理 code，Ctrl+, 与 Ctrl+` 都能录制", () => {
    expect(formatShortcut(comboFromEvent(ev({ code: "Comma", key: ",", ctrlKey: true }))!)).toBe("Ctrl+,");
    expect(formatShortcut(comboFromEvent(ev({ code: "Backquote", key: "`", ctrlKey: true }))!)).toBe("Ctrl+`");
  });

  it("单独按下修饰键不构成键位", () => {
    expect(comboFromEvent(ev({ code: "ControlLeft", key: "Control", ctrlKey: true }))).toBeNull();
  });

  it("parse / format 往返一致，修饰键顺序统一", () => {
    expect(formatShortcut(parseShortcut("Shift+Ctrl+K")!)).toBe("Ctrl+Shift+K");
    expect(formatShortcut(parseShortcut("Alt+N")!)).toBe("Alt+N");
    expect(parseShortcut("N")).toBeNull();
    expect(parseShortcut("Ctrl+Control")).toBeNull();
  });

  it("拒绝纯按键、纯 Shift 组合与系统保留键", () => {
    expect(normalizeBinding("A")).toBeNull();
    expect(normalizeBinding("Shift+A")).toBeNull();
    expect(normalizeBinding("Ctrl+C")).toBeNull();
    expect(normalizeBinding("Ctrl+R")).toBeNull();
    expect(normalizeBinding("Ctrl+Alt+N")).toBe("Ctrl+Alt+N");
  });
});

describe("查表分发", () => {
  it("命中默认键位", () => {
    expect(resolveAction(ev({ code: "KeyK", key: "k", ctrlKey: true }), DEFAULT_BINDINGS)).toBe("openCommandPalette");
    expect(resolveAction(ev({ code: "KeyN", key: "n", ctrlKey: true }), DEFAULT_BINDINGS)).toBe("newSession");
  });

  it("修饰键必须完全一致，多一个 Alt 就不命中", () => {
    expect(matchShortcut("Ctrl+N", ev({ code: "KeyN", key: "n", ctrlKey: true }))).toBe(true);
    expect(matchShortcut("Ctrl+N", ev({ code: "KeyN", key: "n", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("改成新键位后按新键命中、旧键不再命中", () => {
    saveShortcuts({ ...DEFAULT_BINDINGS, newSession: "Ctrl+Alt+N" });
    const bindings = loadShortcuts();
    expect(resolveAction(ev({ code: "KeyN", key: "n", ctrlKey: true, altKey: true }), bindings)).toBe("newSession");
    expect(resolveAction(ev({ code: "KeyN", key: "n", ctrlKey: true }), bindings)).toBeNull();
  });
});

describe("冲突校验", () => {
  it("与已有动作撞键时点名冲突项", () => {
    const err = validateBinding("newSession", "Ctrl+K", DEFAULT_BINDINGS);
    expect(err).toContain("命令面板");
  });

  it("同一动作沿用原键位不算冲突", () => {
    expect(validateBinding("newSession", "Ctrl+N", DEFAULT_BINDINGS)).toBeNull();
  });

  it("大小写与修饰键顺序不同的同一组合仍判为冲突", () => {
    expect(validateBinding("newSession", "Shift+Ctrl+m", DEFAULT_BINDINGS)).toContain("切换工作模式");
  });
});

describe("持久化", () => {
  it("保存后可读取，且通知订阅者", () => {
    let notified = 0;
    const un = subscribeShortcuts(() => (notified += 1));
    saveShortcuts({ ...DEFAULT_BINDINGS, openSettings: "Alt+S" });
    expect(loadShortcuts().openSettings).toBe("Alt+S");
    expect(notified).toBe(1);
    un();
  });

  it("非法键位不会写进存档，回落默认", () => {
    saveShortcuts({ ...DEFAULT_BINDINGS, newSession: "A" });
    expect(loadShortcuts().newSession).toBe("Ctrl+N");
  });

  it("存档缺字段时补齐默认，坏 JSON 不抛错", () => {
    localStorage.setItem("aura-shortcuts", JSON.stringify({ newSession: "Ctrl+Alt+J" }));
    _dropShortcutCache();
    expect(loadShortcuts().newSession).toBe("Ctrl+Alt+J");
    expect(loadShortcuts().openTerminal).toBe(DEFAULT_BINDINGS.openTerminal);

    localStorage.setItem("aura-shortcuts", "{not json");
    _dropShortcutCache();
    expect(loadShortcuts()).toEqual(DEFAULT_BINDINGS);
  });

  it("恢复默认清掉存档", () => {
    saveShortcuts({ ...DEFAULT_BINDINGS, newSession: "Ctrl+Alt+J" });
    resetShortcuts();
    _dropShortcutCache();
    expect(loadShortcuts()).toEqual(DEFAULT_BINDINGS);
    expect(localStorage.getItem("aura-shortcuts")).toBeNull();
  });

  it("默认表覆盖全部动作且互不冲突", () => {
    for (const a of SHORTCUT_ACTIONS) {
      expect(validateBinding(a.id, a.default, DEFAULT_BINDINGS)).toBeNull();
    }
  });
});
