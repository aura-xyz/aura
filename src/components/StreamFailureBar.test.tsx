import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamFailure } from "../store";
import StreamFailureBar from "./StreamFailureBar";

const { storeState } = vi.hoisted(() => ({
  storeState: { value: {} as Record<string, unknown> },
}));

vi.mock("../store", () => ({
  useStore: () => storeState.value,
}));

const BASE: StreamFailure = {
  sessionId: "s1",
  kind: "interrupted",
  code: "net_timeout",
  message: "网络连接中断或超时，已保留已生成的内容。",
  detail: "stream closed after 90s",
  retryable: true,
  userIndex: 1,
  text: "帮我看看",
};

function setup(failure: StreamFailure | null, activeId = "s1") {
  const retryLast = vi.fn(async () => {});
  const dismissFailure = vi.fn();
  storeState.value = { failure, activeId, retryLast, dismissFailure };
  render(<StreamFailureBar />);
  return { retryLast, dismissFailure };
}

beforeEach(() => {
  storeState.value = {};
});

describe("StreamFailureBar", () => {
  it("没有失败时不渲染", () => {
    setup(null);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("失败属于别的会话时不渲染", () => {
    setup(BASE, "s2");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("网络中断显示可重试提示，点击触发 retryLast", async () => {
    const { retryLast } = setup(BASE);
    expect(screen.getByRole("alert")).toHaveTextContent("生成中断");
    expect(screen.getByRole("alert")).toHaveTextContent("已保留当前内容");
    await userEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(retryLast).toHaveBeenCalledTimes(1);
  });

  it("不可重试的失败不显示重试按钮", () => {
    setup({ ...BASE, kind: "failed", code: "auth", retryable: false });
    expect(screen.getByRole("alert")).toHaveTextContent("生成失败");
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
  });

  it("展开详情显示原始错误，忽略按钮只收起提示", async () => {
    const { dismissFailure } = setup(BASE);
    await userEvent.click(screen.getByRole("button", { name: "展开错误详情" }));
    expect(screen.getByText("stream closed after 90s")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "忽略失败提示" }));
    expect(dismissFailure).toHaveBeenCalledTimes(1);
  });
});
