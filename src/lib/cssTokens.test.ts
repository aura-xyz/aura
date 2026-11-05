import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");

describe("设计令牌命名", () => {
  /**
   * v0.8.0 前同时存在 --dsw-alias-*、--dsw-*、--ds-*、--dsh-* 四套前缀，
   * 同一个圆角/字号概念散在不同名字里，改一处漏一处且不会有编译错误。
   * 现在统一到 --dsw-alias-*；--color-* 是 Tailwind 的命名空间，保留。
   */
  it("自定义变量不再出现旧前缀", () => {
    const legacy = Array.from(
      css.matchAll(/--(?:dsw-(?!alias)|ds-|dsh-)[a-z0-9-]+/g),
      (m) => m[0],
    );
    expect(legacy).toEqual([]);
  });

  it("三角色字号集中在同一前缀下，且都有消费者", () => {
    for (const name of [
      "--dsw-alias-font-size-content",
      "--dsw-alias-font-size-code",
      "--dsw-alias-font-size-terminal",
    ]) {
      expect(css).toContain(`${name}:`);
      expect(css).toContain(`var(${name}`);
    }
  });

  it("外壳灰底令牌在亮暗两套主题里都有定义", () => {
    expect(css).toContain("--chrome-bg:");
    expect((css.match(/--chrome-bg:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
