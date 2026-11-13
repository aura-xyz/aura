import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  getApprovalPolicy,
  listSecurityEvents,
  securityExportEvents,
  setApprovalPolicy,
  type ApprovalPolicyId,
  type SecurityEvent,
} from "../lib/api";
import { notify } from "../lib/notices";

/**
 * 设置 · 安全（v0.8.0 C43）。
 *
 * 两块内容：
 *
 * 1. **命令审批策略**——三档，写全局默认。会话里的审批卡还能「记住这条规则」，
 *    那是会话级的临时放宽，不动这里的全局设置。
 * 2. **最近的安全事件**——拦截、越权、模式拒绝、审批与高风险安装。
 *
 * 为什么把事件做成只读列表而不是可清除的日志：它是排查依据。用户看到
 * 「刚才那条命令为什么跑不了」时，答案在这里；能一键清空就等于把证据
 * 也一起删了。要带走就导出 CSV。
 */

const KIND_META: Record<string, { label: string; tone: string }> = {
  blocked_command: { label: "命令拦截", tone: "text-danger" },
  path_denied: { label: "路径越权", tone: "text-danger" },
  mode_denied: { label: "模式拦截", tone: "text-warning" },
  approval_denied: { label: "审批拒绝", tone: "text-warning" },
  approval_allowed: { label: "审批放行", tone: "text-success" },
  risky_install: { label: "高风险安装", tone: "text-warning" },
  mcp_call: { label: "MCP 调用", tone: "text-subtle" },
  mcp_trust_change: { label: "MCP 信任变更", tone: "text-warning" },
  mcp_resource: { label: "MCP 资源读取", tone: "text-subtle" },
  mcp_prompt: { label: "MCP 提示词展开", tone: "text-subtle" },
};

const POLICIES: Array<{ id: ApprovalPolicyId; label: string; hint: string }> = [
  {
    id: "strict",
    label: "每条命令都询问",
    hint: "最严格。适合把模型当成不可信来源时使用。",
  },
  {
    id: "dangerous",
    label: "仅危险命令询问（默认）",
    hint: "命中规则的可疑命令暂停等确认，明确破坏性的仍直接拒绝。",
  },
  {
    id: "auto",
    label: "不询问（敏感操作除外）",
    hint: "省事优先；但读写凭据（.ssh、.aws/credentials 等）与破坏性命令仍会拦。",
  },
];

function formatTime(tsMs: number): string {
  const d = new Date(tsMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

export default function SecuritySection() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [policy, setPolicy] = useState<ApprovalPolicyId>("dangerous");
  const [savingPolicy, setSavingPolicy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listSecurityEvents(100);
      setEvents(rows);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 空会话 id = 看全局默认（会话级覆盖只在具体会话里才有）
    void getApprovalPolicy("")
      .then((v) => setPolicy(v.policy))
      .catch(() => {});
  }, [load]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) map.set(e.kind, (map.get(e.kind) ?? 0) + 1);
    return map;
  }, [events]);

  const visible = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.kind === filter)),
    [events, filter],
  );

  async function changePolicy(next: ApprovalPolicyId) {
    const prev = policy;
    setPolicy(next);
    setSavingPolicy(true);
    try {
      await setApprovalPolicy(next);
      notify("ok", "审批策略已更新");
    } catch (e) {
      setPolicy(prev);
      notify("error", `保存失败：${String(e)}`);
    } finally {
      setSavingPolicy(false);
    }
  }

  async function exportCsv() {
    try {
      const path = await save({
        defaultPath: "aura-security-events.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      const n = await securityExportEvents(path);
      notify("ok", `已导出 ${n} 条安全事件`);
    } catch (e) {
      notify("error", `导出失败：${String(e)}`);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <ShieldQuestion size={15} className="text-subtle" aria-hidden />
          命令审批策略
        </h2>
        <p className="mt-1 text-xs text-subtle">
          模型执行命令前的确认方式。会话内点过「允许并记住」的规则不再重复询问。
        </p>
        <div className="mt-3 space-y-1.5">
          {POLICIES.map((p) => {
            const active = policy === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={savingPolicy}
                aria-pressed={active}
                onClick={() => void changePolicy(p.id)}
                className={`w-full rounded-card border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                  active
                    ? "border-brand/40 bg-brand/5"
                    : "border-line hover:bg-bubble"
                }`}
              >
                <span className="flex items-center gap-2 text-[13px] text-foreground">
                  {active ? (
                    <ShieldCheck size={13} className="text-brand" aria-hidden />
                  ) : (
                    <ShieldAlert size={13} className="text-subtle" aria-hidden />
                  )}
                  {p.label}
                </span>
                <span className="mt-0.5 block pl-5 text-[11px] text-subtle">
                  {p.hint}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">最近的安全事件</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              aria-label="刷新安全事件"
              title="刷新"
              className="rounded-tag p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
            >
              <RefreshCw size={13} />
            </button>
            <button
              type="button"
              onClick={() => void exportCsv()}
              className="flex items-center gap-1 rounded-tag px-2 py-1 text-[12px] text-subtle transition-colors hover:bg-bubble hover:text-foreground"
            >
              <Download size={12} aria-hidden />
              导出
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label="全部"
            count={events.length}
          />
          {[...counts.entries()].map(([kind, n]) => (
            <FilterChip
              key={kind}
              active={filter === kind}
              onClick={() => setFilter(kind)}
              label={KIND_META[kind]?.label ?? kind}
              count={n}
            />
          ))}
        </div>

        {loading && <p className="mt-3 text-xs text-subtle">读取中…</p>}
        {error && (
          <p className="mt-3 text-xs text-danger">读取失败：{error}</p>
        )}
        {!loading && !error && visible.length === 0 && (
          <p className="mt-3 rounded-card border border-line px-3 py-4 text-center text-xs text-subtle">
            还没有安全事件。被拦下的命令、越权访问与审批记录会出现在这里。
          </p>
        )}

        {visible.length > 0 && (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line">
            {visible.map((e) => (
              <li key={e.id} className="px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`shrink-0 text-[11px] font-medium ${
                      KIND_META[e.kind]?.tone ?? "text-subtle"
                    }`}
                  >
                    {KIND_META[e.kind]?.label ?? e.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtle">
                    {e.subject}
                  </span>
                  <span className="shrink-0 text-[11px] text-subtle">
                    {formatTime(e.ts_ms)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 text-[12px] text-foreground">
                    {e.reason}
                  </span>
                  {e.rule_id && (
                    <span className="shrink-0 text-[11px] text-subtle">
                      {e.rule_id}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
        active
          ? "border-brand/40 bg-brand/5 text-foreground"
          : "border-line text-subtle hover:bg-bubble hover:text-foreground"
      }`}
    >
      {label}
      <span className="ml-1 text-subtle">{count}</span>
    </button>
  );
}
