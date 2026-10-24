import { open } from "@tauri-apps/plugin-dialog";
import { Folder, FolderOpen } from "lucide-react";
import { useState } from "react";

interface Props {
  /** 当前对话已绑定的目录；空串表示还没选 */
  workspace: string;
  onChange: (path: string) => Promise<void>;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * 输入区的工作区选择。
 *
 * 新建对话先落到一个空目录，等在这里选定后才算定了归属。样式对齐
 * `ModelSelect`（同为输入区下方的次级文字按钮）。
 */
export default function WorkspaceSelect({ workspace, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const unset = !workspace;

  async function pick() {
    setBusy(true);
    try {
      const dir = await open({ directory: true, title: "选择工作区目录" });
      if (typeof dir === "string") await onChange(dir);
    } catch {
      /* 用户取消或目录无效时静默 */
    } finally {
      setBusy(false);
    }
  }

  const Icon = unset ? Folder : FolderOpen;

  return (
    <button
      type="button"
      onClick={pick}
      disabled={busy}
      aria-label={unset ? "选择工作区目录" : `工作区：${basename(workspace)}`}
      title={workspace || "选择工作区目录"}
      // shrink-0 + 内部 truncate：工作区名要能被截断，但不能把图标压扁。
      className={`flex min-w-0 items-center gap-1.5 py-1 text-xs transition-colors hover:text-foreground disabled:opacity-60 ${
        unset ? "text-brand" : "text-subtle"
      }`}
    >
      <Icon size={13} className="shrink-0" />
      <span className="max-w-[180px] truncate">
        {unset ? "选择工作区" : basename(workspace)}
      </span>
    </button>
  );
}