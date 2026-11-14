import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _dropShortcutCache, resetShortcuts } from "../lib/shortcuts";
import ShortcutsSection from "./ShortcutsSection";

/** 录制态监听在 window 的捕获阶段，事件必须真的派发到 window。 */
function press(over: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...over,
      }),
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  resetShortcuts();
  _dropShortcutCache();
});

describe("快捷键设置分区", () => {
  it("列出全部可配置动作与默认键位", () => {
    render(<ShortcutsSection />);
    expect(screen.getByText("新建对话")).toBeInTheDocument();
    expect(screen.getByText("打开 / 返回设置")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+N")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+M")).toBeInTheDocument();
  });

  it("点击更改进入录制态，按下组合键后立即保存", async () => {
    render(<ShortcutsSection />);
    await userEvent.click(screen.getAllByRole("button", { name: "更改" })[0]);
    expect(screen.getByText("请按下组合键…")).toBeInTheDocument();

    press({ code: "KeyJ", key: "j", ctrlKey: true, altKey: true });
    await waitFor(() => {
      expect(screen.getByText("Ctrl+Alt+J")).toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("立即生效");
    expect(JSON.parse(localStorage.getItem("aura-shortcuts") ?? "{}").newSession).toBe("Ctrl+Alt+J");
  });

  it("撞键时给出冲突项名称、不写入存档，也不会误触发全局动作", async () => {
    // 模拟 App 挂在 window 冒泡阶段的全局监听器：录制 Ctrl+K 时不能把
    // 命令面板一起打开，否则「录一次键 = 顺手执行一个动作」。
    const globalSpy = vi.fn();
    window.addEventListener("keydown", globalSpy);
    try {
      render(<ShortcutsSection />);
      await userEvent.click(screen.getAllByRole("button", { name: "更改" })[0]);
      press({ code: "KeyK", key: "k", ctrlKey: true });
      expect(globalSpy).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("命令面板");
      // 仍在录制态，允许直接换一个组合；键位没有被写进存档
      expect(screen.getByText("请按下组合键…")).toBeInTheDocument();
      expect(localStorage.getItem("aura-shortcuts")).toBeNull();
    } finally {
      window.removeEventListener("keydown", globalSpy);
    }
  });

  it("Esc 取消录制，不会改动键位", async () => {
    render(<ShortcutsSection />);
    await userEvent.click(screen.getAllByRole("button", { name: "更改" })[0]);
    press({ code: "Escape", key: "Escape" });
    expect(screen.queryByText("请按下组合键…")).toBeNull();
    expect(screen.getByText("Ctrl+N")).toBeInTheDocument();
  });

  it("恢复默认清掉自定义键位", async () => {
    render(<ShortcutsSection />);
    await userEvent.click(screen.getAllByRole("button", { name: "更改" })[0]);
    press({ code: "KeyJ", key: "j", ctrlKey: true, altKey: true });
    await waitFor(() => expect(screen.getByText("Ctrl+Alt+J")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(screen.getByText("Ctrl+N")).toBeInTheDocument();
    expect(screen.queryByText("Ctrl+Alt+J")).toBeNull();
    expect(localStorage.getItem("aura-shortcuts")).toBeNull();
  });
});
