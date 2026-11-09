import { describe, expect, it } from "vitest";
import { normalizeOpenApps } from "./openApps";

describe("在…中打开：菜单数据", () => {
  it("空列表保持为空（默认项由后端保证，前端不再注入 explorer）", () => {
    expect(normalizeOpenApps([])).toEqual([]);
  });

  it("完全沿用后端顺序（默认项已由后端排在首位）", () => {
    const apps = normalizeOpenApps([
      { id: "xdg-open", name: "文件管理器" },
      { id: "vscode", name: "VS Code" },
      { id: "rider", name: "Rider" },
    ]);
    expect(apps.map((a) => a.id)).toEqual(["xdg-open", "vscode", "rider"]);
  });

  it("重复 id 与空 id 被去掉，未知应用仍保留", () => {
    const apps = normalizeOpenApps([
      { id: "xdg-open", name: "文件管理器" },
      { id: "vscode", name: "VS Code" },
      { id: "vscode", name: "VS Code 重复" },
      { id: "", name: "空" },
      { id: "future-ide", name: "未来 IDE" },
    ]);
    expect(apps.map((a) => a.id)).toEqual([
      "xdg-open",
      "vscode",
      "future-ide",
    ]);
  });
});
