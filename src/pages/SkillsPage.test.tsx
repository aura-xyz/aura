import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 页面只与 lib/api 交互：mock 掉命令，用可控数据驱动各分支。
const {
  listSkillsMock,
  setEnabledMock,
  deleteSkillMock,
  listMarketMock,
  installMarketMock,
} = vi.hoisted(() => ({
  listSkillsMock: vi.fn(),
  setEnabledMock: vi.fn(),
  deleteSkillMock: vi.fn(),
  listMarketMock: vi.fn(),
  installMarketMock: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  listSkills: listSkillsMock,
  setSkillEnabled: setEnabledMock,
  deleteSkill: deleteSkillMock,
  listMarketSkills: listMarketMock,
  installMarketSkill: installMarketMock,
}));

import type { MarketSkillView, SkillView } from "../lib/api";
import SkillsPage from "./SkillsPage";

function skill(
  partial: Partial<SkillView> & Pick<SkillView, "name" | "source">,
): SkillView {
  return {
    description: `${partial.name} 的说明`,
    version: "0.1.0",
    allowed_tools: ["read_file"],
    enabled: true,
    dir: `E:/skills/${partial.name}`,
    path: `E:/skills/${partial.name}/SKILL.md`,
    ...partial,
  };
}

const BUILTIN = skill({ name: "code-explainer", source: "builtin" });
const LOCAL = skill({ name: "my-helper", source: "local", enabled: false });
const WORKSPACE = skill({ name: "ws-skill", source: "workspace" });

function marketItem(partial: Partial<MarketSkillView> & Pick<MarketSkillView, "id">): MarketSkillView {
  return {
    name: partial.id,
    description: `${partial.id} 的市场说明`,
    version: "1.0.0",
    tags: [],
    author: "",
    installed: false,
    ...partial,
  };
}

beforeEach(() => {
  listSkillsMock.mockReset();
  setEnabledMock.mockReset();
  deleteSkillMock.mockReset();
  listMarketMock.mockReset();
  installMarketMock.mockReset();
  // 默认市场为空：既有用例不必关心市场，各自按需覆盖
  listMarketMock.mockResolvedValue([]);
});

describe("SkillsPage", () => {
  it("按内置/已安装分组，并展示市场占位", async () => {
    listSkillsMock.mockResolvedValue([BUILTIN, LOCAL, WORKSPACE]);
    render(<SkillsPage onClose={vi.fn()} />);

    expect(await screen.findByText("code-explainer")).toBeInTheDocument();
    expect(screen.getByText("my-helper")).toBeInTheDocument();
    expect(screen.getByText("ws-skill")).toBeInTheDocument();

    // 分组标题带数量
    expect(screen.getByText("内置技能（1）")).toBeInTheDocument();
    expect(screen.getByText("已安装（2）")).toBeInTheDocument();
    // 市场区块独立存在（清单为空时给出提示）
    expect(await screen.findByText("注册表里暂时没有技能。")).toBeInTheDocument();
    // 概览：共 3 个，2 个启用
    expect(screen.getByText(/共 3 个技能，2 个已启用/)).toBeInTheDocument();
  });

  it("开关切换调用命令并就地更新状态", async () => {
    listSkillsMock.mockResolvedValue([BUILTIN, LOCAL]);
    setEnabledMock.mockResolvedValue(undefined);
    render(<SkillsPage onClose={vi.fn()} />);

    // LOCAL 默认禁用，按钮语义是「启用」
    const sw = await screen.findByRole("switch", { name: "启用 my-helper" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);

    expect(setEnabledMock).toHaveBeenCalledWith("my-helper", true);
    // 就地更新，不需要重新拉列表
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "禁用 my-helper" }),
      ).toHaveAttribute("aria-checked", "true"),
    );
    expect(listSkillsMock).toHaveBeenCalledTimes(1);
  });

  it("开关失败时回滚并提示原因", async () => {
    listSkillsMock.mockResolvedValue([LOCAL]);
    setEnabledMock.mockRejectedValue("技能不存在，可能已被移动或删除");
    render(<SkillsPage onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("switch", { name: "启用 my-helper" }));
    expect(await screen.findByText(/技能不存在，可能已被移动或删除/)).toBeInTheDocument();
    // 失败不改变本地状态
    expect(screen.getByRole("switch", { name: "启用 my-helper" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("只有本地/市场技能能删，内置与工作区显示不可删除", async () => {
    listSkillsMock.mockResolvedValue([BUILTIN, LOCAL, WORKSPACE]);
    render(<SkillsPage onClose={vi.fn()} />);

    await screen.findByText("my-helper");
    expect(screen.getByRole("button", { name: "删除 my-helper" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除 code-explainer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除 ws-skill" })).toBeNull();
    // 两个不可删的来源各有一处提示
    expect(screen.getAllByText("不可删除")).toHaveLength(2);
  });

  it("删除需二次确认，确认后调用命令并刷新列表", async () => {
    listSkillsMock.mockResolvedValue([LOCAL]);
    deleteSkillMock.mockResolvedValue(undefined);
    render(<SkillsPage onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "删除 my-helper" }));
    // 第一次点击只是进入确认态，不能立刻删
    expect(deleteSkillMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(deleteSkillMock).toHaveBeenCalledWith("my-helper");
    // 删除后重新拉列表（第二次调用）
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/已删除技能「my-helper」/)).toBeInTheDocument();
  });

  it("取消删除不调用命令", async () => {
    listSkillsMock.mockResolvedValue([LOCAL]);
    render(<SkillsPage onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "删除 my-helper" }));
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(deleteSkillMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "删除 my-helper" })).toBeInTheDocument();
  });

  it("空列表给出目录引导", async () => {
    listSkillsMock.mockResolvedValue([]);
    render(<SkillsPage onClose={vi.fn()} />);

    expect(await screen.findByText("还没有安装任何技能。")).toBeInTheDocument();
    // 目录引导：分组说明与空态提示各提到一次
    expect(screen.getAllByText(/\.agents\/skills\//).length).toBeGreaterThan(0);
    expect(screen.getByText("未找到内置技能。")).toBeInTheDocument();
  });

  it("读取失败给出原因与重试", async () => {
    listSkillsMock.mockRejectedValueOnce("数据库被占用").mockResolvedValueOnce([LOCAL]);
    render(<SkillsPage onClose={vi.fn()} />);

    expect(await screen.findByText(/读取技能失败：数据库被占用/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("my-helper")).toBeInTheDocument();
  });

  // ---- 市场（v0.6.1 第二段） ----

  it("市场清单渲染卡片，可按名称/标签搜索", async () => {
    listSkillsMock.mockResolvedValue([]);
    listMarketMock.mockResolvedValue([
      marketItem({
        id: "mcp-builder",
        name: "MCP 服务器构建",
        tags: ["development", "mcp"],
        installed: true,
      }),
      marketItem({ id: "code-review", name: "代码审查", tags: ["review"] }),
    ]);
    render(<SkillsPage onClose={vi.fn()} />);

    expect(await screen.findByText("MCP 服务器构建")).toBeInTheDocument();
    expect(screen.getByText("代码审查")).toBeInTheDocument();
    // 已安装的只给角标，不再给安装按钮
    expect(screen.getByText("已安装")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "安装" })).toHaveLength(1);

    // 按标签命中
    await userEvent.type(screen.getByLabelText("搜索市场技能"), "review");
    expect(screen.getByText("代码审查")).toBeInTheDocument();
    expect(screen.queryByText("MCP 服务器构建")).toBeNull();

    // 无匹配时给提示，而不是空白
    await userEvent.clear(screen.getByLabelText("搜索市场技能"));
    await userEvent.type(screen.getByLabelText("搜索市场技能"), "zzz");
    expect(screen.getByText("没有匹配的技能。")).toBeInTheDocument();
  });

  it("点击安装调用命令、标记已安装并刷新本地列表", async () => {
    listSkillsMock.mockResolvedValue([]);
    listMarketMock.mockResolvedValue([
      marketItem({ id: "mcp-builder", name: "MCP 服务器构建" }),
    ]);
    installMarketMock.mockResolvedValue(undefined);
    render(<SkillsPage onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "安装" }));
    expect(installMarketMock).toHaveBeenCalledWith("mcp-builder");
    // 装完立刻变成「已安装」，并重新拉本地列表（第二次）
    expect(await screen.findByText("已安装")).toBeInTheDocument();
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/已安装「MCP 服务器构建」/)).toBeInTheDocument();
  });

  it("安装失败时给出后端原因，不标记已安装", async () => {
    listSkillsMock.mockResolvedValue([]);
    listMarketMock.mockResolvedValue([marketItem({ id: "x", name: "X 技能" })]);
    installMarketMock.mockRejectedValue("技能包校验失败（sha256 不匹配）");
    render(<SkillsPage onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "安装" }));
    expect(await screen.findByText(/sha256 不匹配/)).toBeInTheDocument();
    // 失败不该把卡片标成已安装
    expect(screen.getByRole("button", { name: "安装" })).toBeInTheDocument();
  });

  it("市场清单失败不影响本地技能，且可重试", async () => {
    listSkillsMock.mockResolvedValue([LOCAL]);
    listMarketMock.mockRejectedValueOnce("连接超时").mockResolvedValueOnce([]);
    render(<SkillsPage onClose={vi.fn()} />);

    // 本地列表照常可用
    expect(await screen.findByText("my-helper")).toBeInTheDocument();
    expect(await screen.findByText(/获取市场清单失败：连接超时/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("注册表里暂时没有技能。")).toBeInTheDocument();
  });
});
