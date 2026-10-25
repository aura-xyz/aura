import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 代码块语言标签。
 *
 * 模型几乎总会带上 ```rust 这类语言标识，但界面上看不到——用户只能靠
 * 猜。这里钉住「有标识就显示，没有就不显示」。
 */
beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("../store");
});

async function renderMd(content: string) {
  const { default: Markdown } = await import("./Markdown");
  return render(<Markdown content={content} />);
}

describe("Markdown 代码块语言标签", () => {
  it("有语言标识时显示标签", async () => {
    await renderMd("```rust\nfn main() {}\n```");
    expect(screen.getByText("Rust")).toBeInTheDocument();
  });

  it("语言标识大小写不敏感", async () => {
    await renderMd("```TypeScript\nconst a = 1;\n```");
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
  });

  it("未知语言直接回退到标识本身", async () => {
    // 不该把 lang-xx 猜成一个错误的名字，宁可原样显示
    await renderMd("```nim\ndiscard\n```");
    expect(screen.getByText("nim")).toBeInTheDocument();
  });

  it("没有语言标识时不显示标签", async () => {
    await renderMd("```\nplain text\n```");
    expect(screen.queryByText(/^\w+$/, { selector: ".md-code-lang" })).toBeNull();
  });

  it("行内代码不会被误判成代码块", async () => {
    await renderMd("这是 `const x = 1;` 这样的行内代码。");
    expect(screen.queryByText("TypeScript")).toBeNull();
    expect(screen.queryByText("const")).toBeNull();
  });
});

/**
 * 高亮语言注册（v0.6.0）。
 *
 * rehype-highlight 的 `languages` 选项是**替换**而非追加默认集——
 * 只传新增语言会让 bash/rust/python 静默失去高亮（界面只是没了颜色，
 * 不报错）。这一组断言钉住三件事：默认集还在、新注册的真的在解析、
 * 未注册的不解析。
 */
describe("Markdown 高亮语言注册", () => {
  it("默认语言仍然高亮（common 集没被 languages 选项顶掉）", async () => {
    const { container } = await renderMd("```rust\nfn main() {}\n```");
    expect(container.querySelector('code [class*="hljs-"]')).not.toBeNull();
  });

  it("补充注册的语言真正生效（http：自动检测对它是零 token）", async () => {
    // 为什么挑 http 做判别：未注册时 rehype-highlight 的 highlight 抛错后
    // 走 highlightAuto 兜底，而自动检测对 HTTP 报文完全无感（零 token）——
    // 所以 hljs-meta 只可能来自显式注册，这条断言骗不了人。
    // （toml 之类不行：自动检测能猜个八九不离十，断言会假绿。）
    const { container } = await renderMd(
      "```http\nPOST /v1/chat HTTP/1.1\nHost: api.example.com\n```",
    );
    expect(container.querySelector("code .hljs-meta")).not.toBeNull();
  });

  it("toml 代码块有高亮（ini 语法覆盖，无独立 toml 文件）", async () => {
    // 这条盯用户可见结果：```toml 必须有颜色。ini 的别名含 toml，
    // 注册 ini 即覆盖；即便换实现，结论不能变。
    const { container } = await renderMd('```toml\n[package]\nname = "aura"\n```');
    expect(container.querySelector('code [class*="hljs-"]')).not.toBeNull();
    expect(screen.getByText("TOML")).toBeInTheDocument();
  });

  it("未注册的语言不高亮（对照组）", async () => {
    const { container } = await renderMd("```nim\nvar x = 1\n```");
    expect(container.querySelector('code [class*="hljs-"]')).toBeNull();
  });
});

/**
 * 代码块文本提取（v0.7.0 回归）。
 *
 * 高亮后 `<code>` 的子节点是「一堆 span + 夹在 span 之间的字符串」。
 * 早先的提取只保留字符串节点，于是**所有 span 里的文字都丢了**：
 *
 * ```html
 * <span class="hljs-attr">path</span> = <span class="hljs-string">"/projects"</span>
 * ```
 *
 * 提取出来只剩 `" = "`。后果有两个：
 * 折叠预览显示成 `=`、`= [ , , ]`（用户实测截图）；
 * **「复制代码」复制到的是残缺代码**（同一个字符串）。
 */
describe("Markdown 代码块文本提取", () => {
  it("折叠预览保留完整代码，不只剩 span 之间的字符串", async () => {
    const lines = Array.from(
      { length: 25 },
      (_, i) => `key${i} = "value${i}"`,
    );
    const { container } = await renderMd("```toml\n" + lines.join("\n") + "\n```");

    const collapsed = container.querySelector("pre.md-code-collapsed");
    expect(collapsed).not.toBeNull();
    // 第一行的完整内容必须在：键名与字符串字面量都不能丢
    expect(collapsed?.textContent).toContain('key0 = "value0"');
    expect(collapsed?.textContent).toContain('key1 = "value1"');
  });

  it("复制按钮复制的是完整代码，不是残缺片段", async () => {
    const { copyMock } = vi.hoisted(() => ({ copyMock: vi.fn() }));
    vi.doMock("../lib/clipboard", () => ({ copyText: copyMock }));
    copyMock.mockResolvedValue(true);

    await renderMd('```toml\npath = "/projects"\n```');
    await userEvent.click(screen.getByRole("button", { name: "复制代码" }));

    expect(copyMock).toHaveBeenCalledTimes(1);
    // 代码块内容自带结尾换行，比对时去掉
    const copied = (copyMock.mock.calls[0][0] as string).trim();
    expect(copied).toBe('path = "/projects"');
  });
});