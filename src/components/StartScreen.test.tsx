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
});
