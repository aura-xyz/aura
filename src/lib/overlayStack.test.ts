import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOverlays,
  closeTopOverlay,
  hasOverlays,
  overlayStackSnapshot,
  peekOverlayId,
  pushOverlay,
  subscribeOverlayStack,
} from "./overlayStack";

beforeEach(() => clearOverlays());

describe("全局浮层栈", () => {
  it("后进先出，closeTop 只调最上层的 close", () => {
    const a = vi.fn();
    const b = vi.fn();
    pushOverlay("a", a);
    pushOverlay("b", b);
    expect(overlayStackSnapshot()).toEqual(["a", "b"]);
    expect(peekOverlayId()).toBe("b");

    expect(closeTopOverlay()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(overlayStackSnapshot()).toEqual(["a"]);

    expect(closeTopOverlay()).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(hasOverlays()).toBe(false);
    expect(closeTopOverlay()).toBe(false);
  });

  it("同 id 重复注册视为重新置顶，不叠两层", () => {
    pushOverlay("a", () => {});
    pushOverlay("b", () => {});
    pushOverlay("a", () => {});
    expect(overlayStackSnapshot()).toEqual(["b", "a"]);
    expect(peekOverlayId()).toBe("a");
  });

  it("注销器只移除自己，且不误删同 id 的新一层", () => {
    const off = pushOverlay("a", () => {});
    pushOverlay("b", () => {});
    off();
    expect(overlayStackSnapshot()).toEqual(["b"]);
  });

  it("栈变化时通知订阅者", () => {
    const spy = vi.fn();
    const un = subscribeOverlayStack(spy);
    const off = pushOverlay("a", () => {}); // push
    off(); // unregister
    expect(spy).toHaveBeenCalledTimes(2);
    un();
  });

  it("close 里若同步卸载组件，注销器不会误删新压入的浮层", () => {
    let offA: () => void = () => {};
    offA = pushOverlay("a", () => {
      // 模拟 close 触发的卸载
      offA();
      pushOverlay("c", () => {});
    });
    pushOverlay("b", () => {});
    expect(closeTopOverlay()).toBe(true); // 关 b
    expect(closeTopOverlay()).toBe(true); // 关 a，close 内压入 c
    expect(overlayStackSnapshot()).toEqual(["c"]);
  });
});
