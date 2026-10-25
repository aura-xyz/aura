import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import {
  ArrowDownToLine,
  Bug,
  Check,
  ExternalLink,
  Globe,
  Power,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  checkForUpdate,
  describeInstallError,
  downloadAndInstall,
  restartApp,
  type UpdateCheckResult,
} from "../lib/updater";
import { quitApp } from "../lib/api";

const REPO_URL = "https://github.com/aura-xyz/aura";
const SITE_URL = "https://aura-xyz.github.io/";
const ISSUES_URL = `${REPO_URL}/issues`;

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "checked"; result: UpdateCheckResult }
  | {
      kind: "downloading";
      downloaded: number;
      total: number | null;
      /** 实际使用的下载源 */
      source?: string;
    }
  | { kind: "installed" }
  | { kind: "error"; message: string };

/** 字节数转可读体积。 */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 关于页里的一行链接：左图标、中间标题、右侧地址（可省略）。 */
function LinkRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2.5 text-left text-sm transition-colors hover:bg-bubble"
    >
      <span className="shrink-0 text-subtle">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value && <span className="shrink-0 text-xs text-subtle">{value}</span>}
    </button>
  );
}

/**
 * 更新失败的兜底出口：浏览器打开最新发布页。
 *
 * 内置更新要经 GitHub 的发布资产域名（release-assets.githubusercontent.com），
 * 该域名在国内常被阻断且多数加速工具未覆盖——此时应用内检查/下载必然失败，
 * 而用户浏览器往往能正常访问。给一条可见的出路，好过只留一句报错。
 */
function BrowserFallback({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => openUrl(`${REPO_URL}/releases/latest`)}
      className={`flex items-center gap-1 self-start text-xs text-brand transition-opacity hover:underline ${className}`}
    >
      <ExternalLink size={12} className="shrink-0" />
      在浏览器中打开下载页
    </button>
  );
}

export default function AboutSection() {
  const [version, setVersion] = useState("");
  const [state, setState] = useState<CheckState>({ kind: "idle" });

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("未知"));
  }, []);

  async function handleCheck() {
    if (!version) return;
    setState({ kind: "checking" });
    const result = await checkForUpdate();
    // 三种成功结局 + 两种失败结局，UI 分别提示，见 lib/updater.ts
    setState({ kind: "checked", result });
  }

  /**
   * 安装。后端会复用检查阶段存下的那个 `Update`——前端不持句柄，
   * 也就不会出现「句柄过期 / 重新检查多一次网络往返」这类失败理由。
   */
  async function handleInstall() {
    setState({ kind: "downloading", downloaded: 0, total: null });
    try {
      await downloadAndInstall((downloaded, total, source) => {
        setState({ kind: "downloading", downloaded, total, source });
      });
      setState({ kind: "installed" });
      await restartApp();
    } catch (e) {
      setState({ kind: "error", message: describeInstallError(e) });
    }
  }

  const busy =
    state.kind === "checking" ||
    state.kind === "downloading" ||
    state.kind === "installed";

  /**
   * 提前收窄：安装按钮的 onClick 是个闭包，在 JSX 里判断 `state.result.kind`
   * 无法把类型带进闭包（TS 会认为 info 可能不存在）。先取出来，既能安全调用，
   * 也保证「安装的就是检查到的那一个」。
   */
  const available =
    state.kind === "checked" && state.result.kind === "available"
      ? state.result
      : null;

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="mb-3 text-sm font-medium">Aura</h3>
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
          <img src="/logo.png" alt="Aura" className="h-12 w-12" draggable={false} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">本地优先的桌面 AI Agent</p>
            <p className="mt-0.5 text-xs text-subtle">
              版本 {version || "—"} · 会话与密钥全部存于本机
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium">项目</h3>
        <div className="flex flex-col gap-1">
          <LinkRow
            icon={<Globe size={14} />}
            label="官方网站"
            value="aura-xyz.github.io"
            onClick={() => openUrl(SITE_URL)}
          />
          <LinkRow
            icon={<Bug size={14} />}
            label="问题反馈"
            value="GitHub Issues"
            onClick={() => openUrl(ISSUES_URL)}
          />
          <LinkRow
            icon={<ExternalLink size={14} />}
            label="源代码仓库"
            value={REPO_URL}
            onClick={() => openUrl(REPO_URL)}
          />
          <LinkRow
            icon={<ArrowDownToLine size={14} />}
            label="历史版本下载"
            onClick={() => openUrl(`${REPO_URL}/releases`)}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium">更新</h3>
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
          {state.kind === "checked" && state.result.kind === "up-to-date" && (
            <p className="flex items-center gap-2 text-sm text-subtle">
              <Check size={14} className="text-brand" />
              已是最新版本
            </p>
          )}

          {available && (
            <>
              <p className="text-sm">
                发现新版本 {available.info.version}
                <span className="ml-2 text-xs text-subtle">
                  当前 {version || "—"}
                </span>
              </p>
              {available.info.notes && (
                <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-subtle">
                  {available.info.notes}
                </p>
              )}
              <button
                type="button"
                onClick={() => handleInstall()}
                disabled={busy}
                className="mt-1 flex items-center justify-center gap-1.5 rounded-md border border-line bg-bubble py-2 text-sm transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
              >
                <ArrowDownToLine size={14} />
                下载并安装
              </button>
            </>
          )}

          {state.kind === "checked" && state.result.kind === "unavailable" && (
            <p className="flex items-start gap-2 text-sm text-subtle">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                更新服务暂不可用（新版本可能刚发布，清单尚未上传完成），请稍后重试。
              </span>
            </p>
          )}

          {state.kind === "checked" && state.result.kind === "failed" && (
            <div className="flex flex-col gap-1">
              <p className="flex items-start gap-2 text-sm text-subtle">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <span>检查失败，请检查网络连接后重试。</span>
              </p>
              <p className="ml-6 break-all text-xs text-subtle">
                {state.result.reason}
              </p>
              {/* 网络受限时（如 GitHub 资产域名不可达）检查永远失败，
                  给一条到发布页的出路——浏览器往往能正常打开。 */}
              <BrowserFallback className="ml-6 mt-0.5" />
            </div>
          )}

          {state.kind === "checking" && (
            <p className="text-xs text-subtle">
              检查可能需要 20 秒以上（本地证书验证较慢），请耐心等待。
            </p>
          )}

          {state.kind === "downloading" && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm text-subtle">
                正在下载更新…
                {state.total ? ` ${fmtSize(state.downloaded)} / ${fmtSize(state.total)}` : ""}
                {state.source ? ` · 来源 ${state.source}` : ""}
              </p>
              <div className="h-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-brand transition-all"
                  style={{
                    width: state.total
                      ? `${Math.min(100, (state.downloaded / state.total) * 100)}%`
                      : "30%",
                  }}
                />
              </div>
              <p className="text-xs text-subtle">下载完成后应用会自动重启</p>
            </div>
          )}

          {state.kind === "installed" && (
            <p className="text-sm text-subtle">更新已安装，正在重启…</p>
          )}

          {state.kind === "error" && (
            <div className="flex flex-col gap-1.5">
              <p className="flex items-start gap-2 text-sm text-danger">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <span>安装失败：{state.message}</span>
              </p>
              {/* 内置下载同样要经 GitHub 资产域名；失败时引导用户去浏览器。 */}
              <BrowserFallback className="ml-6" />
            </div>
          )}

          {state.kind === "idle" && (
            <p className="text-sm text-subtle">
              检查是否有新版本。更新会在下载完成后自动重启应用。
            </p>
          )}

          <button
            type="button"
            onClick={handleCheck}
            disabled={busy || !version}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-md border border-line py-2 text-sm transition-colors hover:bg-bubble disabled:opacity-40"
          >
            <RefreshCw size={14} className={state.kind === "checking" ? "animate-spin" : ""} />
            {state.kind === "checking" ? "检查中…" : "检查更新"}
          </button>
        </div>
      </section>

      {/* v0.7.0：退出入口。
          关闭窗口现在是「隐藏到托盘」（常驻后台），所以必须有一条
          明确的退出路径——否则用户会以为应用关不掉。 */}
      <section>
        <h3 className="mb-3 text-sm font-medium">应用</h3>
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
          <p className="text-xs leading-relaxed text-subtle">
            关闭窗口只是最小化到系统托盘，Aura 会在后台继续运行
            （长任务跑完仍能收到系统通知）。要完全退出请用下面的按钮，
            或在托盘图标上右键选择「退出 Aura」。
          </p>
          <button
            type="button"
            onClick={() => void quitApp()}
            className="flex items-center justify-center gap-1.5 rounded-md border border-line py-2 text-sm transition-colors hover:border-danger hover:text-danger"
          >
            <Power size={14} />
            退出 Aura
          </button>
        </div>
      </section>
    </div>
  );
}