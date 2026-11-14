import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpResourceReadView, McpResourceView } from "../lib/mcp";
import McpResourcePanel from "./McpResourcePanel";

const { listMock, readMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  readMock: vi.fn(),
}));

vi.mock("../lib/mcp", async () => {
  const actual = await vi.importActual<typeof import("../lib/mcp")>("../lib/mcp");
  return { ...actual, listResources: listMock, readResource: readMock };
});

const ITEMS: McpResourceView[] = [
  {
    uri: "file:///ws/a.txt",
    name: "说明文件",
    description: "",
    mime_type: "text/plain",
    template: false,
  },
  {
    uri: "db://{table}",
    name: "表模板",
    description: "",
    mime_type: null,
    template: true,
  },
];

const READ: McpResourceReadView = {
  uri: "file:///ws/a.txt",
  text: "资源正文",
  mime_type: "text/plain",
  truncated: false,
  total_bytes: 12,
  blob_bytes: 0,
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue(ITEMS);
  readMock.mockReset().mockResolvedValue(READ);
});

describe("McpResourcePanel", () => {
  it("打开即拉取清单并列出资源", async () => {
    render(<McpResourcePanel serverId={7} sessionId="s1" supported />);
    expect(await screen.findByText("说明文件")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith(7);
    expect(screen.getByText("2 条")).toBeInTheDocument();
  });

  it("URI 模板只展示不可点击", async () => {
    render(<McpResourcePanel serverId={7} sessionId="s1" supported />);
    const template = await screen.findByRole("button", { name: /表模板/ });
    expect(template).toBeDisabled();
  });

  it("点击资源读取内容并显示预览", async () => {
    render(<McpResourcePanel serverId={7} sessionId="s1" supported />);
    await userEvent.click(await screen.findByRole("button", { name: /说明文件/ }));
    expect(readMock).toHaveBeenCalledWith(7, "file:///ws/a.txt", "s1");
    expect(await screen.findByText("资源正文")).toBeInTheDocument();
  });

  it("截断与二进制数据都给出明确提示", async () => {
    readMock.mockResolvedValue({
      ...READ,
      truncated: true,
      total_bytes: 5 * 1024 * 1024,
      blob_bytes: 2048,
    });
    render(<McpResourcePanel serverId={7} sessionId="s1" supported />);
    await userEvent.click(await screen.findByRole("button", { name: /说明文件/ }));
    expect(await screen.findByText(/内容已截断/)).toHaveTextContent("5.00 MB");
    expect(screen.getByText(/二进制数据/)).toBeInTheDocument();
  });

  it("刷新按钮重新拉取清单", async () => {
    render(<McpResourcePanel serverId={7} sessionId="s1" supported />);
    await screen.findByText("说明文件");
    await userEvent.click(screen.getByRole("button", { name: "刷新资源" }));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it("服务器未声明 resources 能力时给出说明", async () => {
    render(<McpResourcePanel serverId={7} sessionId="s1" supported={false} />);
    expect(await screen.findByText(/未声明 resources 能力/)).toBeInTheDocument();
  });

  it("拉取失败显示错误而不是空白", async () => {
    listMock.mockRejectedValueOnce("服务器未连接");
    render(<McpResourcePanel serverId={7} sessionId="s1" supported />);
    expect(await screen.findByText("服务器未连接")).toBeInTheDocument();
  });
});
