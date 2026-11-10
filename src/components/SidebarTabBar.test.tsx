import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SidebarTabBar from "./SidebarTabBar";
import type { SidebarTab } from "../lib/sidebarTabs";

const TABS: SidebarTab[] = [
  { id: "tab1", kind: "start", contentId: "sidebar://start", title: "开始页" },
  { id: "tab2", kind: "terminal", contentId: "terminal:t1", title: "终端 1" },
  { id: "tab3", kind: "web", contentId: "web:x", title: "新标签页" },
];

function mount(overrides: Partial<React.ComponentProps<typeof SidebarTabBar>> = {}) {
  const props = {
    tabs: TABS,
    activeId: "tab2",
    canClose: () => true,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    ...overrides,
  };
  render(<SidebarTabBar {...props} />);
  return props;
}

beforeEach(() => {
  localStorage.clear();
});

describe("右栏标签栏", () => {
  it("每个标签一个 tab，当前标签被标记为选中", () => {
    mount();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
  });

  it("点标签触发激活", () => {
    const props = mount();
    fireEvent.click(screen.getByText("新标签页"));
    expect(props.onActivate).toHaveBeenCalledWith("tab3");
  });

  it("点关闭按钮只关自己，不连带切标签", () => {
    const props = mount();
    fireEvent.click(screen.getByRole("button", { name: "关闭 终端 1" }));
    expect(props.onClose).toHaveBeenCalledWith("tab2");
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it("不可关闭的标签不渲染关闭按钮", () => {
    mount({ canClose: (id: string) => id !== "tab2" });
    expect(screen.queryByRole("button", { name: "关闭 终端 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "关闭 开始页" })).toBeInTheDocument();
  });

  it("方向键在标签间循环移动焦点", () => {
    mount({ activeId: "tab1" });
    const tabs = screen.getAllByRole("tab");
    // 第一项按左键回到最后一项
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(tabs[2]).toHaveFocus();
    fireEvent.keyDown(tabs[2], { key: "ArrowRight" });
    expect(tabs[0]).toHaveFocus();
  });

  it("Home / End 跳到首尾", () => {
    mount({ activeId: "tab2" });
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(tabs[2]).toHaveFocus();
    fireEvent.keyDown(tabs[2], { key: "Home" });
    expect(tabs[0]).toHaveFocus();
  });

  it("中键关闭标签", () => {
    const props = mount();
    // testing-library 没有 auxClick，用原生事件触发（React 监听的正是它）
    fireEvent(
      screen.getByText("终端 1"),
      new MouseEvent("auxclick", { button: 1, buttons: 0, bubbles: true }),
    );
    expect(props.onClose).toHaveBeenCalledWith("tab2");
  });

  it("另一个鼠标键还按着时中键不关闭", () => {
    const props = mount();
    fireEvent(
      screen.getByText("终端 1"),
      new MouseEvent("auxclick", { button: 1, buttons: 1, bubbles: true }),
    );
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("「+」菜单里选一种就新建对应标签", () => {
    const props = mount();
    fireEvent.click(screen.getByRole("button", { name: "新建标签" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "终端" }));
    expect(props.onNew).toHaveBeenCalledWith("terminal");
  });

  it("右侧插槽里的控件照常渲染", () => {
    mount({ trailing: <button type="button">关闭面板</button> });
    expect(screen.getByRole("button", { name: "关闭面板" })).toBeInTheDocument();
  });
});
