import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
async function mount({ todos, mode }: { todos: unknown[]; mode: string }) {
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
    mode,
    deleteTodoStep: vi.fn(),
    addTodoStep: vi.fn(),
    setTodoStatus: vi.fn(),
  };
  vi.doMock("../store", () => ({ useStore: () => store }));
  const { default: RightPanel } = await import("./RightPanel");
  return render(<RightPanel />);
}

describe("RightPanel", () => {
  it("有清单且处于执行模式时显示", async () => {
    await mount({ todos: [{ id: "s1", title: "建表" }], mode: "build" });
    expect(screen.getByText("建表")).toBeInTheDocument();
  });

  it("规划模式下同样显示", async () => {
    await mount({ todos: [{ id: "s1", title: "调研" }], mode: "plan" });
    expect(screen.getByText("调研")).toBeInTheDocument();
  });

  /// 对话模式是纯问答，不涉及流程，**清单内容**不展示
  it("对话模式下不展示清单内容", async () => {
    await mount({ todos: [{ id: "s1", title: "不应出现" }], mode: "chat" });
    expect(screen.queryByText("不应出现")).toBeNull();
  });

  /// v0.6.3 用户实测反馈「右侧边栏没有显示」。
  /// 对话模式（最常见场景）下右侧整块消失＝用户以为应用没有右栏。
  /// 现在右侧**始终**留一条窄轨道。
  it("无清单时仍渲染窄轨道，不再整块消失", async () => {
    await mount({ todos: [], mode: "build" });
    expect(screen.getByRole("complementary", { name: "任务面板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开任务面板" })).toBeInTheDocument();
    expect(screen.getByText(/任务 0/)).toBeInTheDocument();
  });

  it("对话模式下同样保留窄轨道", async () => {
    await mount({ todos: [], mode: "chat" });
    expect(screen.getByRole("complementary", { name: "任务面板" })).toBeInTheDocument();
  });

  it("窄轨道可展开，无清单时给出空状态说明", async () => {
    await mount({ todos: [], mode: "build" });
    await userEvent.click(screen.getByRole("button", { name: "展开任务面板" }));
    expect(screen.getByText("当前会话没有任务清单")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起任务面板" })).toBeInTheDocument();
  });

  it("可收起为窄条，收起后仍能看到步骤数", async () => {
    await mount({
      todos: [
        { id: "s1", title: "建表" },
        { id: "s2", title: "写测试" },
      ],
      mode: "build",
    });
    await userEvent.click(screen.getByRole("button", { name: "收起任务面板" }));
    expect(screen.queryByText("建表")).toBeNull();
    expect(screen.getByRole("button", { name: "展开任务面板" })).toBeInTheDocument();
    expect(screen.getByText(/任务 2/)).toBeInTheDocument();
  });

  it("收起态可再次展开", async () => {
    await mount({ todos: [{ id: "s1", title: "建表" }], mode: "build" });
    await userEvent.click(screen.getByRole("button", { name: "收起任务面板" }));
    await userEvent.click(screen.getByRole("button", { name: "展开任务面板" }));
    expect(screen.getByText("建表")).toBeInTheDocument();
  });

  it("折叠偏好持久化到 localStorage", async () => {
    await mount({ todos: [{ id: "s1", title: "建表" }], mode: "build" });
    await userEvent.click(screen.getByRole("button", { name: "收起任务面板" }));
    expect(localStorage.getItem("aura-right-panel-collapsed")).toBe("1");
  });
});