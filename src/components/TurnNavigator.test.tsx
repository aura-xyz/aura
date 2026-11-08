import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TurnNavigator from "./TurnNavigator";
import type { TurnItem } from "../lib/turnRail";

function items(n: number): TurnItem[] {
  return Array.from({ length: n }, (_, i) => ({
    turn: i + 1,
    prompt: `第 ${i + 1} 轮的问题内容`,
    response: `第 ${i + 1} 轮的回答`,
  }));
}

function mount(list: TurnItem[], activeTurn = 1) {
  const onNavigate = vi.fn();
  render(
    <TurnNavigator
      items={list}
      activeTurn={activeTurn}
      onNavigate={onNavigate}
    />,
  );
  return { onNavigate };
}

describe("右侧虚拟滚动时间线", () => {
  it("少于两轮时不渲染，不占消息区", () => {
    mount(items(1));
    expect(screen.queryByRole("navigation", { name: "对话轮次刻度" })).toBeNull();
  });

  it("长会话只渲染可见刻度，不把上千轮塞进 DOM", () => {
    mount(items(1000), 500);
    const marks = screen.getAllByRole("button", { name: /跳到第/ });
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.length).toBeLessThan(50);
  });

  it("当前轮次带 aria-current", () => {
    mount(items(5), 3);
    expect(screen.getByRole("button", { name: "跳到第 3 轮" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "跳到第 2 轮" }).getAttribute("aria-current")).toBeNull();
  });

  it("悬停展开轮次预览，hover 项与当前项同时高亮", () => {
    mount(items(6), 6);
    const rail = screen.getByRole("navigation", { name: "对话轮次刻度" }).parentElement!;
    fireEvent.pointerEnter(rail);
    const panel = screen.getByRole("listbox", { name: "对话时间线" });
    expect(panel).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(6);

    const second = screen.getAllByRole("option")[1];
    fireEvent.pointerEnter(second);
    // 当前项（第 6 轮）与 hover 项（第 2 轮）都要加粗
    const bold = screen.getAllByRole("option").filter((el) =>
      el.className.includes("font-semibold"),
    );
    expect(bold).toHaveLength(2);
  });

  it("点击刻度或预览行都跳到对应轮次", () => {
    const { onNavigate } = mount(items(4), 4);
    fireEvent.click(screen.getByRole("button", { name: "跳到第 2 轮" }));
    expect(onNavigate).toHaveBeenCalledWith(2);

    const rail = screen.getByRole("navigation", { name: "对话轮次刻度" }).parentElement!;
    fireEvent.pointerEnter(rail);
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(onNavigate).toHaveBeenLastCalledWith(1);
  });

  /// 面板中心必须与刻度轨中心重合。此前只写 top-1/2，上边缘落在中线上
  /// 导致整块下坠，看起来「消息列表上下没有居中」（实测反馈）。
  it("预览面板相对刻度轨垂直居中", () => {
    mount(items(6), 6);
    const rail = screen.getByRole("navigation", { name: "对话轮次刻度" }).parentElement!;
    fireEvent.pointerEnter(rail);
    const panel = screen.getByRole("listbox", { name: "对话时间线" });
    expect(panel.className).toContain("top-1/2");
    expect(panel.className).toContain("-translate-y-1/2");
  });

  it("指针离开后收起预览", () => {
    mount(items(4), 4);
    const rail = screen.getByRole("navigation", { name: "对话轮次刻度" }).parentElement!;
    fireEvent.pointerEnter(rail);
    expect(screen.getByRole("listbox", { name: "对话时间线" })).toBeInTheDocument();
    fireEvent.pointerLeave(rail);
    expect(screen.queryByRole("listbox", { name: "对话时间线" })).toBeNull();
  });
});
