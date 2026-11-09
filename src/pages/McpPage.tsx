import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  FolderOpen,
  Plug,
  Plus,
  Server,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import Switch from "../components/Switch";
import {
  DEMO_SERVERS,
  MCP_STATUS_META,
  commandSummary,
  type McpServerInput,
  type McpServerView,
} from "../lib/mcp";

interface Props {
  onClose: () => void;
}

/** 深拷贝示例数据：设计预览期所有改动只落在本地 state，别污染模块常量。 */
function cloneDemo(): McpServerView[] {
  return DEMO_SERVERS.map((s) => ({
    ...s,
    args: [...s.args],
    scopes: [...s.scopes],
    recentErrors: [...s.recentErrors],
    tools: s.tools.map((t) => ({ ...t })),
  }));
}

export default function McpPage({ onClose }: Props) {
  // 设计预览：数据来自 DEMO_SERVERS；后端就绪后换成 invoke(MCP_COMMANDS.list)。
  const [servers, setServers] = useState<McpServerView[]>(cloneDemo);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const selected = servers.find((s) => s.id === selectedId) ?? null;

  /** 以不可变方式更新某台服务器。 */
  function patch(id: string, fn: (s: McpServerView) => McpServerView) {
    setServers((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
  }

  function toggleServer(id: string) {
    patch(id, (s) => ({ ...s, enabled: !s.enabled }));
  }

  function toggleTool(id: string, toolName: string) {
    patch(id, (s) => ({
      ...s,
      tools: s.tools.map((t) =>
        t.name === toolName ? { ...t, enabled: !t.enabled } : t,
      ),
    }));
  }

  function setReadOnly(id: string, readOnly: boolean) {
    patch(id, (s) => ({ ...s, readOnly }));
  }

  function removeScope(id: string, scope: string) {
    patch(id, (s) => ({ ...s, scopes: s.scopes.filter((x) => x !== scope) }));
  }

  function addScope(id: string, scope: string) {
    const v = scope.trim();
    if (!v) return;
    patch(id, (s) =>
      s.scopes.includes(v) ? s : { ...s, scopes: [...s.scopes, v] },
    );
  }

  function removeServer(id: string) {
    setServers((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function addServer(input: McpServerInput) {
    const server: McpServerView = {
      id: `demo-${Date.now()}`,
      name: input.name,
      transport: "stdio",
      command: input.command,
      args: input.args,
      status: "disconnected",
      enabled: input.enabled,
      tools: [],
      readOnly: input.readOnly,
      scopes: input.scopes,
      recentErrors: [],
      lastConnectedAt: 0,
    };
    setServers((prev) => [...prev, server]);
    setAdding(false);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Plug size={16} className="shrink-0 text-subtle" />
            <h1 className="text-sm font-semibold">MCP</h1>
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
              设计预览
            </span>
          </div>
          <p className="mt-1 text-xs text-subtle">
            接入 Model Context Protocol 服务器，让 Aura 用上工作区之外的能力与数据源。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAdding(true)}
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

      {/* 设计预览说明：避免用户误以为操作已生效 */}
      <div className="mt-4 flex items-start gap-2 rounded-card border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-subtle">
        <CircleAlert size={13} className="mt-0.5 shrink-0 text-warning" />
        <span className="min-w-0 leading-relaxed">
          后端 MCP 支持将在 rc.3 接入。当前为界面骨架演示，服务器与工具均为示例数据，
          增删改与开关<span className="text-foreground">不会真正连接</span>任何服务。
        </span>
      </div>

      {/* 服务器列表 */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line py-12 text-center">
            <Server size={22} className="text-subtle" />
            <p className="text-sm text-subtle">还没有 MCP 服务器</p>
            <button
              type="button"
              onClick={() => setAdding(true)}
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
                  className={`h-2 w-2 shrink-0 rounded-full ${MCP_STATUS_META[s.status].dot}`}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
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
                  {s.tools.filter((t) => t.enabled).length}/{s.tools.length} 工具
                </span>
                <Switch
                  checked={s.enabled}
                  label={`启用 ${s.name}`}
                  onChange={() => toggleServer(s.id)}
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
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

      {selected && (
        <ServerDrawer
          server={selected}
          onClose={() => setSelectedId(null)}
          onToggleTool={(name) => toggleTool(selected.id, name)}
          onReadOnly={(v) => setReadOnly(selected.id, v)}
          onAddScope={(scope) => addScope(selected.id, scope)}
          onRemoveScope={(scope) => removeScope(selected.id, scope)}
          onRemove={() => removeServer(selected.id)}
        />
      )}

      {adding && <AddServerForm onCancel={() => setAdding(false)} onSubmit={addServer} />}
    </div>
  );
}

/** 单服务器详情抽屉：工具白名单 + 只读范围（均可见可改）+ 最近错误。 */
function ServerDrawer({
  server,
  onClose,
  onToggleTool,
  onReadOnly,
  onAddScope,
  onRemoveScope,
  onRemove,
}: {
  server: McpServerView;
  onClose: () => void;
  onToggleTool: (name: string) => void;
  onReadOnly: (v: boolean) => void;
  onAddScope: (scope: string) => void;
  onRemoveScope: (scope: string) => void;
  onRemove: () => void;
}) {
  const [scopeInput, setScopeInput] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const meta = MCP_STATUS_META[server.status];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${MCP_STATUS_META[server.status].dot}`} aria-hidden />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{server.name}</h2>
          <span className={`shrink-0 text-[10px] ${meta.text}`}>{meta.label}</span>
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
          <section>
            <h3 className="eyebrow">启动命令</h3>
            <p className="mt-1.5 break-all rounded-tag bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-foreground">
              {commandSummary(server) || "—"}
            </p>
            <p className="mt-1 text-[10px] text-subtle">传输：stdio</p>
          </section>

          {/* 工具白名单：勾选即暴露给模型，UI 可见可改 */}
          <section className="mt-5">
            <div className="flex items-baseline justify-between">
              <h3 className="eyebrow">工具白名单</h3>
              <span className="text-[10px] text-subtle">
                {server.tools.filter((t) => t.enabled).length}/{server.tools.length} 已启用
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-subtle">
              只有勾选的工具会暴露给模型；未勾选的一律不可用。
            </p>
            {server.tools.length === 0 ? (
              <p className="mt-2 text-[11px] text-subtle">尚未发现工具（连接后自动拉取）。</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {server.tools.map((t) => (
                  <li
                    key={t.name}
                    className="flex items-center gap-2 rounded-tag border border-line bg-surface px-2 py-1.5"
                  >
                    <Wrench size={12} className="shrink-0 text-subtle" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-[11px] text-foreground">
                          {t.name}
                        </span>
                        {t.requiresApproval && (
                          <span className="shrink-0 rounded-full border border-warning/40 px-1.5 py-0.5 text-[9px] text-warning">
                            需审批
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[10px] text-subtle">
                        {t.description}
                      </span>
                    </span>
                    <Switch
                      checked={t.enabled}
                      label={`启用工具 ${t.name}`}
                      onChange={() => onToggleTool(t.name)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 只读范围：只读模式 + 可访问目录，UI 可见可改 */}
          <section className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="eyebrow">只读范围</h3>
              <label className="flex items-center gap-1.5 text-[11px] text-subtle">
                只读模式
                <Switch
                  checked={server.readOnly}
                  label="只读模式"
                  onChange={() => onReadOnly(!server.readOnly)}
                />
              </label>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-subtle">
              {server.readOnly
                ? "只读模式已开启：写类工具一律不可用，仅可读取下列目录。"
                : "允许工具访问下列目录；不填则仅限当前工作区。"}
            </p>
            {server.scopes.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {server.scopes.map((scope) => (
                  <li
                    key={scope}
                    className="flex items-center gap-2 rounded-tag border border-line bg-surface px-2 py-1.5"
                  >
                    <FolderOpen size={12} className="shrink-0 text-subtle" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                      {scope}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveScope(scope)}
                      aria-label={`移除 ${scope}`}
                      className="shrink-0 rounded p-0.5 text-subtle transition-colors hover:text-danger"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-subtle">未设置额外目录（仅工作区）。</p>
            )}
            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={scopeInput}
                onChange={(e) => setScopeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddScope(scopeInput);
                    setScopeInput("");
                  }
                }}
                placeholder="输入目录路径，回车添加"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-tag border border-line bg-surface px-2 py-1 font-mono text-[11px] text-foreground outline-none placeholder:text-subtle focus:border-brand/40"
              />
              <button
                type="button"
                onClick={() => {
                  onAddScope(scopeInput);
                  setScopeInput("");
                }}
                className="shrink-0 rounded-tag border border-line px-2 py-1 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
              >
                添加
              </button>
            </div>
          </section>

          {/* 最近错误 */}
          <section className="mt-5">
            <h3 className="eyebrow">最近错误</h3>
            {server.recentErrors.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {server.recentErrors.map((err, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-tag border border-danger/30 bg-danger/5 px-2 py-1.5 text-[11px] text-danger"
                  >
                    <CircleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">{err}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-subtle">无错误记录。</p>
            )}
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          {confirmRemove ? (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-subtle">确认删除？</span>
              <button
                type="button"
                onClick={onRemove}
                className="rounded-full bg-danger px-2.5 py-1 text-white transition-colors hover:opacity-90"
              >
                删除
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="rounded-full border border-line px-2.5 py-1 text-subtle transition-colors hover:border-brand"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-subtle transition-colors hover:border-danger hover:text-danger"
            >
              <Trash2 size={11} />
              删除服务器
            </button>
          )}
          <span className="text-[10px] text-subtle">设计预览 · 不会生效</span>
        </div>
      </div>
    </div>
  );
}

/** 添加服务器表单：名称 + 命令 + 参数 + JSON 预览。 */
function AddServerForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: McpServerInput) => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [scopesText, setScopesText] = useState("");

  const args = useMemo(
    () => argsText.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    [argsText],
  );
  const scopes = useMemo(
    () =>
      scopesText
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [scopesText],
  );

  const input: McpServerInput = {
    name: name.trim(),
    command: command.trim(),
    args,
    enabled: true,
    readOnly,
    scopes,
  };
  const valid = input.name.length > 0 && input.command.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-card border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">添加 MCP 服务器</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="关闭"
            className="rounded-md p-1 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
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
            <span className="text-[11px] text-subtle">参数（空格分隔）</span>
            <input
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem /work"
              spellCheck={false}
              className="rounded-tag border border-line bg-surface px-2 py-1.5 font-mono text-[12px] outline-none placeholder:text-subtle focus:border-brand/40"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-subtle">只读范围（每行一个目录，可留空）</span>
            <textarea
              value={scopesText}
              onChange={(e) => setScopesText(e.target.value)}
              rows={2}
              placeholder={"每行一个目录，例如：\n/work"}
              spellCheck={false}
              className="resize-none rounded-tag border border-line bg-surface px-2 py-1.5 font-mono text-[12px] outline-none placeholder:text-subtle focus:border-brand/40"
            />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-subtle">
            只读模式
            <Switch checked={readOnly} label="只读模式" onChange={() => setReadOnly((v) => !v)} />
          </label>

          <div>
            <span className="text-[11px] text-subtle">JSON 预览（提交给后端的结构）</span>
            <pre className="scrollbar-thin mt-1 max-h-40 overflow-auto rounded-tag border border-line bg-surface-sunken px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
        </div>

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
            disabled={!valid}
            onClick={() => valid && onSubmit(input)}
            className="rounded-full bg-brand px-3 py-1.5 text-xs text-white transition-colors enabled:hover:bg-brand-strong disabled:opacity-30"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
