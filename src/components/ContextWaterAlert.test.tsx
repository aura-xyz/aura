import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noticesSnapshot, resetNotices } from "../lib/notices";
import ContextWaterAlert from "./ContextWaterAlert";

const { storeState, compactMock } = vi.hoisted(() => ({
  storeState: { value: {} as Record<string, unknown> },
  compactMock: vi.fn(async () => ({
    before_tokens: 100,
    after_tokens: 40,
    dropped_messages: 6,
    changed: true,
  })),
}));

vi.mock("../store", () => ({ useStore: () => storeState.value }));
vi.mock("../lib/api", () => ({ compactSession: compactMock }));

function setup(used: number | null, limit: number | undefined = 10_000) {
  const newSession = vi.fn(async () => {});
  storeState.value = {
    activeSession: {
      id: "s1",
      lastUsage:
        used === null
          ? undefined
          : { input: used, output: 0, total: used, llmMs: 0 },
    },
    newSession,
  };
  render(<ContextWaterAlert contextLimit={limit} />);
  return { newSession };
}

beforeEach(() => {
  resetNotices();
  compactMock.mockClear();
});
afterEach(() => resetNotices());

describe("ContextWaterAlert", () => {
  it("70% 只靠水位条提示，不额外占一条横幅", () => {
    setup(7500);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("90% 显示可操作提示条", () => {
    setup(9500);
    expect(screen.getByRole("status")).toHaveTextContent("上下文接近上限");
    expect(screen.getByRole("button", { name: /压缩历史/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新开会话/ })).toBeInTheDocument();
  });

  it("100% 变硬拦截说明", () => {
    setup(10_000);
    expect(screen.getByRole("alert")).toHaveTextContent("已暂停发送");
  });

  it("压缩历史调用后端并在成功后收起提示", async () => {
    setup(9500);
    await userEvent.click(screen.getByRole("button", { name: /压缩历史/ }));
    expect(compactMock).toHaveBeenCalledWith("s1", 10_000);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(noticesSnapshot().some((n) => n.kind === "ok")).toBe(true);
  });

  it("没有可压缩内容时给出明确提示", async () => {
    compactMock.mockResolvedValueOnce({
      before_tokens: 40,
      after_tokens: 40,
      dropped_messages: 0,
      changed: false,
    });
    setup(9500);
    await userEvent.click(screen.getByRole("button", { name: /压缩历史/ }));
    await waitFor(() =>
      expect(noticesSnapshot().some((n) => n.kind === "error")).toBe(true),
    );
  });

  it("新开会话按钮可用", async () => {
    const { newSession } = setup(9500);
    await userEvent.click(screen.getByRole("button", { name: /新开会话/ }));
    expect(newSession).toHaveBeenCalledTimes(1);
  });
});
