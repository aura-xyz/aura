import { useState, useSyncExternalStore } from "react";
import { ShieldAlert, TerminalSquare } from "lucide-react";
import {
  approvalsSnapshot,
  decideApproval,
  subscribeApprovals,
  type ApprovalRequest,
} from "../lib/approvals";
import { notify } from "../lib/notices";

/**
 * 命令审批卡（v0.8.0 C41）。
 *
 * 模型要执行一条被规则挑出来的命令时，后端停下来等用户点头。这张卡就是
 * 那个「停下来」的界面：把命令原文、命中原因、规则 id 一次摆清楚，
 * 三个动作（允许 / 拒绝 / 允许并记住此类）都只影响**本次会话**。
 *
 * 几个刻意的取舍：
 *
 * - **命令原文必须完整可读**：只给摘要等于让用户盲签。长命令给滚动区，
 *   但不截断内容。
 * - **拒绝不加「记住」**：记住拒绝等于永久拉黑这条规则，而用户通常只是
 *   这一次不想跑。想要更严格就改策略档位，那是另一回事。
 * - **超时不假装成功**：后端 120 秒后会拒绝，前端撤卡时给一句提示，
 *   否则用户会以为命令被执行了。
 */
export default function ApprovalCard({ sessionId }: { sessionId: string }) {
  const all = useSyncExternalStore(
    subscribeApprovals,
    approvalsSnapshot,
    approvalsSnapshot,
  );
  const requests = all.filter((r) => r.sessionId === sessionId);
  if (requests.length === 0) return null;

  return (
    <div className="mx-auto w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl px-3 pb-1.5">
      <div className="flex flex-col gap-2">
        {requests.map((req) => (
          <ApprovalItem key={req.id} request={req} />
        ))}
      </div>
    </div>
  );
}

function ApprovalItem({ request }: { request: ApprovalRequest }) {
  const [busy, setBusy] = useState(false);
  const seconds = Math.round(request.timeoutMs / 1000);

  async function decide(approved: boolean, remember = false) {
    if (busy) return;
    setBusy(true);
    try {
      const accepted = await decideApproval({ id: request.id, approved, remember });
      if (!accepted) {
        notify("error", "这条请求已经失效（可能已超时）");
      } else if (!approved) {
        notify("ok", "已拒绝该命令");
      }
    } catch (e) {
      notify("error", `决议失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      role="alertdialog"
      aria-label={`需要确认的命令：${request.preview}`}
      className="rounded-card border border-warning/40 bg-surface shadow-sm"
    >
      <header className="flex items-start gap-2 border-b border-line px-3 py-2">
        <ShieldAlert size={14} aria-hidden className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground">
            需要确认：{request.reason}
          </p>
          <p className="mt-0.5 text-[11px] text-subtle">
            规则 {request.ruleId} · {seconds} 秒内未确认将自动取消
          </p>
        </div>
      </header>

      <div className="flex items-start gap-2 px-3 py-2">
        <TerminalSquare
          size={13}
          aria-hidden
          className="mt-1 shrink-0 text-subtle"
        />
        <pre className="max-h-32 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-tag bg-bubble px-2 py-1.5 font-mono text-[12px] text-foreground">
          {request.command}
        </pre>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-1.5 border-t border-line px-3 py-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(false)}
          className="rounded-tag px-2.5 py-1 text-[12px] text-subtle transition-colors enabled:hover:bg-bubble enabled:hover:text-foreground disabled:opacity-50"
        >
          拒绝
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(true, true)}
          title="本会话内不再询问同一条规则"
          className="rounded-tag px-2.5 py-1 text-[12px] text-foreground transition-colors enabled:hover:bg-bubble disabled:opacity-50"
        >
          允许并记住
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(true)}
          className="rounded-tag bg-brand px-2.5 py-1 text-[12px] font-medium text-white transition-opacity enabled:hover:opacity-90 disabled:opacity-50"
        >
          允许
        </button>
      </footer>
    </section>
  );
}
