import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * store 只提供这几个动作，其余按需 mock。
 * resendFrom 是被测重点：它必须带着正确的 (userIndex, 内容) 被调用。
 */
const { resendMock, beginEditMock } = vi.hoisted(() => ({
  resendMock: vi.fn(),
  beginEditMock: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: () => ({
    activeSession: { messages: currentMessages },
    busy: false,
    resendFrom: resendMock,
    beginEdit: beginEditMock,
  }),
}));

import MessageList from "./MessageList";
import type { ChatMessage } from "../store";

let currentMessages: ChatMessage[] = [];

function user(content: string): ChatMessage {
  return { id: `u-${content}`, role: "user", content };
}

function assistant(content: string): ChatMessage {
  return {
    id: `a-${content}`,
    role: "assistant",
    blocks: [{ kind: "text", text: content }],
  };
}

beforeEach(() => {
  resendMock.mockReset();
  beginEditMock.mockReset();
  currentMessages = [user("第一个问题"), assistant("第一个回答"), user("第二个问题"), assistant("第二个回答")];
});

describe("MessageList 重新生成", () => {
  it("点「重新生成」带该回答对应的用户序号与原问题", async () => {
    render(<MessageList />);
    const btns = screen.getAllByRole("button", { name: "重新生成本条回复" });
    expect(btns).toHaveLength(2);

    await userEvent.click(btns[1]); // 第 2 条回答 ← u2
    expect(resendMock).toHaveBeenCalledWith(2, "第二个问题");
  });

  it("第 1 条回答对应第 1 条用户消息", async () => {
    render(<MessageList />);
    await userEvent.click(screen.getAllByRole("button", { name: "重新生成本条回复" })[0]);
    expect(resendMock).toHaveBeenCalledWith(1, "第一个问题");
  });

  it("重新生成走的是「回滚 + 重发」，内容是原问题", async () => {
    render(<MessageList />);
    await userEvent.click(screen.getAllByRole("button", { name: "重新生成本条回复" })[0]);
    await waitFor(() => expect(resendMock).toHaveBeenCalledTimes(1));
    // 传的是原问题文本，不是空串
    expect(resendMock.mock.calls[0][1]).toBe("第一个问题");
  });
});

describe("MessageList 编辑", () => {
  it("点「编辑」带该用户消息的序号与原文", async () => {
    render(<MessageList />);
    const btns = screen.getAllByRole("button", { name: "编辑这条消息" });
    expect(btns).toHaveLength(2);

    await userEvent.click(btns[1]); // 第 2 条用户消息
    expect(beginEditMock).toHaveBeenCalledWith(2, "第二个问题");
  });

  it("第 1 条用户消息的序号是 1", async () => {
    render(<MessageList />);
    await userEvent.click(screen.getAllByRole("button", { name: "编辑这条消息" })[0]);
    expect(beginEditMock).toHaveBeenCalledWith(1, "第一个问题");
  });
});
