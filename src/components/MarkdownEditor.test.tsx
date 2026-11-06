import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LexicalEditor } from "lexical";
import MarkdownEditor, {
  editorMarkdown,
  setEditorMarkdown,
  type EditorSnapshot,
} from "./MarkdownEditor";

/**
 * 组件单测默认把「实时渲染」关掉走 textarea，这里单独覆盖 Lexical 路径。
 * 不模拟 contenteditable 的按键（jsdom 没有排版测量），而是通过
 * editorRef 做程序写入，验证「Markdown 进去、Markdown 出来」这条契约。
 */
describe("MarkdownEditor", () => {
  it("渲染可编辑区与占位提示，并暴露 editor 实例", () => {
    const editorRef = { current: null as LexicalEditor | null };
    render(
      <MarkdownEditor
        initialValue=""
        editorRef={editorRef}
        onChange={vi.fn()}
        onKeyDown={vi.fn()}
        placeholder="输入消息…"
      />,
    );
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeInTheDocument();
    expect(screen.getByText("输入消息…")).toBeInTheDocument();
    expect(editorRef.current).not.toBeNull();
  });

  /// 光标与占位文字必须落在同一行盒上。占位层若用 top-2 而首行从
  /// py-0.5 起，浏览器画的竖杠会比「输入消息…」高出一截（实测反馈）。
  it("占位层与首行文本盒共用 padding、行高与起点", () => {
    render(
      <MarkdownEditor
        initialValue=""
        editorRef={{ current: null }}
        onChange={vi.fn()}
        onKeyDown={vi.fn()}
        placeholder="输入消息…"
      />,
    );
    const box = screen.getByRole("textbox", { name: "消息输入框" });
    const placeholder = screen.getByText("输入消息…");
    for (const token of ["py-0.5", "leading-6"]) {
      expect(box.className).toContain(token);
      expect(placeholder.className).toContain(token);
    }
    expect(placeholder.className).toContain("top-0");
    expect(placeholder.className).not.toContain("top-2");
  });

  it("初始 Markdown 与程序写入都按原始 Markdown 往返，不发 HTML", async () => {
    const onChange = vi.fn<(s: EditorSnapshot, programmatic: boolean) => void>();
    const editorRef = { current: null as LexicalEditor | null };
    render(
      <MarkdownEditor
        initialValue="**加粗**"
        editorRef={editorRef}
        onChange={onChange}
        onKeyDown={vi.fn()}
        placeholder="输入消息…"
      />,
    );
    const editor = editorRef.current;
    expect(editor).not.toBeNull();
    expect(editorMarkdown(editor!)).toContain("**加粗**");

    await act(async () => {
      setEditorMarkdown(editor!, "# 标题\n\n- 甲\n- 乙");
    });
    expect(editorMarkdown(editor!)).toContain("# 标题");
    await waitFor(() => {
      const calls = onChange.mock.calls as Array<[EditorSnapshot, boolean]>;
      expect(
        calls.some(([s, programmatic]) => programmatic && s.markdown.includes("# 标题")),
      ).toBe(true);
    });
  });

  /// 关键契约：输入框的 keydown 必须能在事件到达 contentEditable 之前
  /// 拦下来。若退化成 ContentEditable 的 onKeyDown（冒泡），Lexical 的
  /// 原生监听会先插段落，Enter 发送 / Tab 切模式都会带一串多余内容。
  it("捕获阶段能先于 contentEditable 的原生监听拦下按键", () => {
    let reachedTarget = false;
    const onKeyDown = vi.fn((e: ReactKeyboardEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
    });
    render(
      <MarkdownEditor
        initialValue=""
        editorRef={{ current: null }}
        onChange={vi.fn()}
        onKeyDown={onKeyDown}
        placeholder="输入消息…"
      />,
    );
    const box = screen.getByRole("textbox", { name: "消息输入框" });
    box.addEventListener("keydown", () => {
      reachedTarget = true;
    });
    fireEvent.keyDown(box, { key: "Enter", bubbles: true, cancelable: true });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(reachedTarget).toBe(false);
  });

  it("清空后编辑器回到空 Markdown，不是留下一个空 HTML 段落字符串", () => {
    const editorRef = { current: null as LexicalEditor | null };
    render(
      <MarkdownEditor
        initialValue="一段话"
        editorRef={editorRef}
        onChange={vi.fn()}
        onKeyDown={vi.fn()}
        placeholder="输入消息…"
      />,
    );
    const editor = editorRef.current!;
    act(() => {
      setEditorMarkdown(editor, "");
    });
    expect(editorMarkdown(editor).trim()).toBe("");
  });
});
