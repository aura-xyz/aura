import { describe, expect, it } from "vitest";
import { normalizeBrowserUrl } from "./browser";

describe("normalizeBrowserUrl", () => {
  it("保留完整 http/https 地址", () => {
    expect(normalizeBrowserUrl("https://example.com/a?b=1")).toBe(
      "https://example.com/a?b=1",
    );
    expect(normalizeBrowserUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000/",
    );
  });

  it("裸域名补 https", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com");
    expect(normalizeBrowserUrl("sub.example.co.uk/path")).toBe(
      "https://sub.example.co.uk/path",
    );
  });

  it("带空格的输入当作搜索词", () => {
    expect(normalizeBrowserUrl("react useEffect")).toBe(
      "https://www.bing.com/search?q=react%20useEffect",
    );
  });

  it("空输入返回空串", () => {
    expect(normalizeBrowserUrl("   ")).toBe("");
  });
});
