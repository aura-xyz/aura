import { describe, expect, it } from "vitest";
import { isDevtoolsShortcut, shouldBlockDevtools, type KeyLike } from "./devtools";

function key(partial: Partial<KeyLike> = {}): KeyLike {
  return { key: "a", ctrlKey: false, shiftKey: false, metaKey: false, ...partial };
}

describe("正式版开发者工具快捷键", () => {
  it("识别 F12 与三套检查/控制台快捷键", () => {
    expect(isDevtoolsShortcut(key({ key: "F12" }))).toBe(true);
    for (const k of ["i", "j", "c"]) {
      expect(isDevtoolsShortcut(key({ key: k, ctrlKey: true, shiftKey: true }))).toBe(true);
      expect(isDevtoolsShortcut(key({ key: k, metaKey: true, shiftKey: true }))).toBe(true);
    }
  });

  it("不误伤正常快捷键：Ctrl+C / Ctrl+Shift+N / Ctrl+I", () => {
    expect(isDevtoolsShortcut(key({ key: "c", ctrlKey: true }))).toBe(false);
    expect(isDevtoolsShortcut(key({ key: "n", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isDevtoolsShortcut(key({ key: "i", ctrlKey: true }))).toBe(false);
    expect(isDevtoolsShortcut(key({ key: "F5" }))).toBe(false);
  });

  /// 关键契约：`pnpm tauri dev` 必须还能开 devtools。
  it("正式版拦截，开发模式一律放行", () => {
    const f12 = key({ key: "F12" });
    expect(shouldBlockDevtools(true, f12)).toBe(true);
    expect(shouldBlockDevtools(false, f12)).toBe(false);
    expect(shouldBlockDevtools(false, key({ key: "i", ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
