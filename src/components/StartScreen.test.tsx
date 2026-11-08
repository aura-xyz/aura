import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillView } from "../lib/api";

/**
 * 开始界面（v0.7.0）。
 *
 * 顺序契约：**图标 + 标题 → 输入框 → 示例内容**，整体居中成一块。
 * 此前标题在消息区、输入框钉在窗口最底，两块离得很远。
 */
const { skillsMock } = vi.hoisted(() => ({
  skillsMock: vi.fn(async (): Promise<SkillView[]> => []),
}));
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, listSkills: skillsMock };
});

import StartScreen from "./StartScreen";

beforeEach(() => {
  skillsMock.mockReset();
  skillsMock.mockResolvedValue([]);
});

describe("StartScreen", () => {
  it("标题在输入框上方", async () => {
    render(
      <StartScreen onPick={() => {}}>
        <textarea aria-label="输入" />
      </StartScreen>,
    );
    const title = screen.getByText("Aura");
    const box = screen.getByRole("textbox");
    // DOM 顺序：标题在输入框之前
    expect(
      title.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("有内置技能时显示示例卡片，点一下把引导语交给上层", async () => {
    skillsMock.mockResolvedValue([
      {
        name: "docx",
        description: "处理 Word 文档",
        version: "1",
        source: "builtin",
        allowed_tools: [],
        enabled: true,
        dir: "",
        path: "",
      },
    ]);
    const onPick = vi.fn();
    render(
      <StartScreen onPick={onPick}>
        <textarea aria-label="输入" />
      </StartScreen>,
    );
    const card = await screen.findByText("docx");
    await userEvent.click(card);
    expect(onPick).toHaveBeenCalledWith("用 docx 技能帮我");
  });

  it("没有技能时不显示卡片区，也不报错", async () => {
    render(
      <StartScreen onPick={() => {}}>
        <textarea aria-label="输入" />
      </StartScreen>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Aura")).toBeInTheDocument();
  });

  /// A7：把「打开应用 → 找到昨天那个会话」这条高频路径压成一次点击。
  it("给了最近会话时显示继续上次胶囊，点击回到该会话", async () => {
    const onOpen = vi.fn();
    render(
      <StartScreen
        onPick={() => {}}
        recentSession={{ title: "修 bug 的那次", onOpen }}
      >
        <textarea aria-label="输入" />
      </StartScreen>,
    );
    const pill = screen.getByRole("button", { name: /继续上次/ });
    expect(pill).toHaveTextContent("修 bug 的那次");
    await userEvent.click(pill);
    expect(onOpen).toHaveBeenCalled();
  });

  it("给了模型名时在 slogan 下显示徽章", () => {
    render(
      <StartScreen onPick={() => {}} modelLabel="Claude Sonnet">
        <textarea aria-label="输入" />
      </StartScreen>,
    );
    expect(screen.getByText("Claude Sonnet")).toBeInTheDocument();
  });

  /// 示例卡从 3 张提到 6 张，并带来源色顶边 + 首字小方块。
  it("示例卡最多 6 张且带顶边与首字块", async () => {
    const skills = Array.from({ length: 8 }, (_, i) => ({
      name: `skill-${i}`,
      description: "说明",
      version: "1",
      source: "builtin" as const,
      allowed_tools: [],
      enabled: true,
      dir: "",
      path: "",
    }));
    skillsMock.mockResolvedValue(skills);
    render(
      <StartScreen onPick={() => {}}>
        <textarea aria-label="输入" />
      </StartScreen>,
    );
    const first = await screen.findByText("skill-0");
    const card = first.closest("button") as HTMLElement;
    expect(card.className).toContain("border-t-brand");
    expect(card.textContent).toContain("S");
    expect(screen.queryByText("skill-6")).toBeNull();
  });
});
