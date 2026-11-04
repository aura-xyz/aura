import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RIGHTBAR_ANIM_MS, useRightbarTransition } from "./useRightbarTransition";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("右栏展开/收起过渡", () => {
  it("打开立即挂载；收起先播退出动画，动画结束才卸载", () => {
    const { result } = renderHook(() => useRightbarTransition());
    expect(result.current.shown).toBe(false);

    act(() => result.current.open());
    expect(result.current.shown).toBe(true);
    expect(result.current.closing).toBe(false);

    act(() => result.current.close());
    expect(result.current.shown).toBe(true);
    expect(result.current.closing).toBe(true, "动画期间必须仍挂载，否则看不到退出动画");

    act(() => vi.advanceTimersByTime(RIGHTBAR_ANIM_MS));
    expect(result.current.shown).toBe(false);
    expect(result.current.closing).toBe(false);
  });

  it("收起动画途中重新打开会取消这次卸载", () => {
    const { result } = renderHook(() => useRightbarTransition());
    act(() => result.current.open());
    act(() => result.current.close());
    act(() => result.current.open());
    act(() => vi.advanceTimersByTime(RIGHTBAR_ANIM_MS + 50));

    expect(result.current.shown).toBe(true);
    expect(result.current.closing).toBe(false);
  });
});
