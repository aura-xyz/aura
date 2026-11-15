import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearOverlays } from "../lib/overlayStack";
import McpMarketDialog from "./McpMarketDialog";

const { listMock, installMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  installMock: vi.fn(),
}));

vi.mock("../lib/mcp", () => ({
  marketList: listMock,
  marketInstall: installMock,
}));

const ITEMS = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "读写本地文件",
    command: "npx",
    args: ["-y", "x"],
    server_url: "",
    source: "builtin",
  },
  {
    id: "remote",
    name: "Remote",
    description: "远程服务",
    command: "",
    args: [],
    server_url: "https://mcp.example.com/mcp",
    source: "remote",
  },
];

beforeEach(() => {
  clearOverlays();
  listMock.mockReset().mockResolvedValue(ITEMS);
  installMock.mockReset().mockResolvedValue({ id: 1 });
});

describe("McpMarketDialog", () => {
  it("打开即列出市场条目", async () => {
    render(<McpMarketDialog onClose={vi.fn()} onInstalled={vi.fn()} />);
    expect(await screen.findByText("Filesystem")).toBeInTheDocument();
    expect(screen.getByText("Remote")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("安装必须二次确认，确认后回调刷新", async () => {
    const onInstalled = vi.fn();
    const onClose = vi.fn();
    render(
      <McpMarketDialog onClose={onClose} onInstalled={onInstalled} />,
    );
    await screen.findByText("Filesystem");
    await userEvent.click(screen.getAllByRole("button", { name: "安装" })[0]);
    expect(screen.getByTestId("mcp-market-confirm")).toBeInTheDocument();
    expect(screen.getByText(/默认禁用、严格策略/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "确认安装" }));
    await waitFor(() =>
      expect(installMock).toHaveBeenCalledWith("filesystem"),
    );
    expect(onInstalled).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("取消二次确认不会发起安装", async () => {
    render(<McpMarketDialog onClose={vi.fn()} onInstalled={vi.fn()} />);
    await screen.findByText("Filesystem");
    await userEvent.click(screen.getAllByRole("button", { name: "安装" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByTestId("mcp-market-confirm")).not.toBeInTheDocument();
    expect(installMock).not.toHaveBeenCalled();
  });
});
