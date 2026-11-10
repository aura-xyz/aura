import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTodos } from "../lib/todo";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.doUnmock("../store");
});

/**
 * RightPanel 依赖 store，这里 mock 掉 useStore 而不是渲染真实 Provider。
 * 真实 Provider 会拉起 Tauri 的 invoke/listen，在单测里没有意义。
 */
async function mount(todos: unknown[]) {
  const store = {
    sessions: [
      {
        id: "s1",
        title: "t",
        workspace: "/",
        messages: [],
        todos: normalizeTodos(todos),
      },
    ],
    activeId: "s1",
    deleteTodoStep: vi.fn(),
    addTodoStep: vi.fn(),
    setTodoStatus: vi.fn(),
  };
  vi.doMock("../store", () => ({ useStore: () => store }));
  const { default: RightPanel } = await import("./RightPanel");
  return render(<RightPanel />);
}

describe("右栏任务面板内容体", () => {
  it("有清单时直接展示清单，不再受 chat 模式限制", async () => {
    await mount([{ id: "s1", title: "建表" }]);
    expect(screen.getByText("建表")).toBeInTheDocument();
  });

  it("无清单时给出空状态说明", async () => {
    await mount([]);
    expect(screen.getByText("当前会话没有任务清单")).toBeInTheDocument();
    expect(screen.getByText(/切到 Plan \/ Build 模式/)).toBeInTheDocument();
  });

  /// 实测反馈：说明文字左对齐、且因为旧 aside 固定 w-64，在更宽的右栏里
  /// 看起来整体偏左。改成 flex 居中 + w-full 后必须钉住这三个类。
  it("空状态整块水平垂直居中，宽度跟随右栏", async () => {
    const { container } = await mount([]);
    const empty = container.querySelector('[aria-label="任务面板"]');
    expect(empty).not.toBeNull();
    for (const token of ["w-full", "items-center", "justify-center", "text-center"]) {
      expect(empty?.className).toContain(token);
    }
    expect(empty?.className).not.toContain("w-64");
    expect(empty?.className).not.toContain("border-l");
  });

  /// 实测反馈：右栏拖窄后露出旧侧边栏的 PanelRight 按钮与竖排「任务」文字。
  /// 外壳已全部交给 App.tsx，这里不能再有 aside / 展开收起按钮 / 竖排标签。
  it("不残留旧侧边栏外壳与按钮", async () => {
    const { container } = await mount([]);
    expect(container.querySelector("aside")).toBeNull();
    expect(screen.queryByRole("button", { name: "展开任务面板" })).toBeNull();
    expect(screen.queryByRole("button", { name: "收起任务面板" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "任务面板" })).toBeNull();
    expect(screen.queryByText(/任务 0/)).toBeNull();
    expect(container.querySelector("[style*='vertical-rl']")).toBeNull();
    expect(localStorage.getItem("aura-right-panel-collapsed")).toBeNull();
  });
});
