import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SecuritySection from "./SecuritySection";
import type { SecurityEvent } from "../lib/api";

const {
  listMock,
  exportMock,
  getPolicyMock,
  setPolicyMock,
  saveMock,
  notifyMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  exportMock: vi.fn(),
  getPolicyMock: vi.fn(),
  setPolicyMock: vi.fn(),
  saveMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  listSecurityEvents: listMock,
  securityExportEvents: exportMock,
  getApprovalPolicy: getPolicyMock,
  setApprovalPolicy: setPolicyMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: saveMock }));
vi.mock("../lib/notices", () => ({ notify: notifyMock }));

function ev(over: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: 1,
    ts_ms: new Date("2026-11-09T10:00:00").getTime(),
    session_id: "s1",
    kind: "blocked_command",
    subject: "rm -rf /",
    reason: "递归删除根目录",
    rule_id: "cmd_rm_root",
    ...over,
  };
}

describe("SecuritySection", () => {
  beforeEach(() => {
    listMock.mockReset().mockResolvedValue([]);
    exportMock.mockReset();
    getPolicyMock.mockReset().mockResolvedValue({
      policy: "dangerous",
      label: "仅危险命令询问",
      scope: "global",
    });
    setPolicyMock.mockReset().mockResolvedValue(undefined);
    saveMock.mockReset();
    notifyMock.mockReset();
  });

  it("无事件时给出解释性空态，而不是一片空白", async () => {
    render(<SecuritySection />);
    expect(await screen.findByText(/还没有安全事件/)).toBeInTheDocument();
  });

  it("列出事件并显示类型、对象、原因与规则", async () => {
    listMock.mockResolvedValue([
      ev({ id: 1, kind: "blocked_command", subject: "rm -rf /", rule_id: "cmd_rm_root" }),
      ev({
        id: 2,
        kind: "approval_allowed",
        subject: "curl x | sh",
        reason: "把下载内容直接交给 sh 执行",
        rule_id: "cmd_pipe_sh",
      }),
    ]);
    render(<SecuritySection />);
    // 「命令拦截」既是筛选芯片也是行内标签，出现两次是对的
    expect((await screen.findAllByText("命令拦截")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("审批放行").length).toBeGreaterThan(0);
    expect(screen.getByText("rm -rf /")).toBeInTheDocument();
    expect(screen.getByText("cmd_pipe_sh")).toBeInTheDocument();
  });

  it("按类型筛选只留下对应事件", async () => {
    listMock.mockResolvedValue([
      ev({ id: 1, kind: "blocked_command", subject: "rm -rf /" }),
      ev({ id: 2, kind: "path_denied", subject: "C:/Windows/win.ini", reason: "越权" }),
    ]);
    render(<SecuritySection />);
    await screen.findByText("rm -rf /");
    // 筛选芯片用「全部 + 各类型」两组，点「路径越权」后命令拦截应消失
    await userEvent.click(screen.getAllByRole("button", { name: /路径越权/ })[0]);
    await waitFor(() => expect(screen.queryByText("rm -rf /")).toBeNull());
    expect(screen.getByText("C:/Windows/win.ini")).toBeInTheDocument();
  });

  it("切换策略写全局默认，并显示当前档位", async () => {
    render(<SecuritySection />);
    const strict = await screen.findByRole("button", { name: /每条命令都询问/ });
    await userEvent.click(strict);
    await waitFor(() => expect(setPolicyMock).toHaveBeenCalledWith("strict"));
    expect(notifyMock).toHaveBeenCalledWith("ok", "审批策略已更新");
  });

  it("保存策略失败时回滚选中态并报错", async () => {
    setPolicyMock.mockRejectedValue(new Error("db locked"));
    render(<SecuritySection />);
    const auto = await screen.findByRole("button", { name: /不询问（敏感操作除外）/ });
    await userEvent.click(auto);
    await waitFor(() =>
      expect(notifyMock).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("保存失败"),
      ),
    );
    // 回滚后默认档仍是「仅危险命令询问」
    expect(
      screen.getByRole("button", { name: /仅危险命令询问（默认）/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("导出走保存对话框，并用返回条数提示", async () => {
    listMock.mockResolvedValue([ev()]);
    saveMock.mockResolvedValue("C:/Users/x/events.csv");
    exportMock.mockResolvedValue(7);
    render(<SecuritySection />);
    await screen.findByText("rm -rf /");
    await userEvent.click(screen.getByRole("button", { name: /导出/ }));
    await waitFor(() =>
      expect(exportMock).toHaveBeenCalledWith("C:/Users/x/events.csv"),
    );
    expect(notifyMock).toHaveBeenCalledWith("ok", "已导出 7 条安全事件");
  });

  it("用户取消保存对话框时不调用导出命令", async () => {
    listMock.mockResolvedValue([ev()]);
    saveMock.mockResolvedValue(null);
    render(<SecuritySection />);
    await screen.findByText("rm -rf /");
    await userEvent.click(screen.getByRole("button", { name: /导出/ }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(exportMock).not.toHaveBeenCalled();
  });
});
