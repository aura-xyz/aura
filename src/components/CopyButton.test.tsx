import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { copyMock } = vi.hoisted(() => ({ copyMock: vi.fn() }));
vi.mock("../lib/clipboard", () => ({ copyText: copyMock }));

import CopyButton from "./CopyButton";

beforeEach(() => {
  copyMock.mockReset();
});

describe("CopyButton", () => {
  it("点击调 copyText 并传入要复制的文本", async () => {
    copyMock.mockResolvedValue(true);
    render(<CopyButton text="hello world" />);
    await userEvent.click(screen.getByRole("button"));
    expect(copyMock).toHaveBeenCalledWith("hello world");
  });

  it("复制成功后短时间显示「已复制」再回落", async () => {
    copyMock.mockResolvedValue(true);
    render(<CopyButton text="x" />);
    const btn = screen.getByRole("button");

    await userEvent.click(btn);
    expect(btn.getAttribute("data-state")).toBe("done");
    expect(screen.getByText("已复制")).toBeInTheDocument();

    await waitFor(
      () => expect(btn.getAttribute("data-state")).toBe("idle"),
      { timeout: 3000 },
    );
  });

  it("复制失败时提示失败，不伪装成成功", async () => {
    copyMock.mockResolvedValue(false);
    render(<CopyButton text="x" />);
    const btn = screen.getByRole("button");

    await userEvent.click(btn);
    expect(btn.getAttribute("data-state")).toBe("failed");
    expect(screen.getByText("复制失败")).toBeInTheDocument();
  });

  it("空文本时按钮禁用（复制空内容是无意义操作）", () => {
    render(<CopyButton text="" />);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "复制");
  });

  it("自定义标签透出", () => {
    render(<CopyButton text="x" label="复制代码" />);
    expect(screen.getByText("复制代码")).toBeInTheDocument();
  });
});
