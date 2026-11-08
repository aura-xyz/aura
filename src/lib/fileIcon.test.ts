import { describe, expect, it } from "vitest";
import { extensionOf, fileKindOf, sortEntries } from "./fileIcon";
import type { DirEntry } from "./api";

function entry(name: string, is_dir = false): DirEntry {
  return { name, path: `/${name}`, is_dir, size: 0 };
}

describe("extensionOf", () => {
  it("取小写扩展名", () => {
    expect(extensionOf("App.TSX")).toBe("tsx");
    expect(extensionOf("a.b.md")).toBe("md");
  });

  it("无扩展名与点开头的隐藏文件都返回空串", () => {
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("trailing.")).toBe("");
  });
});

describe("fileKindOf", () => {
  it("按档位分类", () => {
    expect(fileKindOf("README.md")).toBe("markdown");
    expect(fileKindOf("store.tsx")).toBe("code");
    expect(fileKindOf("Cargo.lock")).toBe("data");
    expect(fileKindOf("logo.png")).toBe("image");
    expect(fileKindOf("index.css")).toBe("style");
    expect(fileKindOf("LICENSE")).toBe("text");
  });
});

describe("sortEntries", () => {
  /// 后端顺序不保证（各平台 readdir 不同），面板自己定序，
  /// 用户每次打开同一目录看到的是同一份顺序。
  it("目录恒在前，其次按名称（数字按数值比）", () => {
    const sorted = sortEntries([
      entry("b.ts"),
      entry("src", true),
      entry("a.md"),
      entry("v10"),
      entry("v2"),
      entry("docs", true),
    ]);
    expect(sorted.map((e) => e.name)).toEqual([
      "docs",
      "src",
      "a.md",
      "b.ts",
      "v2",
      "v10",
    ]);
  });

  it("不改动入参数组", () => {
    const input = [entry("b"), entry("a")];
    sortEntries(input);
    expect(input.map((e) => e.name)).toEqual(["b", "a"]);
  });
});
