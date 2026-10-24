import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 页面只与 lib/api 交互：mock 掉命令，用可控数据驱动各分支。
const {
  listSkillsMock,
  setEnabledMock,
  deleteSkillMock,
  listMarketMock,
  inspectMarketMock,
  installMarketMock,
  listSourcesMock,
  addSourceMock,
  removeSourceMock,
} = vi.hoisted(() => ({
  listSkillsMock: vi.fn(),
  setEnabledMock: vi.fn(),
  deleteSkillMock: vi.fn(),
  listMarketMock: vi.fn(),
  inspectMarketMock: vi.fn(),
  installMarketMock: vi.fn(),
  listSourcesMock: vi.fn(),
  addSourceMock: vi.fn(),
  removeSourceMock: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  listSkills: listSkillsMock,
  setSkillEnabled: setEnabledMock,
  deleteSkill: deleteSkillMock,
  listMarketSkills: listMarketMock,
  inspectMarketSkill: inspectMarketMock,
  installMarketSkill: installMarketMock,
  listSkillSources: listSourcesMock,
  addSkillSource: addSourceMock,
  removeSkillSource: removeSourceMock,
}));

import type {
  MarketSkillView,
  SkillInspection,
  SkillSourceView,
  SkillView,
} from "../lib/api";
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
    registry: "官方",
    installed: false,
    installed_version: "",
    ...partial,
  };
}

const OFFICIAL_SOURCE: SkillSourceView = {
  name: "官方",
  url: "https://raw.githubusercontent.com/aura-xyz/aura-skill-registry/main/",
  removable: false,
  repo: "https://github.com/aura-xyz/aura-skill-registry",
};

/** 审查报告（默认无风险）。 */
function inspection(partial: Partial<SkillInspection> = {}): SkillInspection {
  return {
    id: "mcp-builder",
    name: "MCP 服务器构建",
    description: "说明",
    version: "1.0.0",
    registry: "官方",
    already_installed: false,
    installed_version: "",
    skill_name: "mcp-builder",
    tools: ["read_file"],
    package_files: ["SKILL.md"],
    bytes: 2048,
    audit: {
      findings: [],
      file_count: 1,
      total_bytes: 2048,
      has_scripts: false,
      scanned_files: 1,
    },
    ...partial,
  };
}

const SUMMARY = {
  version: "1.0.0",
  skill_name: "mcp-builder",
  kept: [],
  high: 0,
  medium: 0,
  has_scripts: false,
  file_count: 1,
};

beforeEach(() => {
  listSkillsMock.mockReset();
  setEnabledMock.mockReset();
  deleteSkillMock.mockReset();
  listMarketMock.mockReset();
  inspectMarketMock.mockReset();
  installMarketMock.mockReset();
  listSourcesMock.mockReset();
  addSourceMock.mockReset();
  removeSourceMock.mockReset();
  // 默认市场为空：既有用例不必关心市场，各自按需覆盖
  listMarketMock.mockResolvedValue({ skills: [], errors: [] });
  listSourcesMock.mockResolvedValue([OFFICIAL_SOURCE]);
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

  // ---- 市场（v0.6.1 / v0.6.3 加固） ----

  it("市场清单渲染卡片，可按名称/标签搜索", async () => {
    listSkillsMock.mockResolvedValue([]);
    listMarketMock.mockResolvedValue({
      skills: [
        marketItem({
          id: "mcp-builder",
          name: "MCP 服务器构建",
          tags: ["development", "mcp"],
          installed: true,
          installed_version: "1.0.0",
        }),
        marketItem({ id: "code-review", name: "代码审查", tags: ["review"] }),
      ],
      errors: [],
    });
    render(<SkillsPage onClose={vi.fn()} />);

    expect(await screen.findByText("MCP 服务器构建")).toBeInTheDocument();
    expect(screen.getByText("代码审查")).toBeInTheDocument();
    // 已安装同版本：只给角标，不再给按钮
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

  it("点安装先弹审查报告，确认后才调用安装命令", async () => {
    listSkillsMock.mockResolvedValue([]);
    listMarketMock.mockResolvedValue({
      skills: [marketItem({ id: "mcp-builder", name: "MCP 服务器构建" })],
      errors: [],
    });
    inspectMarketMock.mockResolvedValue(inspection());
    installMarketMock.mockResolvedValue(SUMMARY);
    render(<SkillsPage onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "安装" }));
    expect(inspectMarketMock).toHaveBeenCalledWith("mcp-builder");

    const dialog = await screen.findByRole("dialog");
    // 审查报告展示前不落盘
    expect(installMarketMock).not.toHaveBeenCalled();
    expect(within(dialog).getByText("申请的权限")).toBeInTheDocument();
    expect(within(dialog).getByText(/工具范围：read_file/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "安装" }));
    // 干净包：不需要高危确认，首次安装
    expect(installMarketMock).toHaveBeenCalledWith("mcp-builder", false, false);
    // 装完立刻刷新本地列表并给出回执
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/已安装「MCP 服务器构建」/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("有高危内容时按钮变「仍然安装」，确认位随之为 true", async () => {
    listSkillsMock.mockResolvedValue([]);
    listMarketMock.mockResolvedValue({
      skills: [marketItem({ id: "danger", name: "危险技能" })],
      errors: [],
    });
    inspectMarketMock.mockResolvedValue(
      inspection({
        id: "danger",
        name: "危险技能",
        audit: {
          findings: [
            {
              severity: "high",
              rule: "rm_rf",
              file: "SKILL.md",
              line: 5,
              note: "递归强制删除文件",
              excerpt: "rm -rf ./dist",
            },
          ],
          file_count: 1,
          total_bytes: 100,
          has_scripts: true,
          scanned_files: 1,
        },
      }),
    );
    installMarketMock.mockResolvedValue(SUMMARY);
    render(<SkillsPage onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "安装" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("高危")).toBeInTheDocument();
    expect(within(dialog).getByText("递归强制删除文件")).toBeInTheDocument();
    expect(within(dialog).getByText("rm -rf ./dist")).toBeInTheDocument();
    expect(within(dialog).getByText(/包含可执行脚本/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "仍然安装" }));
    expect(installMarketMock).toHaveBeenCalledWith("danger", true, false);
  });

  it("审查失败只提示原因，不弹窗也不安装", async () => {
    listSkillsMock.mockResolvedValue([]);
    listMarketMock.mockResolvedValue({
      skills: [marketItem({ id: "x", name: "X 技能" })],
      errors: [],
    });
    inspectMarketMock.mockRejectedValue("技能包校验失败（sha256 不匹配）");
    render(<SkillsPage onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "安装" }));
    expect(await screen.findByText(/sha256 不匹配/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(installMarketMock).not.toHaveBeenCalled();
  });

  it("安装失败时弹窗不关，错误显示在弹窗内可重试", async () => {
    listSkillsMock.mockResolvedValue([]);
    listMarketMock.mockResolvedValue({
      skills: [marketItem({ id: "x", name: "X 技能" })],
      errors: [],
    });
    inspectMarketMock.mockResolvedValue(inspection({ id: "x", name: "X 技能" }));
    installMarketMock.mockRejectedValue("检测到 1 条高危内容，确认后才会安装");
    render(<SkillsPage onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "安装" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "安装" }));
    expect(await within(dialog).findByText(/高危内容/)).toBeInTheDocument();
    // 弹窗还在，用户可以看清后重试
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("已安装且版本不同时给「更新」入口，确认后按更新安装", async () => {
    listSkillsMock.mockResolvedValue([]);
    listMarketMock.mockResolvedValue({
      skills: [
        marketItem({
          id: "mcp-builder",
          name: "MCP 服务器构建",
          version: "2.0.0",
          installed: true,
          installed_version: "1.0.0",
        }),
      ],
      errors: [],
    });
    inspectMarketMock.mockResolvedValue(
      inspection({ version: "2.0.0", already_installed: true, installed_version: "1.0.0" }),
    );
    installMarketMock.mockResolvedValue({ ...SUMMARY, version: "2.0.0" });
    render(<SkillsPage onClose={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "更新到 v2.0.0" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/已安装 v1.0.0，将更新到 v2.0.0/)).toBeInTheDocument();
    expect(within(dialog).getByText(/你自己加进技能目录的文件会保留/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "更新" }));
    expect(installMarketMock).toHaveBeenCalledWith("mcp-builder", false, true);
    expect(await screen.findByText(/已更新「MCP 服务器构建」到 v2.0.0/)).toBeInTheDocument();
  });

  it("市场清单失败不影响本地技能，且可重试", async () => {
    listSkillsMock.mockResolvedValue([LOCAL]);
    listMarketMock
      .mockRejectedValueOnce("连接超时")
      .mockResolvedValueOnce({ skills: [], errors: [] });
    render(<SkillsPage onClose={vi.fn()} />);

    // 本地列表照常可用
    expect(await screen.findByText("my-helper")).toBeInTheDocument();
    expect(await screen.findByText(/获取市场清单失败：连接超时/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("注册表里暂时没有技能。")).toBeInTheDocument();
  });

  it("单个源失败时仍展示其它源的条目，并说明是哪个源", async () => {
    listSkillsMock.mockResolvedValue([]);
    listMarketMock.mockResolvedValue({
      skills: [marketItem({ id: "ok", name: "可用条目" })],
      errors: ["团队：https://… 返回 HTTP 404"],
    });
    render(<SkillsPage onClose={vi.fn()} />);

    expect(await screen.findByText("可用条目")).toBeInTheDocument();
    expect(screen.getByText(/部分来源拉取失败：团队/)).toBeInTheDocument();
  });

  it("来源区块展示官方源（不可删），可添加与移除自定义源", async () => {
    listSkillsMock.mockResolvedValue([]);
    const custom: SkillSourceView = {
      name: "skills",
      url: "https://raw.githubusercontent.com/team/skills/HEAD/",
      removable: true,
      repo: "https://raw.githubusercontent.com/team/skills/HEAD/",
    };
    addSourceMock.mockResolvedValue([OFFICIAL_SOURCE, custom]);
    removeSourceMock.mockResolvedValue([OFFICIAL_SOURCE]);
    render(<SkillsPage onClose={vi.fn()} />);

    expect(await screen.findByText("官方")).toBeInTheDocument();
    // 官方源没有移除按钮
    expect(screen.queryByRole("button", { name: "移除来源 官方" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /添加源/ }));
    await userEvent.type(
      screen.getByLabelText("仓库地址"),
      "https://github.com/team/skills",
    );
    await userEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(addSourceMock).toHaveBeenCalledWith("https://github.com/team/skills");
    // 添加后重新拉清单（新源的条目要出现）
    await waitFor(() => expect(listMarketMock).toHaveBeenCalledTimes(2));

    await userEvent.click(await screen.findByRole("button", { name: "移除来源 skills" }));
    expect(removeSourceMock).toHaveBeenCalledWith(custom.url);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "移除来源 skills" })).toBeNull(),
    );
  });

  it("添加源失败时在源区块内提示原因", async () => {
    listSkillsMock.mockResolvedValue([]);
    addSourceMock.mockRejectedValue("目前只支持 GitHub 仓库，请填 github.com/owner/repo");
    render(<SkillsPage onClose={vi.fn()} />);

    await screen.findByText("官方");
    await userEvent.click(screen.getByRole("button", { name: /添加源/ }));
    await userEvent.type(screen.getByLabelText("仓库地址"), "https://gitlab.com/a/b");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(await screen.findByText(/只支持 GitHub 仓库/)).toBeInTheDocument();
    // 失败不该关掉输入框，用户可以直接改
    expect(screen.getByLabelText("仓库地址")).toBeInTheDocument();
  });
});
