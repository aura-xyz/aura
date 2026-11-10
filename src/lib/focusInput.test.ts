import { describe, expect, it, vi } from "vitest";
import { FOCUS_INPUT_EVENT, focusInput, onFocusInput } from "./focusInput";

describe("focusInput", () => {
  it("派发事件通知订阅者，注销后不再通知", () => {
    const spy = vi.fn();
    const un = onFocusInput(spy);
    focusInput();
    expect(spy).toHaveBeenCalledTimes(1);
    un();
    focusInput();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("事件名稳定，InputArea 靠它订阅", () => {
    expect(FOCUS_INPUT_EVENT).toBe("aura:focus-input");
  });
});
