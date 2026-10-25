import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  checkUpdate,
  downloadUpdate,
  type UpdateInfoView,
} from "./api";

export type UpdateInfo = UpdateInfoView;

/**
 * 检查更新的结局。失败细分为两类，UI 给的提示完全不同：
 * - `unavailable`：端点拿不到有效清单。发布新版本时 Release 先公开、
 *   资产后上传，窗口期内的旧客户端全部命中——不是用户的网络问题，
 *   提示「检查网络」会误导用户。
 * - `failed`：连接 / TLS / 响应解析等真实故障，应提示检查网络。
 */
export type UpdateCheckResult =
  | { kind: "up-to-date" }
  /**
   * 有新版本。**不带句柄**：安装时后端会复用检查阶段存下的那个 `Update`，
   * 前端不需要（也不应该）持有它。
   */
  | { kind: "available"; info: UpdateInfo }
  | { kind: "unavailable" }
  | { kind: "failed"; reason: string };

/**
 * 插件对「端点未返回有效清单」的报错文案（tauri-plugin-updater 的
 * `Error::ReleaseNotFound`，经 Tauri IPC 原样透传到前端）。
 * 匹配时统一转小写：不假设插件的大小写习惯。
 */
const RELEASE_NOT_FOUND = "could not fetch a valid release json";

/**
 * 把 `check()` 抛出的错误归类。判定依据是插件的对外错误文案：
 * ReleaseNotFound → 清单不存在（多为发布窗口期）；其余（连接失败、
 * TLS 证书、响应解析失败）→ 真实故障。文案属于插件的对外契约，
 * 这里按契约匹配，而非猜测堆栈细节。
 */
export function categorizeCheckError(error: unknown): "unavailable" | "failed" {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes(RELEASE_NOT_FOUND) ? "unavailable" : "failed";
}

/**
 * 检查总超时。
 *
 * 端点配了多个（主 + 兜底），插件按序尝试且**没有单请求超时**：网络受限时
 * 某个端点可能长时间无响应，用户会一直看到「检查中…」转圈。
 * 这里只限制「等多久就放弃」——底层请求无法取消，但拿到答复比无限等待有用：
 * 超时归入 `failed`，UI 会显示原因并给出浏览器下载出口。
 */
const CHECK_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`检查超时（超过 ${Math.round(ms / 1000)} 秒无响应）`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * 检查是否有新版本。
 *
 * 返回判别联合而非 `UpdateInfo | null`：`null` 无法表达「为什么失败」，
 * 而 404 窗口期与真实网络故障需要给用户不同的提示（见
 * {@link UpdateCheckResult}）。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const info = await withTimeout(checkUpdate(), CHECK_TIMEOUT_MS);
    if (!info) {
      return { kind: "up-to-date" };
    }
    return { kind: "available", info };
  } catch (error) {
    return categorizeCheckError(error) === "unavailable"
      ? { kind: "unavailable" }
      : { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 下载并安装更新。
 *
 * 后端会**并发探测**各下载源的真实速度，挑最快的那个再下载——
 * GitHub Release 资产在境内只有约 0.05 MB/s（42.9MB 要 14 分钟），
 * 镜像能到 0.37 MB/s。签名校验与安装仍由 updater 插件负责，镜像改不了内容。
 *
 * 进度由后端经 `update:progress` 事件推送。
 */
export async function downloadAndInstall(
  onProgress?: (
    downloaded: number,
    total: number | null,
    source?: string,
  ) => void,
): Promise<void> {
  const unlisten = await listen<{
    downloaded: number;
    total: number | null;
    source: string;
  }>("update:progress", (e) => {
    onProgress?.(e.payload.downloaded, e.payload.total, e.payload.source);
  });
  try {
    await downloadUpdate();
  } finally {
    unlisten();
  }
}

/**
 * 把安装阶段的错误翻成人话。
 *
 * 抛出来的可能是 reqwest 的原始错误（`error sending request for ...`），
 * 对用户没有信息量；而「下载失败」和「签名校验失败」的处置完全不同——
 * 前者重试或走浏览器入口，后者只能重新下载。
 */
export function describeInstallError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/signature|签名/i.test(raw)) {
    return "安装包签名校验未通过，已中止。请从发布页重新下载安装包。";
  }
  if (/没有可用的下载源|no available/i.test(raw)) {
    return "所有下载源都连不上。请检查网络后重试，或用下面的浏览器入口手动安装。";
  }
  if (/没有待安装的更新/i.test(raw)) {
    return "更新信息已失效，请重新检查更新。";
  }
  if (/error sending request|dns|connect|timed out|timeout|network/i.test(raw)) {
    return "下载安装包时网络中断。可以重试，或用下面的浏览器入口手动安装。";
  }
  return raw;
}

/** 安装完成后重启应用。 */
export async function restartApp(): Promise<void> {
  await relaunch();
}
