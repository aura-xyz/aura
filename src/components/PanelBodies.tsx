/**
 * 右栏标签页的组件侧注册（v0.8.0）。
 *
 * 注册表本身保持纯数据（lib/panels.ts），组件映射留在这里：
 * 新增一种标签 = 注册一条定义 + 在这里挂一个 body，外壳 App.tsx 不用改。
 */
import { Suspense, lazy, type ComponentType } from "react";
import { Folder, Gauge, Globe, LayoutGrid, ListTodo, Terminal, type LucideIcon } from "lucide-react";
import { panelRegistry, type PanelDefinition } from "../lib/panels";
import type { SidebarTab, SidebarTabKind } from "../lib/sidebarTabs";
import type { View } from "./Sidebar";
import { FileBrowserPanel } from "./FileBrowserPanel";
import { WebBrowserPanel } from "./WebBrowserPanel";
import { UsagePanel } from "./UsagePanel";
import RightPanel from "./RightPanel";
import SidebarStartPage from "./SidebarStartPage";

/** xterm 有几百 KB，懒加载，别拖进首屏。 */
const TerminalPanel = lazy(() => import("./TerminalPanel"));

export interface PanelContext {
  sessionId: string;
  view: View;
  /** 当前选中的模型 key（用量面板按它查牌价） */
  model?: string;
  /** 当前标签（终端要从它取 shell 参数） */
  tab: SidebarTab;
  /** 该标签是不是当前激活的（终端在激活时补一次尺寸同步） */
  active: boolean;
  /** 开始页用它打开别的标签 */
  onOpen: (kind: SidebarTabKind, params?: Record<string, string>) => void;
}

const DEFINITIONS: PanelDefinition[] = [
  { id: "start", label: "开始页", order: 5 },
  { id: "files", label: "文件", order: 10 },
  { id: "web", label: "网页", order: 20 },
  { id: "terminal", label: "终端", order: 25 },
  { id: "todo", label: "任务", order: 30 },
  { id: "usage", label: "用量", order: 40 },
];

for (const def of DEFINITIONS) {
  // 模块可能被重复求值（测试里 resetModules），重复注册要幂等
  if (!panelRegistry.has(def.id)) panelRegistry.register(def);
}

export const PANEL_ICONS: Record<string, LucideIcon> = {
  start: LayoutGrid,
  files: Folder,
  web: Globe,
  terminal: Terminal,
  todo: ListTodo,
  usage: Gauge,
};

export const PANEL_BODIES: Record<string, ComponentType<PanelContext>> = {
  start: ({ onOpen }: PanelContext) => (
    <SidebarStartPage
      onOpenFiles={() => onOpen("files")}
      onOpenWeb={() => onOpen("web")}
      onOpenTerminal={(shellPath) =>
        onOpen("terminal", shellPath ? { shell: shellPath } : undefined)
      }
      onOpenMore={(kind) => onOpen(kind)}
    />
  ),
  files: ({ sessionId }: PanelContext) => <FileBrowserPanel sessionId={sessionId} />,
  web: () => <WebBrowserPanel />,
  terminal: ({ sessionId, tab }: PanelContext) => (
    <Suspense
      fallback={
        <p className="px-3 py-4 text-[11px] text-subtle">正在加载终端…</p>
      }
    >
      <TerminalPanel
        sessionId={sessionId}
        terminalId={tab.contentId.replace(/^terminal:/, "")}
        shellPath={tab.params?.shell}
      />
    </Suspense>
  ),
  usage: ({ model }: PanelContext) => <UsagePanel model={model ?? ""} />,
  todo: ({ view }: PanelContext) =>
    view === "chat" ? (
      <RightPanel />
    ) : (
      <p className="px-3 py-4 text-[11px] text-subtle">任务面板只在对话视图可用</p>
    ),
};
