import { FileWarning, ShieldAlert } from "lucide-react";
import type { SkillInspection } from "../lib/api";
import ConfirmDialog from "./ConfirmDialog";
import {
  auditCounts,
  auditHeadline,
  formatBytes,
  groupFindings,
  permissionLines,
  SEVERITY_LABEL,
} from "../lib/skill";

interface Props {
  inspection: SkillInspection;
  /** 安装请求进行中 */
  busy: boolean;
  /** 安装失败的原因（弹窗不关，让用户能重试） */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const SEVERITY_CLASS: Record<string, string> = {
  high: "text-danger",
  medium: "text-foreground",
  info: "text-subtle",
};

/**
 * 安装前审查弹窗。
 *
 * 存在的意义是**让用户看见自己要装的东西**：申请了哪些工具、带不带脚本、
 * 包里有没有危险写法。高危项不会阻止安装（拦不住的东西不如摆出来），
 * 但按钮会变成「仍然安装」，措辞明确要求用户确认。
 */
export default function SkillDetailDialog({
  inspection,
  busy,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const counts = auditCounts(inspection.audit);
  const risky = counts.high > 0;
  const findings = groupFindings(inspection.audit.findings);
  const updating = inspection.already_installed;
  /**
   * 声明了 Aura 不认识的工具名 → 这个技能装不了。
   *
   * 这不是「高危」那种「提示但仍可装」的情况：装了必然不能用。
   * 所以按钮直接禁用，并把原因摆在最显眼处。
   */
  const broken = inspection.unknown_tools.length > 0;

  return (
    <ConfirmDialog
      title={`${updating ? "更新" : "安装"}「${inspection.name || inspection.id}」`}
      confirmText={busy
        ? "处理中…"
        : broken
        ? "无法安装"
        : risky
        ? "仍然安装"
        : updating
        ? "更新"
        : "安装"}
      danger={risky && !broken}
      busy={busy || broken}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2 text-[11px] text-subtle">
          <span className="font-mono">{inspection.id}</span>
          {inspection.version && <span className="font-mono">v{inspection.version}</span>}
          {inspection.registry && <span>来源：{inspection.registry}</span>}
          <span>
            {inspection.package_files.length} 个文件 · {formatBytes(inspection.bytes)}
          </span>
        </p>

        {!inspection.integrity_verified && (
          <p className="rounded-card border border-line px-3 py-2 text-xs leading-relaxed text-subtle">
            {inspection.integrity_note}。安装前会对包内全部文本文件做静态审查。
          </p>
        )}

        {broken && (
          <div className="rounded-card border border-danger px-3 py-2">
            <p className="flex items-center gap-2 text-xs font-medium text-danger">
              <ShieldAlert size={13} className="shrink-0" />
              这个技能无法安装
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-subtle">
              它声明了 Aura 不认识的工具名：
              <span className="font-mono">{inspection.unknown_tools.join("、")}</span>
              。装进去后，该技能激活期间所有工具都会被挡掉，模型将无事可做。
              请让技能作者更正工具名。
            </p>
          </div>
        )}

        {updating && inspection.installed_version && (
          <p className="rounded-card border border-line px-3 py-2 text-xs text-subtle">
            已安装 v{inspection.installed_version}，将更新到 v{inspection.version}。
            你自己加进技能目录的文件会保留，包内文件以新版本为准。
          </p>
        )}

        <h4 className="text-xs font-medium">申请的权限</h4>
        <ul className="flex flex-col gap-1">
          {permissionLines(inspection.tools, inspection.audit.has_scripts).map((line) => (
            <li key={line} className="text-xs leading-relaxed text-subtle">
              · {line}
            </li>
          ))}
        </ul>
        {inspection.tools.length === 0 && (
          <p className="mt-1 text-[11px] leading-relaxed text-subtle">
            不限工具的技能会跟随当前会话模式：对话/规划只读，执行才可写文件与跑命令。
          </p>
        )}

        <div className="flex items-center gap-2">
          {risky ? (
            <ShieldAlert size={14} className="shrink-0 text-danger" />
          ) : (
            <FileWarning size={14} className="shrink-0 text-subtle" />
          )}
          <h4 className="text-xs font-medium">静态审查</h4>
          <span className="text-[11px] text-subtle">{auditHeadline(counts)}</span>
        </div>

        {findings.length === 0 ? (
          <p className="mt-1.5 text-xs leading-relaxed text-subtle">
            已逐行检查 {inspection.audit.scanned_files} 个文本文件，
            没有命中危险命令、凭据读取或提示词注入。
          </p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {findings.map((f, i) => (
              <li
                key={`${f.rule}-${f.file}-${f.line}-${i}`}
                className="rounded-card border border-line px-3 py-2"
              >
                <p className="flex flex-wrap items-baseline gap-2 text-[11px]">
                  <span
                    className={`font-medium ${SEVERITY_CLASS[f.severity] ?? "text-subtle"}`}
                  >
                    {SEVERITY_LABEL[f.severity]}
                  </span>
                  <span className="text-xs">{f.note}</span>
                  <span className="font-mono text-subtle">
                    {f.file}
                    {f.line > 0 ? `:${f.line}` : ""}
                  </span>
                </p>
                {f.excerpt && (
                  <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-subtle">
                    {f.excerpt}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="mt-3 break-words text-xs text-danger">{error}</p>}
      </div>
    </ConfirmDialog>
  );
}
