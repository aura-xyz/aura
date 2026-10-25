import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import {
  addAllowlistPath,
  checkAllowlistPath,
  listAllowlistPaths,
  removeAllowlistPath,
  type AllowlistCheck,
  type AllowlistPathView,
} from "../lib/api";

/**
 * 路径白名单分区（v0.6.2）。
 *
 * 授权一个目录 = 允许模型在里面**读写一切**。所以这里的流程是：
 * 选目录 → 后端判定 → 按判定结果分流（直接加 / 弹窗确认 / 直接拒绝）。
 *
 * 判定永远由后端做（`check_allowlist_path`），前端不自己写一套规则——
 * 两套规则迟早会对不上，而对不上的那次就是安全边界失效的那次。
 */
export default function AllowlistSection() {
  const [items, setItems] = useState<AllowlistPathView[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  /** 待确认的路径：判定为 confirm 时暂存，等用户点「仍然添加」 */
  const [pending, setPending] = useState<AllowlistCheck | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setItems(await listAllowlistPaths());
    } catch (e) {
      setNotice({ kind: "err", text: `读取失败：${String(e)}` });
    }
  }

  /**
   * 选一个目录并加入。
   *
   * 判定为 confirm 时**不直接写入**：先把判定结果存起来，弹窗让用户确认。
   * 判定为 reject 时直接提示，不给「添加」的机会。
   */
  async function pick() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const dir = await open({ directory: true, title: "选择要授权给模型的目录" });
      if (typeof dir !== "string") return;
      const check = await checkAllowlistPath(dir);
      if (check.level === "reject") {
        setNotice({ kind: "err", text: check.reason });
        return;
      }
      if (check.level === "confirm") {
        setPending(check);
        return;
      }
      await commit(check.path, false);
    } catch (e) {
      setNotice({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  /** 真正写入。acknowledged 只表示「用户看到了警告」。 */
  async function commit(path: string, acknowledged: boolean) {
    try {
      setItems(await addAllowlistPath(path, undefined, acknowledged));
      setPending(null);
      setNotice({ kind: "ok", text: "已添加该目录，模型现在可以访问它" });
    } catch (e) {
      setNotice({ kind: "err", text: String(e) });
    }
  }

  async function remove(item: AllowlistPathView) {
    try {
      setItems(await removeAllowlistPath(item.path));
      setNotice({ kind: "ok", text: `已移除「${item.label}」` });
    } catch (e) {
      setNotice({ kind: "err", text: String(e) });
    }
  }

  return (
    <div>
      <div className="flex items-start gap-2">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-subtle" />
        <div className="min-w-0">
          <h3 className="text-sm font-medium">路径白名单</h3>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            授权后，模型可以像在工作区里一样读写这些目录。授权范围之外的文件一律
            访问不到。系统目录与密钥目录永远拒绝授权。
          </p>
        </div>
      </div>

      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {items.map((item) => (
            <li
              key={item.path}
              className="flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2"
            >
              <FolderOpen size={13} className="shrink-0 text-subtle" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.label}</span>
                <span className="block truncate font-mono text-[11px] text-subtle">
                  {item.path}
                </span>
              </span>
              {item.builtin && (
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-subtle">
                  默认
                </span>
              )}
              {!item.exists && (
                <span className="shrink-0 text-[11px] text-danger">目录不存在</span>
              )}
              {!item.builtin && (
                <button
                  type="button"
                  onClick={() => void remove(item)}
                  aria-label={`移除 ${item.label}`}
                  className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:bg-bubble hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => void pick()}
        disabled={busy}
        className="mt-3 rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
      >
        {busy ? "选择中…" : "添加目录"}
      </button>

      {notice && (
        <p
          className={`mt-3 flex items-start gap-2 text-xs ${
            // v0.6.3：成功提示由灰转绿，与失败的红形成对称。
            notice.kind === "ok" ? "text-success" : "text-danger"
          }`}
        >
          {notice.kind === "err" && (
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          )}
          <span className="min-w-0 break-words">{notice.text}</span>
        </p>
      )}

      {/* 隐私警告的确认弹窗 */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-md rounded-card border border-line bg-panel p-5 shadow-xl">
            {/* v0.6.3：警告走 warning 色。此前标题与正文全灰，
                与普通确认弹窗没有区别，用户看不出这是在拦隐私目录。 */}
            <div className="flex items-start gap-2">
              <TriangleAlert
                size={16}
                className="mt-0.5 shrink-0 text-warning"
              />
              <h4 className="text-sm font-medium">确认授权这个目录？</h4>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-subtle">
              {pending.reason}
            </p>
            <p className="mt-2 break-all font-mono text-[11px] text-subtle">
              {pending.path}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:border-brand"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void commit(pending.path, true)}
                className="rounded-full bg-brand px-3 py-1.5 text-xs text-white transition-colors hover:bg-brand-strong"
              >
                仍然添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
