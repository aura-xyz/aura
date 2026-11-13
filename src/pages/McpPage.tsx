import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import Switch from "../components/Switch";
import McpResourcePanel from "../components/McpResourcePanel";
import McpPromptPanel from "../components/McpPromptPanel";
import {
  MCP_STATUS_META,
  addServer,
  capabilityDomains,
  commandSummary,
  getServerStatus,
  listServers,
  parseEnv,
  removeServer,
  rescanTools,
  setServerEnabled,
  testConnect,
  toLines,
  updateServer,
  type McpServerInput,
  type McpServerView,
  type McpStatusView,
  type McpTestResult,
} from "../lib/mcp";

interface Props {
  onClose: () => void;
}

export default function McpPage({ onClose }: Props) {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editing, setEditing] = useState<
    { mode: "add" } | { mode: "edit"; server: McpServerView } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setServers(await listServers());
      setError(null);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 连接状态 / 工具集变化由后端推送（未在 Tauri 环境下静默跳过）。
    let unStatus: (() => void) | undefined;
    let unTools: (() => void) | undefined;
    (async () => {
      try {
        unStatus = await listen("mcp:status", () => void refresh());
        unTools = await listen("mcp:tools", () => void refresh());
      } catch {
        /* 非 Tauri 环境（测试页）没有事件总线 */
      }
    })();
    return () => {
      unStatus?.();
      unTools?.();
    };
  }, [refresh]);

  async function toggle(server: McpServerView) {
    try {
      await setServerEnabled(server.id, !server.enabled);
      await refresh();
      if (detailId === server.id) setDetailId(server.id); // 触发抽屉自然重取
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  }

  async function doRemove(id: number) {
    try {
      await removeServer(id);
      setConfirmDelete(null);
      if (detailId === id) setDetailId(null);
      await refresh();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Plug size={16} className="shrink-0 text-subtle" />
            <h1 className="text-sm font-semibold">MCP</h1>
          </div>
          <p className="mt-1 text-xs text-subtle">
            接入 Model Context Protocol 服务器，让 Aura 用上工作区之外的能力与数据源。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing({ mode: "add" })}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
          >
            <Plus size={11} />
            添加服务器
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
          >
            <ArrowLeft size={11} />
            返回对话
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-card border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
          <CircleAlert size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {loading ? (
          <p className="py-10 text-center text-sm text-subtle">正在读取服务器…</p>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line py-12 text-center">
            <Server size={22} className="text-subtle" />
            <p className="text-sm text-subtle">还没有 MCP 服务器</p>
            <button
              type="button"
              onClick={() => setEditing({ mode: "add" })}
              className="mt-1 rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:border-brand hover:text-brand"
            >
              添加第一个
            </button>
          </div>
        ) : (
          servers.map((s) => {
            const meta = MCP_STATUS_META[s.status];
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-card border border-line bg-surface px-3 py-2.5"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => setDetailId(s.id)}
                  className="min-w-0 flex-1 text-left"
                  title="查看详情"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {s.name}
                    </span>
                    <span className={`shrink-0 text-[10px] ${meta.text}`}>
                      {meta.label}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-subtle">
                    {commandSummary(s) || "—"}
                  </span>
                </button>
                <span className="shrink-0 text-[10px] text-subtle">
                  {s.tool_count} 工具
                </span>
                <button
                  type="button"
                  onClick={() => setEditing({ mode: "edit", server: s })}
                  aria-label={`编辑 ${s.name}`}
                  className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(s.id)}
                  aria-label={`删除 ${s.name}`}
                  className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:bg-bubble hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
                <Switch
                  checked={s.enabled}
                  label={`启用 ${s.name}`}
                  onChange={() => void toggle(s)}
                />
                <button
                  type="button"
                  onClick={() => setDetailId(s.id)}
                  aria-label={`查看 ${s.name} 详情`}
                  className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {detailId !== null && (
        <DetailDrawer
          id={detailId}
          server={servers.find((s) => s.id === detailId)}
          onClose={() => setDetailId(null)}
          onChanged={() => void refresh()}
        />
      )}

      {confirmDelete !== null && (
        <ConfirmRemove
          name={servers.find((s) => s.id === confirmDelete)?.name ?? ""}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void doRemove(confirmDelete)}
        />
      )}

      {editing && (
        <ServerForm
          initial={editing.mode === "edit" ? editing.server : undefined}
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            try {
              if (editing.mode === "edit") {
                await updateServer(editing.server.id, input);
              } else {
                await addServer(input);
              }
              setEditing(null);
              await refresh();
            } catch (e) {
              setError(typeof e === "string" ? e : String(e));
            }
          }}
        />
      )}
    </div>
  );
}

/** 详情抽屉：状态、stderr 尾部、工具清单（原始名 ↔ 对外名）、重扫/重连。 */
function DetailDrawer({
  id,
  server,
  onClose,
  onChanged,
}: {
  id: number;
  server?: McpServerView;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<McpStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await getServerStatus(id));
      setErr(null);
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function rescan() {
    setBusy(true);
    try {
      await rescanTools(id);
      await load();
      onChanged();
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  const meta = detail ? MCP_STATUS_META[detail.status] : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          {meta && <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />}
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {server?.name ?? "服务器"}
          </h2>
          {meta && <span className={`shrink-0 text-[10px] ${meta.text}`}>{meta.label}</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
            className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {err && (
            <p className="mb-3 flex items-start gap-2 text-[11px] text-danger">
              <CircleAlert size={12} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{err}</span>
            </p>
          )}

          <section>
            <h3 className="eyebrow">启动命令</h3>
            <p className="mt-1.5 break-all rounded-tag bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-foreground">
              {server ? commandSummary(server) || "—" : "—"}
            </p>
          </section>

          {detail && (
            <section className="mt-5">
              <h3 className="eyebrow">协议与能力</h3>
              <p className="mt-1.5 break-all text-[11px] text-subtle">
                {detail.capabilities.protocol_version || "服务器未返回协议版本"}
                {detail.capabilities.server_name &&
                  ` · ${detail.capabilities.server_name}`}
                {detail.capabilities.server_version &&
                  ` ${detail.capabilities.server_version}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {capabilityDomains(detail.capabilities).map((d) => (
                  <span
                    key={d.label}
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                      d.on
                        ? "border-brand/40 text-brand"
                        : "border-line text-subtle opacity-60"
                    }`}
                  >
                    {d.label}
                    {d.on ? "" : "（未声明）"}
                  </span>
                ))}
              </div>
              {detail.capabilities.resources_subscribe && (
                <p className="mt-1.5 text-[10px] text-subtle">
                  服务器声明支持资源订阅更新
                </p>
              )}
            </section>
          )}

          {detail?.reason && (
            <p className="mt-3 rounded-tag border border-danger/30 bg-danger/5 px-2 py-1.5 text-[11px] text-danger">
              {detail.reason}
            </p>
          )}

          <section className="mt-5">
            <div className="flex items-baseline justify-between">
              <h3 className="eyebrow">工具清单</h3>
              <span className="text-[10px] text-subtle">
                {detail ? `${detail.tool_count} 个` : "—"}
              </span>
            </div>
            {!detail || detail.tools.length === 0 ? (
              <p className="mt-2 text-[11px] text-subtle">
                暂无工具（未连接或服务器未提供）。
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {detail.tools.map((t) => (
                  <li
                    key={t.name}
                    className="rounded-tag border border-line bg-surface px-2 py-1.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <Wrench size={12} className="shrink-0 text-subtle" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                        {t.external_name}
                      </span>
                      {t.external_name !== t.name && (
                        <span className="shrink-0 rounded-full border border-warning/40 px-1.5 py-0.5 text-[9px] text-warning">
                          原名 {t.name}
                        </span>
                      )}
                      {t.annotations && (
                        <span
                          className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] text-subtle"
                          title={`${t.annotations}（服务器自报，不作为放行依据）`}
                        >
                          注解
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-subtle">{t.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <McpResourcePanel
            serverId={id}
            supported={detail?.capabilities.resources ?? false}
          />
          <McpPromptPanel
            serverId={id}
            supported={detail?.capabilities.prompts ?? false}
          />

          {detail && detail.stderr.length > 0 && (
            <section className="mt-5">
              <h3 className="eyebrow">stderr（最近）</h3>
              <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto rounded-tag bg-surface-sunken px-2 py-1.5 font-mono text-[10px] leading-relaxed text-subtle">
                {detail.stderr.join("\n")}
              </pre>
            </section>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void rescan()}
            className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
          >
            <RefreshCw size={11} />
            重扫工具
          </button>
          <span className="text-[10px] text-subtle">仅执行模式下对模型可见</span>
        </div>
      </div>
    </div>
  );
}

/** 删除二次确认。 */
function ConfirmRemove({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">删除服务器「{name}」？</h2>
        <p className="mt-2 text-xs leading-relaxed text-subtle">
          该服务器的工具会立即从模型中下线，此操作不可恢复。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:border-brand"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-danger px-3 py-1.5 text-xs text-white transition-colors hover:opacity-90"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

/** 新增 / 编辑表单，含「试连」与 JSON 预览。 */
function ServerForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: McpServerView;
  onCancel: () => void;
  onSubmit: (input: McpServerInput) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [argsText, setArgsText] = useState((initial?.args ?? []).join("\n"));
  const [envText, setEnvText] = useState("");
  const [workspacesText, setWorkspacesText] = useState(
    (initial?.workspaces ?? []).join("\n"),
  );
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<McpTestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const build = (): McpServerInput => ({
    name: name.trim(),
    command: command.trim(),
    args: toLines(argsText),
    env: parseEnv(envText),
    workspaces: toLines(workspacesText),
  });

  const valid = name.trim().length > 0 && command.trim().length > 0;

  async function runTest() {
    if (!valid) return;
    setTesting(true);
    setTest(null);
    try {
      setTest(await testConnect(build()));
    } catch (e) {
      setTest({
        ok: false,
        tool_count: 0,
        error: typeof e === "string" ? e : String(e),
        stderr: [],
      });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      await onSubmit(build());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onCancel}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-card border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">
            {initial ? "编辑 MCP 服务器" : "添加 MCP 服务器"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="关闭"
            className="rounded-md p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-subtle">名称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如 filesystem"
                spellCheck={false}
                className="rounded-tag border border-line bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-subtle focus:border-brand/40"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-subtle">命令</span>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="例如 npx"
                spellCheck={false}
                className="rounded-tag border border-line bg-surface px-2 py-1.5 font-mono text-[12px] outline-none placeholder:text-subtle focus:border-brand/40"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-subtle">参数（每行一个）</span>
              <textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                rows={3}
                placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/work"}
                spellCheck={false}
                className="resize-none rounded-tag border border-line bg-surface px-2 py-1.5 font-mono text-[12px] outline-none placeholder:text-subtle focus:border-brand/40"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-subtle">
                环境变量（每行 KEY=VALUE，加密存储{initial ? "；留空保留原值" : ""}）
              </span>
              <textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                rows={2}
                placeholder={"GITHUB_TOKEN=ghp_…"}
                spellCheck={false}
                className="resize-none rounded-tag border border-line bg-surface px-2 py-1.5 font-mono text-[12px] outline-none placeholder:text-subtle focus:border-brand/40"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-subtle">
                可见工作区（每行一个路径；留空 = 全部工作区）
              </span>
              <textarea
                value={workspacesText}
                onChange={(e) => setWorkspacesText(e.target.value)}
                rows={2}
                placeholder={"E:/aura"}
                spellCheck={false}
                className="resize-none rounded-tag border border-line bg-surface px-2 py-1.5 font-mono text-[12px] outline-none placeholder:text-subtle focus:border-brand/40"
              />
            </label>

            <div>
              <span className="text-[11px] text-subtle">JSON 预览</span>
              <pre className="scrollbar-thin mt-1 max-h-32 overflow-auto rounded-tag border border-line bg-surface-sunken px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground">
                {JSON.stringify(build(), null, 2)}
              </pre>
            </div>

            {test && (
              <p
                className={`flex items-start gap-2 text-[11px] ${
                  test.ok ? "text-success" : "text-danger"
                }`}
              >
                <CircleAlert size={12} className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">
                  {test.ok
                    ? `连接成功，发现 ${test.tool_count} 个工具`
                    : `连接失败：${test.error ?? "未知错误"}`}
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            disabled={!valid || testing}
            onClick={() => void runTest()}
            className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1.5 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
          >
            <Plug size={11} />
            {testing ? "测试中…" : "试连"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:border-brand"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!valid || busy}
              onClick={() => void save()}
              className="rounded-full bg-brand px-3 py-1.5 text-xs text-white transition-colors enabled:hover:bg-brand-strong disabled:opacity-30"
            >
              {initial ? "保存" : "添加"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
