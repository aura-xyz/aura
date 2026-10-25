import { describe, expect, it } from "vitest";
import { decideDrop, formatAttachment, parentDir, stricter } from "./drop";

describe("parentDir", () => {
  it("取所在目录", () => {
    expect(parentDir("C:/a/b.txt")).toBe("C:/a");
    expect(parentDir("C:/a/b/c.txt")).toBe("C:/a/b");
  });

  it("反斜杠也认", () => {
    expect(parentDir("C:\\a\\b.txt")).toBe("C:\\a");
  });

  it("输入本身是目录时取它的父目录", () => {
    // 函数名就是 parentDir：输入 `C:/a` 拿的是 `C:/a` 的父目录。
    // 拖入的是目录还是文件由调用方另行判定（两者都判，取更严的档）。
    expect(parentDir("C:/a")).toBe("C:/");
  });

  it("盘符根不会被截成 C:", () => {
    expect(parentDir("C:/a.txt")).toBe("C:/");
    expect(parentDir("C:/")).toBe("C:/");
  });

  it("尾部斜杠先去掉再取目录", () => {
    expect(parentDir("C:/a/b/")).toBe("C:/a");
  });

  it("没有目录分隔符时原样返回", () => {
    expect(parentDir("file.txt")).toBe("file.txt");
  });
});

describe("formatAttachment", () => {
  it("包成尖括号形式，路径含空格也能读清", () => {
    expect(formatAttachment(["C:/a/my file.txt"])).toBe("@<C:/a/my file.txt>");
  });

  it("多个路径用空格分隔", () => {
    expect(formatAttachment(["a.txt", "b.txt"])).toBe("@<a.txt> @<b.txt>");
  });

  it("空数组返回空串", () => {
    expect(formatAttachment([])).toBe("");
  });
});

describe("stricter", () => {
  it("取更严的那一档", () => {
    expect(stricter("allow", "reject")).toBe("reject");
    expect(stricter("reject", "allow")).toBe("reject");
    expect(stricter("allow", "confirm")).toBe("confirm");
    expect(stricter("confirm", "allow")).toBe("confirm");
  });

  it("相同则取该值", () => {
    expect(stricter("allow", "allow")).toBe("allow");
    expect(stricter("reject", "reject")).toBe("reject");
  });

  it("unknown 比 allow 严、比 confirm 宽", () => {
    // unknown 表示判定失败，不能当 allow 放行，但也不该直接拦下
    expect(stricter("allow", "unknown")).toBe("unknown");
    expect(stricter("unknown", "allow")).toBe("unknown");
    expect(stricter("unknown", "confirm")).toBe("confirm");
  });
});

describe("decideDrop", () => {
  it("全部允许时附加且无提示", () => {
    const d = decideDrop(["a.txt", "b.txt"], ["allow", "allow"]);
    expect(d.attach).toBe(true);
    expect(d.notice).toBeNull();
  });

  it("拒绝的路径不附加并给出提示", () => {
    const d = decideDrop(["a.txt", "C:/Windows/System32/x"], ["allow", "reject"]);
    expect(d.attach).toBe(true); // 至少有一个可附加
    expect(d.notice).toContain("1 个路径属于系统或密钥目录");
  });

  it("全部被拒时不附加", () => {
    const d = decideDrop(["C:/Windows/x"], ["reject"]);
    expect(d.attach).toBe(false);
    expect(d.notice).toContain("已跳过");
  });

  it("需授权的路径仍附加，但提示要授权", () => {
    const d = decideDrop(["C:/Users/x/Desktop/a.txt"], ["confirm"]);
    expect(d.attach).toBe(true);
    expect(d.notice).toContain("需要先在设置里授权");
  });

  it("判定未知时照常附加、不提示", () => {
    // 判定失败不能擅自丢弃用户的拖入
    const d = decideDrop(["a.txt"], ["unknown"]);
    expect(d.attach).toBe(true);
    expect(d.notice).toBeNull();
  });

  it("两种提示都存在时用分号连接", () => {
    const d = decideDrop(
      ["a.txt", "b.txt", "c.txt"],
      ["confirm", "reject", "allow"],
    );
    expect(d.notice).toContain("；");
    expect(d.notice).toContain("1 个路径所在目录需要先在设置里授权");
    expect(d.notice).toContain("1 个路径属于系统或密钥目录");
  });

  it("空路径列表不附加", () => {
    const d = decideDrop([], []);
    expect(d.attach).toBe(false);
    expect(d.notice).toBeNull();
  });
});
