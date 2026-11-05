import { describe, expect, it } from "vitest";
import {
  findSlashTrigger,
  resolveSlashQuery,
  SLASH_COMMANDS,
} from "./slashCommands";

describe("斜杠命令", () => {
  it("输入 / 时列出全部 5 个根命令，不再直接列技能", () => {
    const r = resolveSlashQuery("");
    expect(r.matches.map((c) => c.id)).toEqual([
      "skill",
      "goal",
      "model",
      "mode",
      "export",
    ]);
    expect(r.command).toBeUndefined();
  });

  it("中英文别名都能进入二级面板，参数单独切出来", () => {
    expect(resolveSlashQuery("skill").command).toBe("skill");
    const zh = resolveSlashQuery("目标 写完报告");
    expect(zh.command).toBe("goal");
    expect(zh.args).toBe("写完报告");
    expect(resolveSlashQuery("模型").command).toBe("model");
    expect(resolveSlashQuery("模式").command).toBe("mode");
    expect(resolveSlashQuery("导出").command).toBe("export");
  });

  it("前缀过滤与未知输入", () => {
    expect(resolveSlashQuery("sk").matches.map((c) => c.id)).toEqual(["skill"]);
    expect(resolveSlashQuery("不存在的命令").matches).toEqual([]);
    expect(SLASH_COMMANDS).toHaveLength(5);
  });
});

describe("输入框里的斜杠触发", () => {
  it("只认词首的 /，路径里的斜杠不弹面板", () => {
    expect(findSlashTrigger("src/lib", 8)).toBeNull();
    expect(findSlashTrigger("foo/bar", 7)).toBeNull();
    expect(findSlashTrigger("@<app/src>", 11)).toBeNull();
    expect(findSlashTrigger("先看下 /", 6)).not.toBeNull();
  });

  it("参数可以带空格，整段作为 query 交给解析器", () => {
    const t = findSlashTrigger("/目标 写完报告", 9);
    expect(t?.query).toBe("目标 写完报告");
    expect(resolveSlashQuery(t!.query).command).toBe("goal");
    expect(resolveSlashQuery(t!.query).args).toBe("写完报告");
  });

  it("光标位置即 query 终点，不越行", () => {
    expect(findSlashTrigger("/skill docx", 6)?.query).toBe("skill");
    expect(findSlashTrigger("/goal\n第二行", 12)).toBeNull();
  });
});
