import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes?: string;
  date?: string;
}

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
   * 带上插件返回的 `Update` 句柄：**安装必须复用它**。
   * 已经查到的更新如果丢了、安装时再 `check()` 一次，就多了一次网络请求，
   * 也把自己多暴露在一个失败点上前提——v0.6.1 就栽在这里：第一次检查成功、
   * 点「下载并安装」后第二次 check 超时，用户看到的是「安装失败」。
   */
  | { kind: "available"; info: UpdateInfo; update: Update }
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
export async function checkForUpdate(
  currentVersion: string,
): Promise<UpdateCheckResult> {
  try {
    const update = await withTimeout(check(), CHECK_TIMEOUT_MS);
    if (!update) {
      return { kind: "up-to-date" };
    }
    return {
      kind: "available",
      info: {
        version: update.version,
        currentVersion,
        notes: update.body ?? undefined,
        date: update.date ?? undefined,
      },
      update,
    };
  } catch (error) {
    return categorizeCheckError(error) === "unavailable"
      ? { kind: "unavailable" }
      : { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 下载并安装更新。
 *
 * 必须传入**检查阶段拿到的那个 `Update` 句柄**，不要在这里重新 `check()`：
 * 重新检查等于再请求一次清单端点，既不必要，也把安装成功率绑在了第二次
 * 网络上（`latest.json` 与安装包是两个不同的地址，前者失败时用户会看到
 * 「安装失败：error sending request for ... latest.json」，指向的还是清单）。
 *
 * Tauri 的安装分两步：先 `downloadAndInstall` 把包下载并解压到
 * 暂存区，再 `relaunch` 重启应用让新版本生效。
 *
 * 调用方需自行展示下载进度——大文件下载可能持续数十秒。
 */
export async function downloadAndInstall(
  update: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress?.(0, total);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(downloaded, total);
        break;
      case "Finished":
        onProgress?.(total ?? downloaded, total);
        break;
    }
  });
}

/**
 * 把安装阶段的错误翻成人话。
 *
 * 插件抛的是 reqwest 的原始错误（`error sending request for url (...)`），
 * 对用户没有信息量；而「下载失败」和「签名校验失败」的处置完全不同——
 * 前者重试或走浏览器入口，后者只能重新下载。
 */
export function describeInstallError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/signature|签名/i.test(raw)) {
    return "安装包签名校验未通过，已中止。请从发布页重新下载安装包。";
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
