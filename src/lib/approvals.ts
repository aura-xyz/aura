/**
 * 审批请求的待决议队列（v0.8.0 C41）。
 *
 * 与 `lib/notices.ts` 同一套做法：模块级状态 + `useSyncExternalStore`，
 * 不塞进 `StoreContext`。理由是它**不属于会话数据**——它是一次性的、
 * 跨会话可见的、来去都由后端事件驱动的临时状态；塞进 store 会让
 * 每次审批都触发整棵会话树的重渲染。
 *
 * 生命周期由后端说了算：
 * - 后端发 `agent:approval` → 入队，同时按 `timeout_ms` 排一个清理定时器；
 * - 用户点允许/拒绝 → 调 `resolve_approval` → 出队；
 * - 本轮结束（`agent:done`）或后端超时 → 出队。
 *
 * 前端**不判断**该不该问：策略与规则都在后端，界面只负责把问题摆出来。
 */
import { listen } from "@tauri-apps/api/event";
import { resolveApproval } from "./api";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  tool: string;
  /** 完整命令（可能多行），审批卡里折叠展示 */
  command: string;
  /** 首行摘要，用于卡片标题 */
  preview: string;
  /** 命中的规则 id，便于用户和日志对齐 */
  ruleId: string;
  /** 中文原因 */
  reason: string;
  /** 后端等待上限（毫秒） */
  timeoutMs: number;
  receivedAt: number;
}

let requests: ApprovalRequest[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** 超时后多久把卡片撤掉：后端先超时拒绝，前端稍后再撤，避免闪一下又出现。 */
const DROP_GRACE_MS = 1200;

function emit(): void {
  for (const cb of listeners) cb();
}

export function subscribeApprovals(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 快照必须是**稳定引用**，否则 `useSyncExternalStore` 会无限重渲染。 */
export function approvalsSnapshot(): ApprovalRequest[] {
  return requests;
}

export function pendingApprovals(sessionId: string): ApprovalRequest[] {
  return requests.filter((r) => r.sessionId === sessionId);
}

export function pushApproval(req: ApprovalRequest): void {
  // 同 id 重复推送（重连、事件重放）只保留一份
  if (requests.some((r) => r.id === req.id)) return;
  const next = [...requests, req];
  requests = next;
  const timer = setTimeout(() => dropApproval(req.id), req.timeoutMs + DROP_GRACE_MS);
  timers.set(req.id, timer);
  emit();
}

export function dropApproval(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = requests.filter((r) => r.id !== id);
  if (next.length === requests.length) return;
  requests = next;
  emit();
}

/** 会话结束/被停止时清空该会话的卡片（后端已把它们决议为拒绝）。 */
export function dropSessionApprovals(sessionId: string): void {
  const doomed = requests.filter((r) => r.sessionId === sessionId);
  if (!doomed.length) return;
  for (const r of doomed) dropApproval(r.id);
}

/** 测试用：恢复到初始状态并清掉所有定时器。 */
export function resetApprovals(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  requests = [];
  listeners.clear();
}

export interface ApprovalDecisionInput {
  id: string;
  approved: boolean;
  remember: boolean;
}

/**
 * 决议一次请求。
 *
 * 返回 `false` 表示后端已经没有这个请求（超时/已决），界面应当提示而不是
 * 假装点成功了——否则用户会以为命令被执行了。
 */
export async function decideApproval({
  id,
  approved,
  remember,
}: ApprovalDecisionInput): Promise<boolean> {
  const accepted = await resolveApproval(id, approved, remember);
  dropApproval(id);
  return accepted;
}

/**
 * 绑定后端事件。返回解绑函数。
 *
 * 与 store 里的订阅分开：审批 UI 可能不在会话视图里（例如用户在设置页
 * 时后端仍在跑），这条通道不能依赖某个组件挂载。
 */
export async function bindApprovalEvents(): Promise<() => void> {
  const unsubs: Array<() => void> = [];

  unsubs.push(
    await listen<{
      id: string;
      session_id: string;
      tool: string;
      command: string;
      preview: string;
      rule_id: string;
      reason: string;
      timeout_ms: number;
    }>("agent:approval", (e) => {
      const p = e.payload;
      pushApproval({
        id: p.id,
        sessionId: p.session_id,
        tool: p.tool,
        command: p.command,
        preview: p.preview || p.command.split("\n")[0] || "",
        ruleId: p.rule_id,
        reason: p.reason,
        timeoutMs: p.timeout_ms || 120_000,
        receivedAt: Date.now(),
      });
    }),
  );

  // 一轮结束意味着不会再有决议：剩下的卡片（例如超时后后端已拒绝但
  // 前端还没收到）统一撤掉，别让用户对着一个点不动的按钮发呆。
  unsubs.push(
    await listen<{ session_id: string }>("agent:done", (e) => {
      dropSessionApprovals(e.payload.session_id);
    }),
  );

  return () => {
    for (const un of unsubs) un();
  };
}
