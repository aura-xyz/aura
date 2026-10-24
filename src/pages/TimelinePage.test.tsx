import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 组件只与 lib/api 和 store 交互：mock 掉两边，用可控数据驱动各分支。
const { listTimelineMock, exportTimelineMock, storeMock } = vi.hoisted(() => ({
  listTimelineMock: vi.fn(),
  exportTimelineMock: vi.fn(),
  storeMock: {
    sessions: [] as { id: string; title: string }[],
    activeId: "",
  },
}));

vi.mock("../lib/api", () => ({
  listTimeline: listTimelineMock,
  exportTimeline: exportTimelineMock,
}));

vi.mock("../store", () => ({
  useStore: () => storeMock,
}));

import TimelinePage from "./TimelinePage";
import type { TimelineEntry } from "../lib/api";

function entry(partial: Partial<TimelineEntry> & Pick<TimelineEntry, "seq">): TimelineEntry {
  return {
    session_id: "s1",
    ts_ms: 1_700_000_000_000,
    turn: 0,
    kind: "user",
    title: "标题",
    detail: null,
    ok: true,
    duration_ms: null,
    ...partial,
  };
}

beforeEach(() => {
  listTimelineMock.mockReset();
  exportTimelineMock.mockReset();
  storeMock.sessions = [{ id: "s1", title: "测试会话" }];
  storeMock.activeId = "s1";
  listTimelineMock.mockResolvedValue([]);
});

describe("操作时间线", () => {
  it("按轮次分组展示记录", async () => {
    listTimelineMock.mockResolvedValue([
      entry({ seq: 0, turn: 0, kind: "user", title: "改一下这个" }),
      entry({ seq: 1, turn: 1, kind: "assistant", title: "我来看看" }),
      entry({
        seq: 2,
        turn: 1,
        kind: "tool",
        title: "Read src/main.rs",
        detail: "参数：{}",
        duration_ms: 42,
      }),
    ]);
    render(<TimelinePage onClose={vi.fn()} />);

    expect(await screen.findByText("改一下这个")).toBeInTheDocument();
    expect(screen.getByText("Read src/main.rs")).toBeInTheDocument();
    // 轮次标题
    expect(screen.getByText("对话开始")).toBeInTheDocument();
    expect(screen.getByText(/第 1 轮/)).toBeInTheDocument();
  });

  it("统计概览给出轮次、工具调用与耗时", async () => {
    listTimelineMock.mockResolvedValue([
      entry({ seq: 0, turn: 0, kind: "user", title: "u" }),
      entry({
        seq: 1,
        turn: 1,
        kind: "tool",
        title: "t1",
        duration_ms: 120,
      }),
      entry({
        seq: 2,
        turn: 1,
        kind: "tool",
        title: "t2",
        duration_ms: 80,
      }),
      entry({ seq: 3, turn: 2, kind: "error", title: "boom", ok: false }),
    ]);
    render(<TimelinePage onClose={vi.fn()} />);

    expect(await screen.findByText("2 次工具调用")).toBeInTheDocument();
    expect(screen.getByText("1 次错误")).toBeInTheDocument();
    expect(screen.getByText("工具耗时 200ms")).toBeInTheDocument();
  });

  /// 对话级隔离：换会话要重新拉该会话的数据。
  it("切换会话时重新拉取该会话的时间线", async () => {
    listTimelineMock.mockResolvedValue([]);
    const { rerender } = render(<TimelinePage onClose={vi.fn()} />);
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalledWith("s1"));

    storeMock.activeId = "s2";
    storeMock.sessions = [
      { id: "s1", title: "会话一" },
      { id: "s2", title: "会话二" },
    ];
    rerender(<TimelinePage onClose={vi.fn()} />);
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalledWith("s2"));
  });

  it("搜索按标题与详情过滤", async () => {
    listTimelineMock.mockResolvedValue([
      entry({ seq: 0, turn: 1, kind: "tool", title: "Read main.rs" }),
      entry({
        seq: 1,
        turn: 1,
        kind: "tool",
        title: "Write out.txt",
        detail: "内容里有 needle",
      }),
    ]);
    render(<TimelinePage onClose={vi.fn()} />);
    await screen.findByText("Read main.rs");

    await userEvent.type(screen.getByLabelText("搜索时间线"), "needle");
    // 命中的留下
    expect(screen.getByText("Write out.txt")).toBeInTheDocument();
    // 不匹配的消失
    expect(screen.queryByText("Read main.rs")).toBeNull();
  });

  /// 详情默认折叠——不然一屏全是参数与输出。
  it("有详情的条目可展开查看", async () => {
    listTimelineMock.mockResolvedValue([
      entry({
        seq: 0,
        turn: 1,
        kind: "tool",
        title: "Read main.rs",
        detail: "参数：{\"path\":\"main.rs\"}",
      }),
    ]);
    render(<TimelinePage onClose={vi.fn()} />);

    const title = await screen.findByText("Read main.rs");
    expect(screen.queryByText(/main\.rs"/)).toBeNull();
    await userEvent.click(title);
    expect(screen.getByText(/参数：/)).toBeInTheDocument();
  });

  it("没有记录时给出引导", async () => {
    listTimelineMock.mockResolvedValue([]);
    render(<TimelinePage onClose={vi.fn()} />);
    expect(
      await screen.findByText(/这个会话还没有操作记录/),
    ).toBeInTheDocument();
  });

  it("读取失败时给出原因", async () => {
    listTimelineMock.mockRejectedValue("数据库被占用");
    render(<TimelinePage onClose={vi.fn()} />);
    expect(await screen.findByText(/数据库被占用/)).toBeInTheDocument();
  });
});
