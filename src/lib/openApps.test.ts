import { describe, expect, it } from "vitest";
import { normalizeOpenApps } from "./openApps";

describe("在…中打开：菜单数据", () => {
  it("空列表也要有资源管理器默认项", () => {
    expect(normalizeOpenApps([])).toEqual([
      { id: "explorer", name: "文件资源管理器" },
    ]);
  });

  it("资源管理器不在首位时提到首位", () => {
    const apps = normalizeOpenApps([
      { id: "vscode", name: "VS Code" },
      { id: "explorer", name: "文件资源管理器" },
      { id: "rider", name: "Rider" },
    ]);
    expect(apps.map((a) => a.id)).toEqual(["explorer", "vscode", "rider"]);
  });

  it("重复 id 与空 id 被去掉，未知应用仍保留", () => {
    const apps = normalizeOpenApps([
      { id: "explorer", name: "文件资源管理器" },
      { id: "vscode", name: "VS Code" },
      { id: "vscode", name: "VS Code 重复" },
      { id: "", name: "空" },
      { id: "future-ide", name: "未来 IDE" },
    ]);
    expect(apps.map((a) => a.id)).toEqual([
      "explorer",
      "vscode",
      "future-ide",
    ]);
  });
});
