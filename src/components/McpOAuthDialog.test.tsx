import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearOverlays } from "../lib/overlayStack";
import type { McpServerView } from "../lib/mcp";
import McpOAuthDialog from "./McpOAuthDialog";

const { beginMock, completeMock, refreshMock, clearMock, openMock } = vi.hoisted(
  () => ({
    beginMock: vi.fn(),
    completeMock: vi.fn(),
    refreshMock: vi.fn(),
    clearMock: vi.fn(),
    openMock: vi.fn(),
  }),
);

vi.mock("../lib/mcp", () => ({
  oauthBegin: beginMock,
  oauthComplete: completeMock,
  oauthRefresh: refreshMock,
  oauthClear: clearMock,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openMock }));

const SERVER: McpServerView = {
  id: 7,
  name: "remote",
  command: "",
  args: [],
  enabled: true,
  status: "running",
  status_reason: null,
  tool_count: 0,
  workspaces: [],
  policy: {
    trust_level: "strict",
    auto_reconnect: false,
    tool_limit: 50,
    concurrent: false,
  },
  remote: {
    server_url: "https://mcp.example.com/mcp",
    auth_mode: "oauth",
    oauth_client_id: "aura",
  },
  has_token: false,
};

beforeEach(() => {
  clearOverlays();
  beginMock.mockReset().mockResolvedValue({
    authorize_url: "https://auth.example.com/authorize?state=S1",
    state: "S1",
    redirect_uri: "http://127.0.0.1:18741/callback",
  });
  completeMock.mockReset().mockResolvedValue(SERVER);
  refreshMock.mockReset().mockResolvedValue(SERVER);
  clearMock.mockReset().mockResolvedValue(SERVER);
  openMock.mockReset().mockResolvedValue(undefined);
});

describe("McpOAuthDialog", () => {
  it("打开即生成并展示授权地址", async () => {
    render(
      <McpOAuthDialog server={SERVER} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    await waitFor(() => expect(beginMock).toHaveBeenCalledWith(7));
    expect(screen.getByRole("textbox", { name: "授权地址" })).toHaveValue(
      "https://auth.example.com/authorize?state=S1",
    );
  });

  it("填写 code 后完成授权，原样回传 state", async () => {
    const onDone = vi.fn();
    render(
      <McpOAuthDialog server={SERVER} onClose={vi.fn()} onDone={onDone} />,
    );
    await screen.findByRole("textbox", { name: "授权地址" });
    await userEvent.type(screen.getByRole("textbox", { name: "授权码" }), "CODE");
    await userEvent.click(screen.getByRole("button", { name: "完成授权" }));
    await waitFor(() =>
      expect(completeMock).toHaveBeenCalledWith(7, "CODE", "S1"),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("已授权时可刷新与撤销，凭据不出现在界面", async () => {
    render(
      <McpOAuthDialog
        server={{ ...SERVER, has_token: true }}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    await screen.findByRole("textbox", { name: "授权地址" });
    expect(screen.getByText(/已保存凭据/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "撤销授权" }));
    await waitFor(() => expect(clearMock).toHaveBeenCalledWith(7));
    await userEvent.click(screen.getByRole("button", { name: "刷新凭据" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledWith(7));
  });
});
