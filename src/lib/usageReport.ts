/**
 * 会话用量的展示行与 CSV（v0.8.0）。
 *
 * 纯函数：面板只负责渲染，数字口径与 CSV 内容都在这里定，便于单测。
 * 所有值来自后端 usage 事件与 action 块的 durationMs，不做估算；
 * 唯一带「估」字的是成本，那是按牌价折算的，界面上会单独标注。
 */
import type { Session } from "../store";
import { deriveStats } from "./stats";
import { estimateCost, formatUsd, priceOf } from "./pricing";

export interface UsageRow {
  label: string;
  value: string;
  /** 成本行的口径说明，渲染时用灰字跟在后面 */
  note?: string;
}

function formatInt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatMs(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

/**
 * 总览行。
 *
 * `model` 是当前选中的模型 id：usage 事件目前不带模型标识，所以成本只能
 * 按当前模型牌价折算，并在 note 里写清楚——换过模型的会话，这个数字会偏。
 */
export function usageRows(session: Session, model: string): UsageRow[] {
  const totals = session.usageTotals;
  const stats = deriveStats(session.messages, session.llmMs ?? 0);
  const price = priceOf(model);

  const rows: UsageRow[] = [
    { label: "输入", value: totals ? `${formatInt(totals.input)} tokens` : "—" },
    { label: "输出", value: totals ? `${formatInt(totals.output)} tokens` : "—" },
    { label: "总计", value: totals ? `${formatInt(totals.total)} tokens` : "—" },
    { label: "轮次", value: totals ? `${formatInt(totals.turns)} 轮` : "—" },
    { label: "模型耗时", value: formatMs(session.llmMs ?? 0) },
    { label: "工具耗时", value: formatMs(stats.toolMs) },
  ];

  if (totals && price) {
    const cost = estimateCost(model, totals.input, totals.output);
    rows.push({
      label: "估算成本",
      value: cost === null ? "—" : formatUsd(cost),
      note: `按 ${price.family} 牌价折算，实际账单受缓存与折扣影响`,
    });
  } else {
    rows.push({
      label: "估算成本",
      value: "—",
      note: totals ? "该模型没有公开牌价" : "还没有真实用量",
    });
  }
  return rows;
}

/** CSV：两列「项目,数值」，UTF-8 BOM 让 Excel 正确识别中文。 */
export function usageCsv(session: Session, model: string): string {
  const lines = ["项目,数值"];
  for (const row of usageRows(session, model)) {
    // 逗号与引号按 CSV 规则转义
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    lines.push(`${escape(row.label)},${escape(row.value)}`);
  }
  return `\ufeff${lines.join("\n")}\n`;
}
