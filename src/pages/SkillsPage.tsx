import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  FolderOpen,
  Plus,
  Search,
  Sparkles,
  TriangleAlert,
  Trash2,
  X,
} from "lucide-react";
import {
  addSkillSource,
  deleteSkill,
  inspectMarketSkill,
  installMarketSkill,
  listMarketSkills,
  listSkillSources,
  listSkills,
  removeSkillSource,
  setSkillEnabled,
  type MarketSkillView,
  type SkillInspection,
  type SkillSourceView,
  type SkillView,
} from "../lib/api";
import {
  auditCounts,
  canDelete,
  canUpdate,
  deleteBlockedReason,
  enabledCount,
  filterMarket,
  groupSkills,
  SOURCE_LABEL,
  toolsLabel,
} from "../lib/skill";
import SkillDetailDialog from "../components/SkillDetailDialog";

interface Props {
  onClose: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; skills: SkillView[] }
  | { kind: "error"; message: string };

/** 市场清单是网络请求，与本地列表分开管：网络慢不该拖住本地技能。 */
type MarketState =
  | { kind: "loading" }
  | { kind: "ready"; items: MarketSkillView[]; errors: string[] }
  | { kind: "error"; message: string };

/** 顶部提示。成功与失败用同一处展示，但要能区分颜色——装成功却飘一条红字很怪。 */
type Notice = { kind: "ok" | "error"; text: string };

/** 启用开关。role=switch 而非 checkbox：语义是「生效/不生效」，不是选中。 */
function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-brand" : "bg-line"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium">{title}</h2>
      {hint && <p className="mt-1 text-xs leading-relaxed text-subtle">{hint}</p>}
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </section>
  );
}

function SkillCard({
  skill,
  busy,
  confirming,
  onToggle,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  skill: SkillView;
  busy: boolean;
  confirming: boolean;
  onToggle: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <div
      className={`rounded-card border border-line bg-surface p-4 transition-opacity ${
        skill.enabled ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{skill.name}</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-subtle">
              {SOURCE_LABEL[skill.source]}
            </span>
            <span className="font-mono text-[11px] text-subtle">v{skill.version}</span>
            {!skill.enabled && (
              <span className="text-[11px] text-subtle">已禁用</span>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-subtle">
            {skill.description}
          </p>
          <p className="mt-1.5 text-[11px] text-subtle">
            工具：{toolsLabel(skill)}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-subtle" title={skill.dir}>
            {skill.dir}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {confirming ? (
            <>
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={busy}
                className="text-xs text-danger transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                确认删除
              </button>
              <button
                type="button"
                onClick={onCancelDelete}
                className="text-xs text-subtle transition-colors hover:text-foreground"
              >
                取消
              </button>
            </>
          ) : (
            <>
              {canDelete(skill.source) ? (
                <button
                  type="button"
                  onClick={onAskDelete}
                  disabled={busy}
                  aria-label={`删除 ${skill.name}`}
                  className="rounded-tag p-1 text-subtle transition-colors hover:text-danger disabled:opacity-40"
                >
                  <Trash2 size={13} />
                </button>
              ) : (
                <span
                  title={deleteBlockedReason(skill.source)}
                  className="cursor-help text-[11px] text-subtle/70"
                >
                  不可删除
                </span>
              )}
              <Switch
                checked={skill.enabled}
                disabled={busy}
                label={`${skill.enabled ? "禁用" : "启用"} ${skill.name}`}
                onChange={onToggle}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SkillsPage({ onClose }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [market, setMarket] = useState<MarketState>({ kind: "loading" });
  const [sources, setSources] = useState<SkillSourceView[]>([]);
  const [query, setQuery] = useState("");
  const [busyName, setBusyName] = useState<string | null>(null);
  /** 正在下载审查的条目 id */
  const [inspecting, setInspecting] = useState<string | null>(null);
  /** 审查报告弹窗 */
  const [detail, setDetail] = useState<SkillInspection | null>(null);
  /** 弹窗内的安装进度与错误 */
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [addingSource, setAddingSource] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  async function refresh() {
    try {
      setState({ kind: "ready", skills: await listSkills() });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }

  /** 市场清单。网络不通时只影响这一块，本地技能照常可用。 */
  async function loadMarket() {
    setMarket({ kind: "loading" });
    try {
      const list = await listMarketSkills();
      setMarket({ kind: "ready", items: list.skills, errors: list.errors });
    } catch (e) {
      setMarket({ kind: "error", message: String(e) });
    }
  }

  /** 源列表与清单分开拉：源是本地的，清单要联网，谁也不该拖累谁。 */
  async function loadSources() {
    try {
      setSources(await listSkillSources());
    } catch {
      // 源列表读不到时市场仍能用官方源，不必打断用户
      setSources([]);
    }
  }

  useEffect(() => {
    void refresh();
    void loadSources();
    void loadMarket();
  }, []);

  /** 就地更新一条：开关是高频操作，整表重扫会闪一下。 */
  function patchSkill(name: string, patch: Partial<SkillView>) {
    setState((s) =>
      s.kind === "ready"
        ? {
            kind: "ready",
            skills: s.skills.map((x) => (x.name === name ? { ...x, ...patch } : x)),
          }
        : s,
    );
  }

  async function toggle(skill: SkillView) {
    if (busyName) return;
    setBusyName(skill.name);
    setNotice(null);
    const next = !skill.enabled;
    try {
      await setSkillEnabled(skill.name, next);
      patchSkill(skill.name, { enabled: next });
    } catch (e) {
      setNotice({ kind: "error", text: String(e) });
    } finally {
      setBusyName(null);
    }
  }

  async function remove(skill: SkillView) {
    if (busyName) return;
    setBusyName(skill.name);
    setNotice(null);
    try {
      await deleteSkill(skill.name);
      setConfirming(null);
      await refresh();
      // 删掉的可能正是市场里装的，同步一下「已安装」角标
      setMarket((s) =>
        s.kind === "ready"
          ? {
              ...s,
              items: s.items.map((x) =>
                x.installed && x.id === skill.name ? { ...x, installed: false } : x,
              ),
            }
          : s,
      );
      setNotice({ kind: "ok", text: `已删除技能「${skill.name}」` });
    } catch (e) {
      setNotice({ kind: "error", text: String(e) });
    } finally {
      setBusyName(null);
    }
  }

  /** 第一步：下载并审查，弹出报告让用户确认。 */
  async function openDetail(item: MarketSkillView) {
    if (inspecting || installing) return;
    setInspecting(item.id);
    setNotice(null);
    setInstallError(null);
    try {
      setDetail(await inspectMarketSkill(item.id));
    } catch (e) {
      setNotice({ kind: "error", text: String(e) });
    } finally {
      setInspecting(null);
    }
  }

  /** 第二步：用户点了确认按钮，这时才真正落盘。 */
  async function confirmInstall() {
    if (!detail || installing) return;
    const update = detail.already_installed;
    // 有高危项时，点「仍然安装」本身就是确认动作
    const acceptRisky = auditCounts(detail.audit).high > 0;
    setInstalling(true);
    setInstallError(null);
    try {
      const summary = await installMarketSkill(detail.id, acceptRisky, update);
      setDetail(null);
      await refresh();
      await loadMarket();
      const label = detail.name || detail.id;
      setNotice({
        kind: "ok",
        text: update
          ? `已更新「${label}」到 v${summary.version}`
          : `已安装「${label}」（v${summary.version}）`,
      });
    } catch (e) {
      // 弹窗不关：用户可能想直接重试，或先看清错误再决定
      setInstallError(String(e));
    } finally {
      setInstalling(false);
    }
  }

  async function submitSource(e: React.FormEvent) {
    e.preventDefault();
    if (sourceBusy) return;
    setSourceBusy(true);
    setSourceError(null);
    try {
      setSources(await addSkillSource(sourceUrl));
      setSourceUrl("");
      setAddingSource(false);
      // 新源的清单要重新拉一次
      void loadMarket();
    } catch (e) {
      setSourceError(String(e));
    } finally {
      setSourceBusy(false);
    }
  }

  async function dropSource(url: string) {
    if (sourceBusy) return;
    setSourceBusy(true);
    setSourceError(null);
    try {
      setSources(await removeSkillSource(url));
      void loadMarket();
    } catch (e) {
      setSourceError(String(e));
    } finally {
      setSourceBusy(false);
    }
  }

  const groups = state.kind === "ready" ? groupSkills(state.skills) : null;

  return (
    <div className="min-h-full bg-surface">
      <div className="mx-auto w-full max-w-4xl px-8 py-8 xl:max-w-5xl">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 text-sm text-subtle transition-colors hover:text-foreground"
        >
          <ArrowLeft size={15} />
          返回对话
        </button>

        <h1 className="mt-5 text-2xl font-semibold leading-tight tracking-[-0.03em]">
          Skills
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-subtle">
          技能是一份写好的工作指引：模型判断场景匹配时会先加载它，再按里面
          的步骤做事。启用中的技能名与用途会随每轮对话提供给模型，禁用后
          模型就看不到它。
        </p>

        {state.kind === "ready" && (
          <p className="mt-2 text-xs text-subtle">
            共 {state.skills.length} 个技能，{enabledCount(state.skills)} 个已启用
          </p>
        )}

        {notice && (
          <p
            className={`mt-3 flex items-start gap-2 rounded-card border border-line px-3 py-2 text-xs ${
              notice.kind === "error" ? "text-danger" : "text-success"
            }`}
          >
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{notice.text}</span>
          </p>
        )}

        {state.kind === "loading" && (
          <p className="mt-6 text-sm text-subtle">正在读取技能…</p>
        )}

        {state.kind === "error" && (
          <div className="mt-6 flex flex-col gap-2">
            <p className="flex items-start gap-2 text-sm text-danger">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                读取技能失败：{state.message}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                setState({ kind: "loading" });
                void refresh();
              }}
              className="self-start text-xs text-brand hover:underline"
            >
              重试
            </button>
          </div>
        )}

        {groups && (
          <>
            <Section
              title={`内置技能（${groups.builtin.length}）`}
              hint="随应用发布，不可删除；不需要时可以禁用。"
            >
              {groups.builtin.length === 0 ? (
                <p className="rounded-card border border-dashed border-line px-4 py-3 text-xs text-subtle">
                  未找到内置技能。
                </p>
              ) : (
                groups.builtin.map((s) => (
                  <SkillCard
                    key={s.name}
                    skill={s}
                    busy={busyName === s.name}
                    confirming={confirming === s.name}
                    onToggle={() => toggle(s)}
                    onAskDelete={() => setConfirming(s.name)}
                    onCancelDelete={() => setConfirming(null)}
                    onConfirmDelete={() => remove(s)}
                  />
                ))
              )}
            </Section>

            <Section
              title={`已安装（${groups.installed.length}）`}
              hint="来自市场、本地技能目录，以及当前工作区的 .agents/skills/。"
            >
              {groups.installed.length === 0 ? (
                <div className="rounded-card border border-dashed border-line px-4 py-3">
                  <p className="flex items-center gap-2 text-xs text-subtle">
                    <FolderOpen size={13} className="shrink-0" />
                    还没有安装任何技能。
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-subtle">
                    把技能目录（含 <span className="font-mono">SKILL.md</span>）放进
                    项目的 <span className="font-mono">.agents/skills/</span>
                    ，或应用数据目录的 <span className="font-mono">skills/local/</span>
                    ，再回到这一页刷新即可看到。
                  </p>
                </div>
              ) : (
                groups.installed.map((s) => (
                  <SkillCard
                    key={s.name}
                    skill={s}
                    busy={busyName === s.name}
                    confirming={confirming === s.name}
                    onToggle={() => toggle(s)}
                    onAskDelete={() => setConfirming(s.name)}
                    onCancelDelete={() => setConfirming(null)}
                    onConfirmDelete={() => remove(s)}
                  />
                ))
              )}
            </Section>
          </>
        )}

        {/* 市场是独立数据源（网络），不跟着本地列表的成败走——
            本地读失败时，市场照样能浏览安装。 */}
        <Section
          title={
            market.kind === "ready"
              ? `市场（${market.items.length}）`
              : "市场"
          }
          hint="来自技能注册表（官方与自建源）。点安装会先下载并静态检查这个包，把申请的权限与危险写法列出来，你确认后才落盘。"
        >
          {market.kind === "loading" && (
            <p className="rounded-card border border-dashed border-line px-4 py-3 text-xs text-subtle">
              正在获取市场清单…
            </p>
          )}

          {market.kind === "error" && (
            <div className="rounded-card border border-line px-4 py-3">
              <p className="flex items-start gap-2 text-xs text-danger">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">
                  获取市场清单失败：{market.message}
                </span>
              </p>
              <button
                type="button"
                onClick={() => void loadMarket()}
                className="mt-2 text-xs text-brand hover:underline"
              >
                重试
              </button>
            </div>
          )}

          {market.kind === "ready" && (
            <>
              {/* 源管理：官方源固定置顶，其余可删。 */}
              <div className="rounded-card border border-line px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-subtle">来源</span>
                  {sources.map((s) => (
                    <span
                      key={s.url}
                      className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px]"
                      title={s.url}
                    >
                      {s.name}
                      {s.removable && (
                        <button
                          type="button"
                          aria-label={`移除来源 ${s.name}`}
                          disabled={sourceBusy}
                          onClick={() => void dropSource(s.url)}
                          className="text-subtle transition-colors hover:text-danger disabled:opacity-40"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </span>
                  ))}

                  {addingSource ? (
                    <form onSubmit={submitSource} className="flex items-center gap-1.5">
                      <input
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        placeholder="github.com/owner/repo"
                        aria-label="仓库地址"
                        autoFocus
                        className="w-52 rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] outline-none transition-colors focus:border-brand"
                      />
                      <button
                        type="submit"
                        disabled={sourceBusy || !sourceUrl.trim()}
                        className="rounded-md border border-line px-2 py-0.5 text-[11px] transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                      >
                        添加
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingSource(false);
                          setSourceUrl("");
                          setSourceError(null);
                        }}
                        className="text-[11px] text-subtle hover:text-foreground"
                      >
                        取消
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingSource(true)}
                      className="flex items-center gap-0.5 text-[11px] text-brand hover:underline"
                    >
                      <Plus size={11} />
                      添加源
                    </button>
                  )}
                </div>
                {sourceError && (
                  <p className="mt-1.5 break-words text-[11px] text-danger">{sourceError}</p>
                )}
              </div>

              {/* 单个源失败不阻塞其它源，但要如实说出来是哪个源 */}
              {market.errors.length > 0 && (
                <div className="rounded-card border border-line px-3 py-2">
                  <p className="flex items-start gap-2 text-[11px] text-danger">
                    <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 break-words">
                      部分来源拉取失败：{market.errors.join("；")}
                    </span>
                  </p>
                </div>
              )}

              {market.items.length === 0 ? (
                <p className="rounded-card border border-dashed border-line px-4 py-3 text-xs text-subtle">
                  注册表里暂时没有技能。
                </p>
              ) : (
                <>
                  <div className="relative">
                    <Search
                      size={13}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
                    />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索名称、说明或标签"
                      aria-label="搜索市场技能"
                      className="w-full rounded-card border border-line bg-surface py-2 pl-8 pr-3 text-sm outline-none transition-colors focus:border-brand"
                    />
                  </div>
                  {filterMarket(market.items, query).length === 0 ? (
                    <p className="rounded-card border border-dashed border-line px-4 py-3 text-xs text-subtle">
                      没有匹配的技能。
                    </p>
                  ) : (
                    filterMarket(market.items, query).map((item) => (
                      <div
                        key={item.id}
                        className="rounded-card border border-line bg-surface p-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">
                                {item.name || item.id}
                              </span>
                              <span className="font-mono text-[11px] text-subtle">
                                {item.id}
                              </span>
                              {item.version && (
                                <span className="font-mono text-[11px] text-subtle">
                                  v{item.version}
                                </span>
                              )}
                              <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-subtle">
                                {item.registry || "官方"}
                              </span>
                            </div>
                            <p className="mt-1.5 text-xs leading-relaxed text-subtle">
                              {item.description}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {item.tags.map((t) => (
                                <span
                                  key={t}
                                  className="rounded-full border border-line px-2 py-0.5 text-[11px] text-subtle"
                                >
                                  {t}
                                </span>
                              ))}
                              {item.author && (
                                <span className="text-[11px] text-subtle">
                                  {item.author}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 pt-0.5">
                            {canUpdate(item) ? (
                              <button
                                type="button"
                                onClick={() => void openDetail(item)}
                                disabled={inspecting !== null || installing}
                                className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                              >
                                <Download size={12} />
                                {inspecting === item.id
                                  ? "检查中…"
                                  : `更新到 v${item.version}`}
                              </button>
                            ) : item.installed ? (
                              <span className="flex items-center gap-1 text-xs text-subtle">
                                <Check size={12} className="text-brand" />
                                已安装
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void openDetail(item)}
                                disabled={inspecting !== null || installing}
                                className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                              >
                                <Download size={12} />
                                {inspecting === item.id ? "检查中…" : "安装"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </>
          )}
        </Section>

        <p className="mt-10 flex items-center gap-1.5 text-[11px] text-subtle">
          <Sparkles size={12} className="shrink-0" />
          技能默认只读：不会自动改文件或执行命令，具体能做什么由技能声明的工具
          范围与会话模式共同决定。
        </p>
      </div>

      {detail && (
        <SkillDetailDialog
          inspection={detail}
          busy={installing}
          error={installError}
          onCancel={() => {
            setDetail(null);
            setInstallError(null);
          }}
          onConfirm={() => void confirmInstall()}
        />
      )}
    </div>
  );
}
