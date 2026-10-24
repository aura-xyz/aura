import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// WorkspaceSelect 走 Tauri dialog；用 hoisted 保证工厂里能引用桩本体。
// open 返回一个固定目录，模拟「用户选了 E:/dev/picked」。
const { openMock } = vi.hoisted(() => ({
  openMock: vi.fn(async () => "E:/dev/picked"),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

import InputArea from "./InputArea";
import type { ModelInfo } from "../lib/api";
import type { Mode } from "../lib/mode";

function mount(overrides: Partial<Record<string, unknown>> = {}) {
  const props = {
    onSend: vi.fn(),
    onStop: vi.fn(),
    busy: false,
    models: [] as ModelInfo[],
    selectedModel: "",
    onModelChange: vi.fn(),
    mode: "chat" as Mode,
    onModeChange: vi.fn(),
    workspace: "E:/dev/aura",
    onWorkspaceChange: vi.fn(async () => {}),
    workspaceLocked: false,
    ...overrides,
  };
  return { props, ...render(<InputArea {...props} />) };
}

beforeEach(() => {
  openMock.mockClear();
});

describe("InputArea", () => {
  /// 未锁定时选择器照常工作：点它 → 弹目录选择 → 回传选中路径
  it("未锁定时可点击选择工作区", async () => {
    const { props } = mount();
    await userEvent.click(screen.getByRole("button", { name: /工作区/ }));
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(props.onWorkspaceChange).toHaveBeenCalledWith("E:/dev/picked");
  });

  /// v0.6.0：首条消息发出后工作区锁定，按钮整体隐藏（不是置灰）——
  /// 没有「改」这个操作了。隐藏比禁用少一分「其实可以但被拦住」的暗示。
  it("首条消息发出后隐藏工作区选择按钮", async () => {
    await mount({ workspaceLocked: true });
    expect(screen.queryByRole("button", { name: /工作区/ })).toBeNull();
  });

  /// 锁定只收掉选择器，不能顺带挡住发送——那会让对话进行到一半发不出消息
  it("锁定后仍可正常发送消息", async () => {
    const { props } = mount({ workspaceLocked: true });
    await userEvent.type(screen.getByRole("textbox"), "继续改");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(props.onSend).toHaveBeenCalledWith("继续改");
  });

  /// 没定工作区就发不出去：后端拿不到执行目录。这条钉住禁用态，
  /// 防止重构时把守卫弄丢（模型会在错误目录里读写文件）。
  it("未选择工作区时发送键禁用", async () => {
    const { props } = mount({ workspace: "" });
    const send = screen.getByRole("button", { name: "请先选择工作区" });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "hello");
    await userEvent.click(send);
    expect(props.onSend).not.toHaveBeenCalled();
  });

  /// Enter 发送、Shift+Enter 换行：既有契约，重构版式时不能弄丢
  it("Enter 发送，Shift+Enter 换行", async () => {
    const { props } = mount();
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "第一行");
    await userEvent.type(box, "{Shift>}{Enter}{/Shift}第二行");
    expect(props.onSend).not.toHaveBeenCalled();
    await userEvent.type(box, "{Enter}");
    expect(props.onSend).toHaveBeenCalledWith("第一行\n第二行");
  });

  /// 生成中点停止：停止按钮替换发送按钮，且带停止语义
  it("生成中显示停止按钮", async () => {
    const { props } = mount({ busy: true });
    await userEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
  });
});
