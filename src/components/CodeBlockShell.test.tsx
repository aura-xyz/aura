import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CodeBlockShell from "./CodeBlockShell";

function code(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\n");
}

describe("CodeBlockShell 工具条带", () => {
  /// C20：语言标签与复制按钮固定在同一条 32px 条带里，
  /// 不再绝对定位浮在代码上（长代码横滚会盖住内容）。
  it("语言标签与复制按钮同处条带", () => {
    const { container } = render(
      <CodeBlockShell lang="ts" code={code(3)}>
        <code>line 1</code>
      </CodeBlockShell>,
    );
    const bar = container.querySelector(".md-code-bar");
    expect(bar).not.toBeNull();
    expect(bar).toHaveTextContent("TypeScript");
    expect(within(bar as HTMLElement).getByRole("button", { name: /复制代码/ })).toBeInTheDocument();
  });

  it("没有语言标注时条带显示纯文本，不留空条", () => {
    const { container } = render(
      <CodeBlockShell lang={null} code="echo hi">
        <code>echo hi</code>
      </CodeBlockShell>,
    );
    expect(container.querySelector(".md-code-bar")).toHaveTextContent("纯文本");
  });

  it("长代码的折叠入口也在条带里", () => {
    const { container } = render(
      <CodeBlockShell lang="ts" code={code(40)}>
        <code>x</code>
      </CodeBlockShell>,
    );
    const bar = container.querySelector(".md-code-bar") as HTMLElement;
    expect(within(bar).getByRole("button", { name: "展开代码" })).toBeInTheDocument();
    expect(within(bar).getByText(/展开全部 40 行/)).toBeInTheDocument();
  });
});
