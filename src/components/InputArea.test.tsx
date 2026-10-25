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
import { loadInputDraft } from "../lib/draft";

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
    sessionId: "s1",
    lastUserMessage: undefined as string | undefined,
    ...overrides,
  };
  return { props, ...render(<InputArea {...props} />) };
}

beforeEach(() => {
  openMock.mockClear();
  localStorage.clear();
});

describe("InputArea", () => {
  /// 未锁定时选择器照常工作：点它 → 弹目录选择 → 回传选中路径
  it("未锁定时可点击选择工作区", async () => {
    const { props } = mount();
    await userEvent.click(screen.getByRole("button", { name: /工作区/ }));
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(props.onWorkspaceChange).toHaveBeenCalledWith("E:/dev/picked");
  });

  /// v0.6.2：工作区按钮移到模型 Tab 旁边。
  ///
  /// 两者都是「这次任务在哪儿、用什么」，分散在两行要来回扫。
  /// 用「同一个父容器」断言，比断言坐标稳。
  it("工作区选择与模型选择在同一行", async () => {
    mount({
      models: [
        {
          key: "m1",
          id: "m1",
          label: "某模型",
          provider: "p",
          provider_name: "厂商",
          context_limit: 100,
          pinned: true,
        },
      ] as ModelInfo[],
      selectedModel: "m1",
    });
    const ws = screen.getByRole("button", { name: /工作区/ });
    const model = screen.getByRole("button", { name: "选择模型" });
    // 两者必须在**同一个直接父容器**里（即同一个右侧组）。
    // WorkspaceSelect 直接返回 button，ModelSelect 外包一层 div，
    // 所以要比「button 的父元素」而不是固定层数。
    const wsGroup = ws.parentElement;
    const modelGroup = model.parentElement?.parentElement;
    expect(wsGroup).toBe(modelGroup);
    // 工作区已绑定时显示的是目录名（aura），不是「选择工作区」
    expect(wsGroup?.textContent).toContain("aura");
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

  /// v0.6.3：输入框内容按会话隔离保存。此前是组件内 useState，
  /// 切换对话即丢——用户在几个对话间来回切时写了一半的话一去不回。
  it("切换会话时各自保留草稿", async () => {
    const a = mount({ sessionId: "s1" });
    await userEvent.type(screen.getByRole("textbox"), "给 s1 的话");
    a.unmount();

    const b = mount({ sessionId: "s2" });
    expect(screen.getByRole("textbox")).toHaveValue("");
    await userEvent.type(screen.getByRole("textbox"), "给 s2 的话");
    b.unmount();

    // 回到 s1：草稿应原样还在
    mount({ sessionId: "s1" });
    expect(screen.getByRole("textbox")).toHaveValue("给 s1 的话");
  });

  /// 发送后清空当前会话草稿，否则下次切回来又是已发送的内容
  it("发送后清空草稿", async () => {
    mount({ sessionId: "s1" });
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "要发出去的话");
    await userEvent.type(box, "{Enter}");
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(loadInputDraft("s1")).toBe("");
  });

  /// 上方向键召回：仅在输入框为空时生效。非空时方向键要留给光标移动，
  /// 抢过来用户就无法编辑中间内容了。
  it("空输入框按上方向键召回上一条消息", async () => {
    mount({ lastUserMessage: "上次问的问题" });
    await userEvent.type(screen.getByRole("textbox"), "{ArrowUp}");
    expect(screen.getByRole("textbox")).toHaveValue("上次问的问题");
  });

  it("输入框非空时上方向键不抢光标", async () => {
    mount({ lastUserMessage: "上次问的问题" });
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "abc");
    await userEvent.type(box, "{ArrowUp}");
    expect(screen.getByRole("textbox")).toHaveValue("abc");
  });

  /// 令牌计数口径必须与后端一致（lib/tokens.ts 抄的是 context.rs 的实现），
  /// 两处数字对不上会让用户以为估算坏了。
  it("有内容时显示 token 计数，空输入框不显示", async () => {
    mount({ sessionId: "s1" });
    expect(screen.queryByText(/tokens/)).toBeNull();

    await userEvent.type(screen.getByRole("textbox"), "hello");
    // hello：5 个非 CJK 字符 → 5/4=1 + 1 = 2
    expect(screen.getByText("约 2 tokens")).toBeInTheDocument();
  });

  it("中文按每字 1 token 计", async () => {
    mount({ sessionId: "s1" });
    await userEvent.type(screen.getByRole("textbox"), "你好世界");
    expect(screen.getByText("约 5 tokens")).toBeInTheDocument();
  });
});

/**
 * @ 文件引用 / / 技能调用（v0.7.0）。
 *
 * 关键契约：**浮层开着时回车是「选中」，不是「发送」**。
 * 弄错这一步的后果很直接：用户想选个文件，结果把半句话发出去了。
 */
describe("InputArea 的 @ / 触发", () => {
  const { filesMock, skillsMock } = vi.hoisted(() => ({
    filesMock: vi.fn(async () => [
      { path: "src/store.tsx", name: "store.tsx", dir: "src" },
    ]),
    skillsMock: vi.fn(async () => [
      {
        name: "docx",
        description: "处理 Word 文档",
        version: "1",
        source: "builtin" as const,
        allowed_tools: [],
        enabled: true,
        dir: "",
        path: "",
      },
    ]),
  }));
  vi.mock("../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
    return {
      ...actual,
      listWorkspaceFiles: filesMock,
      listSkills: skillsMock,
    };
  });

  beforeEach(() => {
    filesMock.mockClear();
    skillsMock.mockClear();
  });

  it("打 @ 后浮层出现在输入框上方并列出文件", async () => {
    mount({ sessionId: "s1" });
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "@");

    expect(await screen.findByText("store.tsx")).toBeInTheDocument();
    // 浮层在输入卡片之前（DOM 顺序上「上方」）
    const menu = screen.getByRole("listbox", { name: "文件引用" });
    const card = box.closest("div.rounded-card");
    expect(
      menu.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("选中文件后把路径插入输入框", async () => {
    mount({ sessionId: "s1" });
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "@");
    await userEvent.click(await screen.findByText("store.tsx"));
    expect(box).toHaveValue("@<src/store.tsx> ");
  });

  it("浮层开着时回车是选中而不是发送", async () => {
    const { props } = mount({ sessionId: "s1" });
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "@");
    await screen.findByText("store.tsx");
    await userEvent.type(box, "{Enter}");
    expect(props.onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("@<src/store.tsx> ");
  });

  it("打 / 列出已启用的技能并插入技能名", async () => {
    mount({ sessionId: "s1" });
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "/doc");
    expect(await screen.findByText("docx")).toBeInTheDocument();
    await userEvent.click(screen.getByText("docx"));
    expect(box).toHaveValue("/docx ");
  });

  it("Esc 关闭浮层，不影响已输入的文字", async () => {
    mount({ sessionId: "s1" });
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "@");
    await screen.findByText("store.tsx");
    await userEvent.type(box, "{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box).toHaveValue("@");
  });
});
