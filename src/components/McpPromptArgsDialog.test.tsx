import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearOverlays } from "../lib/overlayStack";
import type { McpPromptItemView } from "../lib/mcp";
import McpPromptArgsDialog from "./McpPromptArgsDialog";

const PROMPT: McpPromptItemView = {
  server_id: 3,
  server_name: "fs",
  name: "review",
  description: "代码评审",
  arguments: [
    { name: "path", description: "文件路径", required: true },
    { name: "tone", description: "语气", required: false },
  ],
};

function setup(p = PROMPT) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <McpPromptArgsDialog prompt={p} onSubmit={onSubmit} onCancel={onCancel} />,
  );
  return { onSubmit, onCancel };
}

beforeEach(() => clearOverlays());

describe("McpPromptArgsDialog", () => {
  it("必填参数未填时禁止提交", () => {
    setup();
    expect(screen.getByRole("button", { name: "插入输入框" })).toBeDisabled();
    expect(screen.getByText(/必填：path/)).toBeInTheDocument();
  });

  it("填完必填后提交只带非空参数", async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByRole("textbox", { name: "path" }), "src/a.ts");
    await userEvent.click(screen.getByRole("button", { name: "插入输入框" }));
    expect(onSubmit).toHaveBeenCalledWith({ path: "src/a.ts" });
  });

  it("回车即可提交", async () => {
    const { onSubmit } = setup();
    const box = screen.getByRole("textbox", { name: "path" });
    await userEvent.type(box, "README.md{Enter}");
    expect(onSubmit).toHaveBeenCalledWith({ path: "README.md" });
  });

  it("取消按钮触发回调", async () => {
    const { onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
