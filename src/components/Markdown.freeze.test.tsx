import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

/**
 * 只替换 markdown 解析器，其余（切分、memo、组件树）保持真实实现。
 * 计数能精确证明「尾部继续增长时，已完成片段不再进入解析」——
 * 单看 DOM 节点引用证明不了：React 本来就会复用同类型同位置的节点。
 */
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    calls.push(children);
    return <p>{children}</p>;
  },
}));

import Markdown from "./Markdown";

const longA = "开头".repeat(400);
const longB = "中段".repeat(400);

describe("稳定片段冻结", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("尾部继续增长时，已完成片段不再交给解析器", () => {
    const base = `${longA}\n\n${longB}`;
    const { rerender } = render(<Markdown content={base} />);
    const initial = [...calls];
    // 前提：确实切成了多个片段，否则这条断言没有意义
    expect(initial.length).toBeGreaterThan(1);

    rerender(<Markdown content={`${base}继续输出`} />);

    // 只有尾部片段被重新解析
    expect(calls).toHaveLength(initial.length + 1);
    expect(calls[calls.length - 1]).toContain("继续输出");
    expect(calls.filter((c) => c === initial[0])).toHaveLength(1);
  });

  it("短回答未分段时，每次内容变化仍只解析一次", () => {
    const { rerender } = render(<Markdown content="你好" />);
    expect(calls).toHaveLength(1);
    rerender(<Markdown content="你好，Aura" />);
    expect(calls).toHaveLength(2);
  });
});
