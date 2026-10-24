import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 组件只与 lib/api 交互：mock 掉命令，用可控数据驱动各分支。
const {
  listMock,
  checkMock,
  addMock,
  removeMock,
  openMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  checkMock: vi.fn(),
  addMock: vi.fn(),
  removeMock: vi.fn(),
  openMock: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  listAllowlistPaths: listMock,
  checkAllowlistPath: checkMock,
  addAllowlistPath: addMock,
  removeAllowlistPath: removeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

import AllowlistSection from "./AllowlistSection";

const BUILTIN = {
  path: "C:/Users/x/AppData/Roaming/aura/skills/local",
  label: "技能目录（可让模型管理技能）",
  builtin: true,
  exists: true,
};

const USER_DIR = {
  path: "D:/projects/data",
  label: "data",
  builtin: false,
  exists: true,
};

beforeEach(() => {
  listMock.mockReset();
  checkMock.mockReset();
  addMock.mockReset();
  removeMock.mockReset();
  openMock.mockReset();
  listMock.mockResolvedValue([]);
});

describe("路径白名单", () => {
  it("列出白名单条目，内置项标记为默认且没有删除按钮", async () => {
    listMock.mockResolvedValue([BUILTIN, USER_DIR]);
    render(<AllowlistSection />);

    expect(await screen.findByText("技能目录（可让模型管理技能）")).toBeInTheDocument();
    expect(screen.getByText("D:/projects/data")).toBeInTheDocument();
    // 内置项有「默认」标记，用户项没有
    expect(screen.getByText("默认")).toBeInTheDocument();
    // 只有用户项有删除按钮
    expect(screen.getByRole("button", { name: "移除 data" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /移除 技能目录/ }),
    ).toBeNull();
  });

  it("目录不存在时给出提示", async () => {
    listMock.mockResolvedValue([
      { ...USER_DIR, path: "D:/gone", label: "gone", exists: false },
    ]);
    render(<AllowlistSection />);
    expect(await screen.findByText("目录不存在")).toBeInTheDocument();
  });

  it("普通目录：判定通过后直接添加", async () => {
    openMock.mockResolvedValue("D:/projects/data");
    checkMock.mockResolvedValue({
      level: "allow",
      reason: "可以直接添加",
      path: "D:/projects/data",
    });
    addMock.mockResolvedValue([USER_DIR]);
    render(<AllowlistSection />);

    await userEvent.click(await screen.findByRole("button", { name: "添加目录" }));
    await waitFor(() => expect(checkMock).toHaveBeenCalledWith("D:/projects/data"));
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith("D:/projects/data", undefined, false),
    );
    expect(await screen.findByText(/已添加该目录/)).toBeInTheDocument();
  });

  /// 隐私目录必须弹窗确认，且**未确认前不写库**。
  it("隐私目录弹窗确认后才写入", async () => {
    openMock.mockResolvedValue("C:/Users/x/Desktop");
    checkMock.mockResolvedValue({
      level: "confirm",
      reason: "`Desktop` 可能包含隐私信息（聊天记录、证件、合同等）。",
      path: "C:/Users/x/Desktop",
    });
    addMock.mockResolvedValue([
      { path: "C:/Users/x/Desktop", label: "Desktop", builtin: false, exists: true },
    ]);
    render(<AllowlistSection />);

    await userEvent.click(await screen.findByRole("button", { name: "添加目录" }));
    expect(await screen.findByText("确认授权这个目录？")).toBeInTheDocument();
    // 关键：确认前不能落库
    expect(addMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "仍然添加" }));
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith("C:/Users/x/Desktop", undefined, true),
    );
  });

  it("取消确认就不写入", async () => {
    openMock.mockResolvedValue("C:/Users/x/Desktop");
    checkMock.mockResolvedValue({
      level: "confirm",
      reason: "可能有隐私信息",
      path: "C:/Users/x/Desktop",
    });
    render(<AllowlistSection />);

    await userEvent.click(await screen.findByRole("button", { name: "添加目录" }));
    await screen.findByText("确认授权这个目录？");
    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(addMock).not.toHaveBeenCalled();
    expect(screen.queryByText("确认授权这个目录？")).toBeNull();
  });

  /// 硬拒档不给「添加」的机会——只提示。
  it("危险目录直接拒绝，不弹窗也不写入", async () => {
    openMock.mockResolvedValue("C:/Windows/System32");
    checkMock.mockResolvedValue({
      level: "reject",
      reason: "`System32` 是系统目录或密钥目录，不能授权给模型",
      path: "C:/Windows/System32",
    });
    render(<AllowlistSection />);

    await userEvent.click(await screen.findByRole("button", { name: "添加目录" }));
    expect(await screen.findByText(/是系统目录或密钥目录/)).toBeInTheDocument();
    expect(screen.queryByText("确认授权这个目录？")).toBeNull();
    expect(addMock).not.toHaveBeenCalled();
  });

  it("用户取消选择目录时不做任何事", async () => {
    openMock.mockResolvedValue(null);
    render(<AllowlistSection />);

    await userEvent.click(await screen.findByRole("button", { name: "添加目录" }));
    expect(checkMock).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });

  it("移除条目后刷新列表", async () => {
    listMock.mockResolvedValue([USER_DIR]);
    removeMock.mockResolvedValue([]);
    render(<AllowlistSection />);

    await userEvent.click(await screen.findByRole("button", { name: "移除 data" }));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("D:/projects/data"));
    expect(await screen.findByText(/已移除「data」/)).toBeInTheDocument();
  });
});
