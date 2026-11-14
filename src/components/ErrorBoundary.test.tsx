import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noticesSnapshot, resetNotices } from "../lib/notices";
import ErrorBoundary from "./ErrorBoundary";

function Boom() {
  throw new Error("渲染崩了");
}

beforeEach(() => {
  resetNotices();
  // React 会把渲染错误打到控制台，测试里静音
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  resetNotices();
});

describe("ErrorBoundary", () => {
  it("子树抛错时显示可恢复面板并推 toast，而不是白屏", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("界面出了点问题");
    expect(noticesSnapshot().some((n) => n.kind === "error")).toBe(true);
  });

  it("点击重新渲染后恢复子树", async () => {
    let ok = false;
    function Maybe() {
      if (!ok) throw new Error("x");
      return <div>恢复正常</div>;
    }
    render(
      <ErrorBoundary>
        <Maybe />
      </ErrorBoundary>,
    );
    ok = true;
    await userEvent.click(screen.getByRole("button", { name: /重新渲染界面/ }));
    expect(screen.getByText("恢复正常")).toBeInTheDocument();
  });

  it("正常子树原样渲染", () => {
    render(
      <ErrorBoundary>
        <div>一切正常</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("一切正常")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
