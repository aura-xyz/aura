import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ModelSelect from "./ModelSelect";
import type { ModelInfo } from "../lib/api";

const MODELS: ModelInfo[] = [
  {
    key: "p:a",
    id: "a",
    label: "模型甲",
    provider: "p",
    provider_name: "厂商",
    context_limit: 100,
    pinned: true,
  },
  {
    key: "p:b",
    id: "b",
    label: "模型乙",
    provider: "p",
    provider_name: "厂商",
    context_limit: 100,
    pinned: true,
  },
];

describe("输入框模型选择器", () => {
  it("选中项用复合 key 能显示名称", () => {
    render(<ModelSelect models={MODELS} selectedModel="p:a" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "选择模型" })).toHaveTextContent("模型甲");
  });

  /// 实测反馈：模型列表能显示，但选择器一直「加载中…」。
  /// 有模型却没选中是稳定状态，不该伪装成加载。
  it("有模型但未选中时提示选择，不再持续显示加载中", () => {
    render(<ModelSelect models={MODELS} selectedModel="" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "选择模型" });
    expect(trigger).toHaveTextContent("选择模型");
    expect(trigger.textContent).not.toContain("加载中");
    expect(trigger).not.toBeDisabled();
  });

  it("一个模型都没有时明确说明并禁用", () => {
    render(<ModelSelect models={[]} selectedModel="" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "选择模型" });
    expect(trigger).toHaveTextContent("无可用模型");
    expect(trigger).toBeDisabled();
  });

  it("旧配置用裸 id 也能回显，不会退化成未选中", () => {
    render(<ModelSelect models={MODELS} selectedModel="b" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "选择模型" })).toHaveTextContent("模型乙");
  });

  it("点选模型回传复合 key", () => {
    const onChange = vi.fn();
    render(<ModelSelect models={MODELS} selectedModel="p:a" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    fireEvent.click(screen.getByRole("option", { name: /模型乙/ }));
    expect(onChange).toHaveBeenCalledWith("p:b");
  });
});
