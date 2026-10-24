import { useEffect, useState } from "react";
import {
  ArrowLeft,
  FolderOpen,
  Sparkles,
  Store,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import {
  deleteSkill,
  listSkills,
  setSkillEnabled,
  type SkillView,
} from "../lib/api";
import {
  canDelete,
  deleteBlockedReason,
  enabledCount,
  groupSkills,
  SOURCE_LABEL,
  toolsLabel,
} from "../lib/skill";

interface Props {
  onClose: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; skills: SkillView[] }
  | { kind: "error"; message: string };

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
  const [busyName, setBusyName] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      setState({ kind: "ready", skills: await listSkills() });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }

  useEffect(() => {
    void refresh();
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
      setNotice(String(e));
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
      setNotice(`已删除技能「${skill.name}」`);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusyName(null);
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
          <p className="mt-3 flex items-start gap-2 rounded-card border border-line px-3 py-2 text-xs text-danger">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{notice}</span>
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

            <Section title="市场">
              <div className="rounded-card border border-dashed border-line px-4 py-4">
                <p className="flex items-center gap-2 text-sm text-subtle">
                  <Store size={14} className="shrink-0" />
                  技能市场将在后续版本接入。
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-subtle">
                  届时可在这里浏览经过筛选的技能，一键安装到本地；现在可以先把
                  自己的技能放进目录使用。
                </p>
              </div>
            </Section>
          </>
        )}

        <p className="mt-10 flex items-center gap-1.5 text-[11px] text-subtle">
          <Sparkles size={12} className="shrink-0" />
          技能默认只读：不会自动改文件或执行命令，具体能做什么由技能声明的工具
          范围与会话模式共同决定。
        </p>
      </div>
    </div>
  );
}
