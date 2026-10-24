import { check } from "@tauri-apps/plugin-updater";
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
 * Tauri 的安装分两步：先 `downloadAndInstall` 把包下载并解压到
 * 暂存区，再 `relaunch` 重启应用让新版本生效。缺少第二步的话
 * 包会一直躺在暂存区，用户看不到任何变化。
 *
 * 调用方需自行展示下载进度——大文件下载可能持续数十秒。
 */
export async function downloadAndInstall(
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  // check() 返回 null 表示服务端没有提供比当前版本更新的包，
  // 类型上必须收窄后再用，否则下面 .downloadAndInstall 会崩
  const update = await check();
  if (!update) throw new Error("没有可安装的更新");

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

/** 安装完成后重启应用。 */
export async function restartApp(): Promise<void> {
  await relaunch();
}
