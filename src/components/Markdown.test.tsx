import { render, screen } from "@testing-library/react";
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