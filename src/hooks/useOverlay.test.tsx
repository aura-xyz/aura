import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_INPUT_EVENT } from "../lib/focusInput";
import {
  clearOverlays,
  closeTopOverlay,
  overlayStackSnapshot,
} from "../lib/overlayStack";
import { useOverlay } from "./useOverlay";

function Layer({ id, onClose }: { id: string; onClose: () => void }) {
  useOverlay(id, true, onClose);
  return <div data-testid={id} />;
}

beforeEach(() => {
  clearOverlays();
  document.body.innerHTML = "";
});

describe("useOverlay", () => {
  it("挂载即入栈，卸载即出栈", () => {
    const { unmount } = render(<Layer id="a" onClose={() => {}} />);
    expect(overlayStackSnapshot()).toEqual(["a"]);
    unmount();
    expect(overlayStackSnapshot()).toEqual([]);
  });

  it("关闭后把焦点还给打开前的触发元素", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const other = document.createElement("input");
    document.body.appendChild(other);
    const { unmount } = render(<Layer id="a" onClose={() => {}} />);
    other.focus(); // 模拟焦点被浮层抢走

    unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it("触发元素已卸载时回退到输入框聚焦事件", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const spy = vi.fn();
    window.addEventListener(FOCUS_INPUT_EVENT, spy);

    const { unmount } = render(<Layer id="a" onClose={() => {}} />);
    trigger.remove();
    unmount();

    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(FOCUS_INPUT_EVENT, spy);
  });

  it("onClose 取最新引用，父组件重渲染不会让栈失联", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Layer id="a" onClose={first} />);
    rerender(<Layer id="a" onClose={second} />);
    expect(overlayStackSnapshot()).toEqual(["a"]);
    // 栈里的回调应指向最新的 second
    closeTopOverlay();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
