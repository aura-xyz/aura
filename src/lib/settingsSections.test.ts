import { describe, expect, it } from "vitest";
import {
  registerSettingsSection,
  settingsSections,
} from "./settingsSections";

describe("设置分区注册表", () => {
  it("默认四个分区按 order 排列，外观在第一位", () => {
    const ids = settingsSections().map((s) => s.id);
    expect(ids).toEqual(["appearance", "model", "general", "about"]);
  });

  it("新增分区按 order 插队，卸载后列表恢复", () => {
    const dispose = registerSettingsSection({ id: "plugins", label: "插件", order: 25 });
    expect(settingsSections().map((s) => s.id)).toEqual([
      "appearance",
      "model",
      "plugins",
      "general",
      "about",
    ]);
    dispose();
    expect(settingsSections().map((s) => s.id)).not.toContain("plugins");
  });

  it("同 id 重复注册报错，避免两个分区抢一个入口", () => {
    expect(() =>
      registerSettingsSection({ id: "appearance", label: "外观2", order: 99 }),
    ).toThrow(/已注册/);
  });
});
