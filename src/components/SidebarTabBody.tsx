/**
 * 右栏标签页的正文（v0.8.0）。
 *
 * 只做一件事：按标签种类挑出对应的 body 组件。
 * 外壳（标签栏、宽度、折叠、全屏）由 App.tsx 统一管理，
 * 这里不碰任何布局，避免「老组件塞进新容器」那类重复外壳的问题
 * （见 v0.8.0 踩坑 #93）。
 */
import { PANEL_BODIES } from "./PanelBodies";
import type { SidebarTab, SidebarTabKind } from "../lib/sidebarTabs";
import type { View } from "./Sidebar";

interface Props {
  tab: SidebarTab;
  sessionId: string;
  view: View;
  model?: string;
  /** 该标签是不是当前激活的 */
  active: boolean;
  /** 开始页用它打开别的标签 */
  onOpen: (kind: SidebarTabKind, params?: Record<string, string>) => void;
}

export function SidebarTabBody({
  tab,
  sessionId,
  view,
  model,
  active,
  onOpen,
}: Props) {
  const Body = PANEL_BODIES[tab.kind];
  if (!Body) {
    return (
      <p className="px-3 py-4 text-[11px] text-subtle">
        未注册的标签类型：{tab.kind}
      </p>
    );
  }
  return (
    <Body
      sessionId={sessionId}
      view={view}
      model={model}
      tab={tab}
      active={active}
      onOpen={onOpen}
    />
  );
}

export default SidebarTabBody;
