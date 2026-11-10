/**
 * 前端统一错误模型（v0.8.1 P11）。
 *
 * 后端有完整的 ModelError 枚举，但传到 invoke / 事件里被压成了一个
 * `String`，组件只能整段展示。这里在**前端**把字符串归类成有限的几档，
 * 给出可读中文说明与「能不能重试」，供流式失败状态机（P12）和 toast 复用。
 *
 * 归类是兜底而不是精确解析：模型厂商的错误文案会变，匹配不到就落到
 * unknown，绝不因为认不出而把错误吞掉或抛新异常。
 */

export type AppErrorCode =
  | "net_timeout"
  | "auth"
  | "rate_limit"
  | "context_overflow"
  | "local_down"
  | "cancelled"
  | "unknown";

export interface AppError {
  code: AppErrorCode;
  /** 面向用户的中文说明 */
  message: string;
  /** 原始错误文本，供折叠详情 / 诊断使用 */
  detail: string;
  /** 是否值得提供「重试」按钮 */
  retryable: boolean;
}

interface Rule {
  code: AppErrorCode;
  test: RegExp;
  message: string;
  retryable: boolean;
}

/** 顺序即优先级：越具体的越靠前。 */
const RULES: Rule[] = [
  {
    code: "auth",
    test: /401|403|unauthorized|invalid[_ ]?api[_ ]?key|api[_ ]?key|鉴权|密钥|未授权|认证失败/,
    message: "模型服务的密钥无效或已过期，请到设置里更新后重试。",
    retryable: false,
  },
  {
    code: "rate_limit",
    test: /429|rate.?limit|限流|频率|quota|额度/,
    message: "模型服务触发限流，稍等片刻再重试。",
    retryable: true,
  },
  {
    code: "context_overflow",
    test: /context.{0,12}(overflow|length|window)|上下文|token.{0,8}(超限|过长|limit)|too long/,
    message: "本轮上下文超出模型窗口，请压缩历史或新开会话。",
    retryable: false,
  },
  {
    code: "net_timeout",
    test: /timeout|timed out|超时|连接中断|断网|network|econnreset|连接失败/,
    message: "网络连接中断或超时，已保留已生成的内容。",
    retryable: true,
  },
  {
    code: "local_down",
    test: /connection refused|econnrefused|unreachable|离线|offline|本地模型|ollama|服务未启动/,
    message: "本地模型服务不可用，请确认它已启动。",
    retryable: true,
  },
  {
    code: "cancelled",
    test: /已停止生成|cancelled|canceled|用户取消|已取消/,
    message: "本轮生成已停止。",
    retryable: false,
  },
];

const UNKNOWN: Rule = {
  code: "unknown",
  test: /.*/,
  message: "请求失败，请重试。",
  retryable: true,
};

/** 从任意抛出的值里取出可比较的文本，不抛二次异常。 */
function textOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const obj = e as { message?: unknown; detail?: unknown };
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.detail === "string") return obj.detail;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e ?? "");
}

/** 把 invoke / 事件错误归类成统一结构。 */
export function toAppError(e: unknown): AppError {
  const detail = textOf(e).trim();
  const rule = RULES.find((r) => r.test.test(detail.toLowerCase())) ?? UNKNOWN;
  return {
    code: rule.code,
    message: rule.message,
    detail,
    retryable: rule.retryable,
  };
}

/** 流式状态机的两种终态（v0.8.1 P12）。 */
export interface StreamFailureInfo {
  /** interrupted：网络中断 / 超时；failed：鉴权、限流、上下文溢出等 */
  kind: "interrupted" | "failed";
  code: AppErrorCode;
  message: string;
  detail: string;
  retryable: boolean;
}

/**
 * 把一次流式失败归到终态。
 *
 * 网络类归 interrupted（内容可能只是「没传完」，值得重试）；其余归
 * failed（重试也不会变好，需要用户先去改配置 / 压缩上下文）。
 */
export function toStreamFailure(e: unknown): StreamFailureInfo {
  const app = toAppError(e);
  return {
    kind:
      app.code === "net_timeout" || app.code === "local_down"
        ? "interrupted"
        : "failed",
    code: app.code,
    message: app.message,
    detail: app.detail,
    retryable: app.retryable,
  };
}

/** 组件只需一句提示时的快捷入口（等价于 toAppError(e).message）。 */
export function errorText(e: unknown): string {
  return toAppError(e).message;
}
