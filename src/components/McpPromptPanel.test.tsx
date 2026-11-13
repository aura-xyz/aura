import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpPromptView } from "../lib/mcp";
import McpPromptPanel from "./McpPromptPanel";

const { listMock, getMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock("../lib/mcp", async () => {
  const actual = await vi.importActual<typeof import("../lib/mcp")>("../lib/mcp");
  return { ...actual, listPrompts: listMock, getPrompt: getMock };
});

const ITEMS: McpPromptView[] = [
  {
    name: "summary",
    description: "总结当前文件",
    arguments: [],
  },
  {
    name: "review",
    description: "代码评审",
    arguments: [{ name: "path", description: "路径", required: true }],
  },
];

beforeEach(() => {
  listMock.mockReset().mockResolvedValue(ITEMS);
  getMock.mockReset().mockResolvedValue([
    { role: "user", text: "展开后的提示词正文" },
  ]);
});

describe("McpPromptPanel", () => {
  it("打开即拉取清单", async () => {
    render(<McpPromptPanel serverId={7} sessionId="s1" supported />);
    expect(await screen.findByText("summary")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith(7);
    expect(screen.getByText("2 条")).toBeInTheDocument();
  });

  it("无参数提示词点击后直接展开预览", async () => {
    render(<McpPromptPanel serverId={7} sessionId="s1" supported />);
    await userEvent.click(await screen.findByText("summary"));
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(7, "summary", {}, "s1"),
    );
    expect(await screen.findByText("展开后的提示词正文")).toBeInTheDocument();
  });

  it("带参数提示词先填写再展开", async () => {
    render(<McpPromptPanel serverId={7} sessionId="s1" supported />);
    await userEvent.click(await screen.findByText("review"));
    const input = screen.getByRole("textbox", { name: "review 的 path" });
    await userEvent.type(input, "src/a.ts");
    await userEvent.click(screen.getByRole("button", { name: "展开预览" }));
    expect(getMock).toHaveBeenCalledWith(7, "review", { path: "src/a.ts" }, "s1");
  });

  it("服务器未声明 prompts 能力时给出说明", async () => {
    render(<McpPromptPanel serverId={7} sessionId="s1" supported={false} />);
    expect(await screen.findByText(/未声明 prompts 能力/)).toBeInTheDocument();
  });

  it("刷新按钮重新拉取", async () => {
    render(<McpPromptPanel serverId={7} sessionId="s1" supported />);
    await screen.findByText("summary");
    await userEvent.click(screen.getByRole("button", { name: "刷新提示词" }));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });
});
