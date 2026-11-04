/**
 * 右栏面板的组件侧注册（v0.8.0）。
 *
 * 注册表本身保持纯数据（lib/panels.ts），组件映射留在这里：
 * 新增一种面板 = 注册一条定义 + 在这里挂一个 body，外壳 App.tsx 不用改。
 */
import type { ComponentType } from "react";
import { Folder, Globe, ListTodo, type LucideIcon } from "lucide-react";
import { panelRegistry, type PanelDefinition } from "../lib/panels";
import type { View } from "./Sidebar";
import { FileBrowserPanel } from "./FileBrowserPanel";
import { WebBrowserPanel } from "./WebBrowserPanel";
import RightPanel from "./RightPanel";

export interface PanelContext {
  sessionId: string;
  view: View;
}

const DEFINITIONS: PanelDefinition[] = [
  { id: "files", label: "文件", order: 10 },
  { id: "web", label: "网页", order: 20 },
  { id: "todo", label: "任务", order: 30 },
];

for (const def of DEFINITIONS) {
  // 模块可能被重复求值（测试里 resetModules），重复注册要幂等
  if (!panelRegistry.has(def.id)) panelRegistry.register(def);
}

export const PANEL_ICONS: Record<string, LucideIcon> = {
  files: Folder,
  web: Globe,
  todo: ListTodo,
};

export const PANEL_BODIES: Record<string, ComponentType<PanelContext>> = {
  files: ({ sessionId }: PanelContext) => <FileBrowserPanel sessionId={sessionId} />,
  web: () => <WebBrowserPanel />,
  todo: ({ view }: PanelContext) =>
    view === "chat" ? (
      <RightPanel />
    ) : (
      <p className="px-3 py-4 text-[11px] text-subtle">任务面板只在对话视图可用</p>
    ),
};
