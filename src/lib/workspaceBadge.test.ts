import { describe, expect, it } from "vitest";
import { workspaceInitial, workspaceTint } from "./workspaceBadge";

describe("workspaceInitial", () => {
  it("英文取首字母并大写，中文原样", () => {
    expect(workspaceInitial("aura")).toBe("A");
    expect(workspaceInitial("dev-tools")).toBe("D");
    expect(workspaceInitial("修 bug")).toBe("修");
  });

  it("空名给占位符，不用空白撑坏方块", () => {
    expect(workspaceInitial("")).toBe("?");
    expect(workspaceInitial("   ")).toBe("?");
  });

  /// emoji / 罕见字按码点切，不能切出半个代理对（会显示成 �）
  it("按码点取首字，不切断代理对", () => {
    expect(workspaceInitial("🚀 rocket")).toBe("🚀");
    expect(workspaceInitial("𝄞music")).toBe("𝄞");
  });
});

describe("workspaceTint", () => {
  /// 同一个名字必须永远同一色：换顺序、重开应用都不能变，
  /// 否则用户靠颜色记工作区会失效。
  it("同名稳定，与调用顺序无关", () => {
    const a = workspaceTint("E:/dev/aura");
    for (let i = 0; i < 5; i++) {
      expect(workspaceTint("E:/dev/aura")).toBe(a);
    }
  });

  it("返回值取自固定的低饱和档位", () => {
    const allowed = ["bg-brand/10", "bg-success/10", "bg-warning/10", "bg-danger/10", "bg-link/10"];
    for (const name of ["aura", "other", "修 bug", "🚀", ""]) {
      const tint = workspaceTint(name);
      expect(allowed.some((cls) => tint.startsWith(cls))).toBe(true);
    }
  });
});
