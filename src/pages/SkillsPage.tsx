import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  FolderOpen,
  Plus,
  Search,
  TriangleAlert,
  Trash2,
  X,
} from "lucide-react";
import {
  addSkillSource,
  deleteSkill,
  inspectMarketSkill,
  installMarketSkill,
  listMarketProviders,
  listMarketSkills,
  listSkillSources,
  listSkills,
  removeSkillSource,
  setSkillEnabled,
  type MarketProviderView,
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
  filterMarket,
  filterSkills,
  groupSkills,
  skillInitial,
  SOURCE_LABEL,
  SOURCE_TINT,
  tagChips,
  toolsLabel,
} from "../lib/skill";
import { notify } from "../lib/notices";
import SkillDetailDialog from "../components/SkillDetailDialog";
import Switch from "../components/Switch";
import { useConfirm } from "../hooks/useConfirm";

interface Props {
  onClose: () => void;
}

type Tab = "builtin" | "installed" | "market";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; skills: SkillView[] }
  | { kind: "error"; message: string };

/** 市场清单是网络请求，与本地列表分开管：网络慢不该拖住本地技能。 */
type MarketState =
  | { kind: "loading" }
  | {
      kind: "ready";
      items: MarketSkillView[];
      errors: string[];
      /** 总条数（源分页时有效） */
      total: number;
      /** 总页数（源分页时有效） */
      totalPages: number;
      /** 该源是否分页 */
      paged: boolean;
    }
  | { kind: "error"; message: string };

function Tabs({
  tab,
  counts,
  onChange,
}: {
  tab: Tab;
  counts: Record<Tab, number | null>;
  onChange: (t: Tab) => void;
}) {
  const items: { id: Tab; label: string }[] = [
    { id: "builtin", label: "内置" },
    { id: "installed", label: "已安装" },
    { id: "market", label: "市场" },
  ];
  return (
    <div
      role="tablist"
      aria-label="技能分区"
      className="mt-5 flex items-center gap-1 border-b border-line"
    >
      {items.map((it) => {
        const active = tab === it.id;
        const n = counts[it.id];
        return (
          <button
            key={it.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? "border-brand text-foreground"
                : "border-transparent text-subtle hover:text-foreground"
            }`}
          >
            {it.label}
            {n !== null && <span className="ml-1 text-[11px] text-subtle">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-line px-4 py-3 text-xs leading-relaxed text-subtle">
      {children}
    </p>
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
      className={`flex h-full items-start gap-3 rounded-card border border-line bg-surface p-3 transition-opacity ${
        skill.enabled ? "" : "opacity-60"
      }`}
    >
      {/* 首字块：来源色一眼可辨，替代一半「来源徽章」的职能 */}
      <span
        aria-hidden
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-tag text-sm font-semibold ${SOURCE_TINT[skill.source]}`}
      >
        {skillInitial(skill.name)}
      </span>

      <div className="min-w-0 flex-1" title={`工具：${toolsLabel(skill)}\n目录：${skill.dir}`}>
        {/* 第一行：名称 + 版本 + 来源 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{skill.name}</span>
          <span className="font-mono text-[11px] text-subtle">v{skill.version}</span>
          <span className="rounded-full border border-line px-1.5 text-[10px] leading-4 text-subtle">
            {SOURCE_LABEL[skill.source]}
          </span>
          {!skill.enabled && (
            <span className="text-[11px] text-subtle">已禁用</span>
          )}
        </div>
        {/* 第二行：描述最多两行 */}
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-subtle">
          {skill.description}
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
  );
}


/** 市场卡：与本地卡同一套首字块 + 三行层级，CTA 用品牌实底主按钮。 */
function MarketCard({
  item,
  inspecting,
  installing,
  onOpen,
}: {
  item: MarketSkillView;
  inspecting: string | null;
  installing: boolean;
  onOpen: () => void;
}) {
  const chips = tagChips(item.tags);
  const busy = inspecting !== null || installing;
  const label = item.name || item.id;
  return (
    <div className="flex h-full flex-col rounded-card border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-tag text-sm font-semibold ${SOURCE_TINT.market}`}
        >
          {skillInitial(label)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium">{label}</span>
            {item.version && (
              <span className="font-mono text-[11px] text-subtle">v{item.version}</span>
            )}
            <span className="rounded-full border border-line px-1.5 text-[10px] leading-4 text-subtle">
              {item.registry || "官方"}
            </span>
            {/* 上游不提供哈希时必须标出来——用户有权知道自己装的东西没被验证过 */}
            {!item.integrity_verified && (
              <span
                className="cursor-help rounded-full border border-line px-1.5 text-[10px] leading-4 text-subtle"
                title="该来源不提供包的完整性校验，安装前会做完整静态审查"
              >
                无完整性校验
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-subtle">
            {item.description}
          </p>
        </div>
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {chips.shown.map((tag) => (
            <span
              key={tag}
              className="max-w-[8rem] truncate rounded-full border border-line px-1.5 text-[10px] leading-4 text-subtle"
            >
              {tag}
            </span>
          ))}
          {chips.rest > 0 && (
            <span className="text-[10px] text-subtle">+{chips.rest}</span>
          )}
          {item.author && (
            <span className="truncate text-[10px] text-subtle">{item.author}</span>
          )}
        </div>

        {canUpdate(item) ? (
          <button
            type="button"
            onClick={onOpen}
            disabled={busy}
            className="flex shrink-0 items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:text-surface"
          >
            <Download size={11} />
            {inspecting === item.id ? "检查中…" : `更新到 v${item.version}`}
          </button>
        ) : item.installed ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-subtle">
            <Check size={12} className="text-success" />
            已安装
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            disabled={busy}
            className="flex shrink-0 items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:text-surface"
          >
            <Download size={11} />
            {inspecting === item.id ? "检查中…" : "安装"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function SkillsPage({ onClose }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [market, setMarket] = useState<MarketState>({ kind: "loading" });
  const [sources, setSources] = useState<SkillSourceView[]>([]);
  const [tab, setTab] = useState<Tab>("installed");
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
  const [addingSource, setAddingSource] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  /** 可用的技能源（Provider）。 */
  const [providers, setProviders] = useState<MarketProviderView[]>([]);
  /**
   * 当前选中的源。`""` = 全部源（聚合）。
   *
   * SkillHub 有 8 万条，必须**按源拉**——聚合模式只拉官方与自建源，
   * 第三方源要用户主动切过去再搜。
   */
  const [providerFilter, setProviderFilter] = useState("");
  /** 市场页码（仅分页源有效） */
  const [marketPage, setMarketPage] = useState(1);
  const { confirm, dialog } = useConfirm();

  async function refresh() {
    try {
      setState({ kind: "ready", skills: await listSkills() });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }

  /**
   * 市场清单。网络不通时只影响这一块，本地技能照常可用。
   *
   * `query` 只在**选中单个源**时作为远端搜索词传出去——聚合模式下
   * 各源的搜索语义不同，用本地过滤更稳。
   */
  async function loadMarket(opts?: { provider?: string; query?: string; page?: number }) {
    const provider = opts?.provider ?? providerFilter;
    const page = opts?.page ?? marketPage;
    const q = opts?.query ?? (provider ? query : "");
    setMarket({ kind: "loading" });
    try {
      const list = await listMarketSkills(provider || undefined, q || undefined, page);
      setMarket({
        kind: "ready",
        items: list.skills,
        errors: list.errors,
        total: list.total,
        totalPages: list.total_pages,
        paged: list.paged,
      });
    } catch (e) {
      setMarket({ kind: "error", message: String(e) });
    }
  }

  /** 拉取可用源。读不到时市场仍能用默认源，不必打断用户。 */
  async function loadProviders() {
    try {
      setProviders(await listMarketProviders());
    } catch {
      setProviders([]);
    }
  }

  /** 切换源：清空搜索与页码，重拉该源的清单。 */
  function switchProvider(id: string) {
    setProviderFilter(id);
    setQuery("");
    setMarketPage(1);
    void loadMarket({ provider: id, page: 1 });
  }

  /**
   * 搜索框输入。
   *
   * 市场档只有选中单个源时才走**远端**搜索——SkillHub 有 8 万条，
   * 不可能全拉回来再过滤；聚合模式与本地两档一律前端过滤。
   */
  function handleQuery(value: string) {
    setQuery(value);
    if (tab === "market" && providerFilter) {
      setMarketPage(1);
      void loadMarket({ provider: providerFilter, query: value, page: 1 });
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
    void loadProviders();
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
    const next = !skill.enabled;
    try {
      await setSkillEnabled(skill.name, next);
      patchSkill(skill.name, { enabled: next });
    } catch (e) {
      notify("error", String(e));
    } finally {
      setBusyName(null);
    }
  }

  async function remove(skill: SkillView) {
    if (busyName) return;
    setBusyName(skill.name);
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
      notify("ok", `已删除技能「${skill.name}」`);
    } catch (e) {
      notify("error", String(e));
    } finally {
      setBusyName(null);
    }
  }

  /** 第一步：下载并审查，弹出报告让用户确认。 */
  async function openDetail(item: MarketSkillView) {
    if (inspecting || installing) return;
    setInspecting(item.id);
    setInstallError(null);
    try {
      setDetail(await inspectMarketSkill(item.id));
    } catch (e) {
      notify("error", String(e));
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
    const label = detail.name || detail.id;
    setInstalling(true);
    setInstallError(null);
    try {
      const summary = await installMarketSkill(detail.id, acceptRisky, update);
      setDetail(null);
      await refresh();
      await loadMarket();
      notify(
        "ok",
        update
          ? `已更新「${label}」到 v${summary.version}`
          : `已安装「${label}」（v${summary.version}）`,
      );
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

  async function dropSource(source: SkillSourceView) {
    if (sourceBusy) return;
    // 移除是不可逆的（要加回来得重新填地址），先问一句。
    const ok = await confirm({
      title: "移除技能源",
      message: (
        <span>
          移除来源「{source.name}」？该源提供的技能不会随之卸载。
        </span>
      ),
      confirmText: "移除",
      danger: true,
    });
    if (!ok) return;
    setSourceBusy(true);
    setSourceError(null);
    try {
      setSources(await removeSkillSource(source.url));
      void loadMarket();
    } catch (e) {
      setSourceError(String(e));
    } finally {
      setSourceBusy(false);
    }
  }

  const groups = state.kind === "ready" ? groupSkills(state.skills) : null;
  // 搜索框三页签共用，本地两档在前端过滤；市场档的语义见 handleQuery。
  const shownBuiltin = groups ? filterSkills(groups.builtin, query) : [];
  const shownInstalled = groups ? filterSkills(groups.installed, query) : [];
  const marketItems = market.kind === "ready" ? market.items : null;
  /** 市场「提供」的总数：分页源给 total，聚合模式只能给本页条数 */
  const marketTotal =
    market.kind === "ready" ? market.total || market.items.length : null;
  // 判空与渲染共用同一份结果：先前两处各调一次，同一次渲染白跑两遍。
  const filteredMarket = useMemo(
    () => (marketItems ? filterMarket(marketItems, query) : []),
    [marketItems, query],
  );
  const marketErrors = market.kind === "ready" ? market.errors : [];
  /** 市场里既没有条目又有报错：整块失败，给重试入口 */
  const marketDown = marketItems !== null && marketItems.length === 0 && marketErrors.length > 0;

  const cardProps = (s: SkillView) => ({
    skill: s,
    busy: busyName === s.name,
    confirming: confirming === s.name,
    onToggle: () => toggle(s),
    onAskDelete: () => setConfirming(s.name),
    onCancelDelete: () => setConfirming(null),
    onConfirmDelete: () => remove(s),
  });

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

        <h1 className="mt-5 text-2xl font-semibold leading-tight tracking-[-0.03em]">Skills</h1>
        <p className="mt-2 text-sm text-subtle">
          技能是给模型的工作指引，模型判断场景匹配时按需加载；禁用后模型看不到它。
        </p>

        {/* 概览条：三个数字一眼看清手里的家底，数据都是现成的 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          {[
            ["内置", groups ? groups.builtin.length : null],
            ["已安装", groups ? groups.installed.length : null],
            ["市场提供", marketTotal],
          ].map(([label, value]) => (
            <span
              key={String(label)}
              className="flex items-center gap-1 rounded-full bg-bubble px-2 py-0.5 text-subtle"
            >
              {label}
              <span className="font-medium tabular-nums text-foreground">
                {value ?? "—"}
              </span>
            </span>
          ))}
        </div>

        <Tabs
          tab={tab}
          counts={{
            builtin: groups ? groups.builtin.length : null,
            installed: groups ? groups.installed.length : null,
            market: marketItems ? marketItems.length : null,
          }}
          onChange={setTab}
        />

        {/* 搜索框常驻：三个页签共用一处，切页签不丢输入 */}
        <div className="relative mt-4">
          <Search
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
          />
          <input
            value={query}
            onChange={(e) => handleQuery(e.target.value)}
            placeholder={
              tab === "market"
                ? providerFilter
                  ? "在该源内搜索"
                  : "搜索名称、说明或标签"
                : "搜索名称或说明"
            }
            aria-label="搜索技能"
            className="w-full rounded-card border border-line bg-surface py-2 pl-8 pr-3 text-sm outline-none transition-colors focus:border-brand"
          />
        </div>

        {/* ---- 本地列表（内置 / 已安装） ---- */}
        {tab !== "market" && (
          <div className="mt-4 flex flex-col gap-2">
            {state.kind === "loading" && <p className="text-sm text-subtle">正在读取技能…</p>}

            {state.kind === "error" && (
              <div className="flex flex-col gap-2">
                <p className="flex items-start gap-2 text-sm text-danger">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">读取失败：{state.message}</span>
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

            {groups &&
              (tab === "builtin" ? (
                groups.builtin.length === 0 ? (
                  <EmptyState>没有内置技能。</EmptyState>
                ) : shownBuiltin.length === 0 ? (
                  <EmptyState>没有匹配的技能。</EmptyState>
                ) : (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {shownBuiltin.map((s) => (
                      <SkillCard key={s.name} {...cardProps(s)} />
                    ))}
                  </div>
                )
              ) : groups.installed.length === 0 ? (
                <EmptyState>
                  <span className="flex items-center gap-1.5">
                    <FolderOpen size={12} className="shrink-0" />
                    还没有安装任何技能。
                  </span>
                  <span className="mt-1 block">
                    把含 <span className="font-mono">SKILL.md</span> 的目录放进项目的{" "}
                    <span className="font-mono">.agents/skills/</span>、应用数据的{" "}
                    <span className="font-mono">skills/local/</span>，或从「市场」安装。
                  </span>
                </EmptyState>
              ) : shownInstalled.length === 0 ? (
                <EmptyState>没有匹配的技能。</EmptyState>
              ) : (
                <div className="grid gap-2 lg:grid-cols-2">
                  {shownInstalled.map((s) => (
                    <SkillCard key={s.name} {...cardProps(s)} />
                  ))}
                </div>
              ))}
          </div>
        )}

        {/* ---- 市场（独立数据源，不跟着本地列表的成败走） ---- */}
        {tab === "market" && (
          <div className="mt-4 flex flex-col gap-2">
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
                        onClick={() => void dropSource(s)}
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

            {market.kind === "loading" && (
              <EmptyState>正在获取市场清单…</EmptyState>
            )}

            {market.kind === "error" && (
              <div className="rounded-card border border-line px-4 py-3">
                <p className="flex items-start gap-2 text-xs text-danger">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">获取失败：{market.message}</span>
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

            {market.kind === "ready" && marketDown && (
              <div className="rounded-card border border-line px-4 py-3">
                <p className="flex items-start gap-2 text-xs text-danger">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">
                    市场暂时拉不到清单（{marketErrors.join("；")}）
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

            {/* 有条目、但某个源失败：不打断浏览，只在下面提一句 */}
            {market.kind === "ready" && !marketDown && marketErrors.length > 0 && (
              <p className="px-1 text-[11px] text-subtle">
                部分来源未拉取到：{marketErrors.join("；")}
              </p>
            )}

            {/* 来源筛选：SkillHub 有 8 万条，必须按源拉，不能一次全取 */}
            {providers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => switchProvider("")}
                  aria-pressed={providerFilter === ""}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    providerFilter === ""
                      ? "border-brand text-brand"
                      : "border-line text-subtle hover:border-brand"
                  }`}
                >
                  全部
                </button>
                {providers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => switchProvider(p.id)}
                    aria-pressed={providerFilter === p.id}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                      providerFilter === p.id
                        ? "border-brand text-brand"
                        : "border-line text-subtle hover:border-brand"
                    }`}
                  >
                    {p.label}
                    {p.kind === "第三方" && (
                      <span className="ml-1 text-[10px] opacity-70">第三方</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {marketItems !== null && marketItems.length > 0 && (
              <>
                {filteredMarket.length === 0 ? (
                  <EmptyState>没有匹配的技能。</EmptyState>
                ) : (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {filteredMarket.map((item) => (
                      <MarketCard
                        key={item.id}
                        item={item}
                        inspecting={inspecting}
                        installing={installing}
                        onOpen={() => void openDetail(item)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* 分页：仅对支持分页的源显示（如 SkillHub 的 8 万条） */}
            {market.kind === "ready" && market.paged && market.totalPages > 1 && (
              <div className="flex items-center justify-between px-1 text-xs">
                <span className="text-subtle">
                  第 {marketPage} / {market.totalPages} 页 · 共 {market.total} 条
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={marketPage <= 1}
                    onClick={() => {
                      const next = marketPage - 1;
                      setMarketPage(next);
                      void loadMarket({ page: next });
                    }}
                    className="rounded-md border border-line px-2 py-1 text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={marketPage >= market.totalPages}
                    onClick={() => {
                      const next = marketPage + 1;
                      setMarketPage(next);
                      void loadMarket({ page: next });
                    }}
                    className="rounded-md border border-line px-2 py-1 text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}

            {marketItems !== null && marketItems.length === 0 && !marketDown && (
              <EmptyState>注册表里暂时没有技能。</EmptyState>
            )}
          </div>
        )}
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

      {dialog}
    </div>
  );
}
