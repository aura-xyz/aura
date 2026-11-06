/**
 * 右侧虚拟滚动时间线（v0.8.0，参照 dsh ui-chat/TurnNavigator）。
 *
 * 常驻的是一条固定间距的窄刻度轨；指针移上去展开预览面板，列出每一轮
 * 的问题摘要。刻度轨与面板都是定高列表，只渲染可见区间（turnRail.ts
 * 的 visibleRange），所以上千轮也不会往 DOM 里塞上千个按钮。
 *
 * 当前轮次与指针悬停轮次同时高亮；点击任一刻度/行跳转到该轮。
 */
import { useEffect, useRef, useState } from "react";
import {
  centerOffset,
  previewText,
  totalSize,
  visibleRange,
  type TurnItem,
} from "../lib/turnRail";

/** 刻度间距、上下留白与两处虚拟视口高度。定高是虚拟化的前提。 */
const PITCH = 10;
const INSET = 6;
const RAIL_VIEWPORT = 360;
const ROW = 34;
const PANEL_VIEWPORT = 320;
const OVERSCAN = 3;

interface Props {
  items: TurnItem[];
  /** 1-based；0 表示还没有激活轮次 */
  activeTurn: number;
  onNavigate: (turn: number) => void;
}

export default function TurnNavigator({ items, activeTurn, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [previewTurn, setPreviewTurn] = useState<number | null>(null);
  const [railTop, setRailTop] = useState(0);
  const [panelTop, setPanelTop] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const pointerInside = useRef(false);

  const count = items.length;
  const railTotal = totalSize(count, PITCH, INSET);
  const panelTotal = totalSize(count, ROW, INSET);
  const railRange = visibleRange(count, railTop, RAIL_VIEWPORT, PITCH, OVERSCAN);
  const panelRange = visibleRange(count, panelTop, PANEL_VIEWPORT, ROW, OVERSCAN);

  // 激活轮次变化时把刻度滚到轨道中央；指针在轨道里时不抢用户的滚动。
  useEffect(() => {
    const el = railRef.current;
    if (!el || pointerInside.current || activeTurn <= 0) return;
    const next = centerOffset(
      activeTurn - 1,
      PITCH,
      INSET,
      Math.min(RAIL_VIEWPORT, railTotal),
      railTotal,
    );
    el.scrollTop = next;
    setRailTop(next);
  }, [activeTurn, railTotal]);

  // 少于两轮时一条轨没有导航意义，也不该占着消息区右侧。
  if (count < 2) return null;

  function markClass(turn: number): string {
    if (turn === activeTurn) return "h-1 w-5 rounded-full bg-foreground";
    if (turn === previewTurn) return "h-0.5 w-4 rounded-full bg-foreground/70";
    return "h-0.5 w-2 rounded-full bg-line";
  }

  function navigate(turn: number) {
    setOpen(false);
    setPreviewTurn(null);
    onNavigate(turn);
  }

  const railItems = items.slice(railRange.start, railRange.end);
  const panelItems = items.slice(panelRange.start, panelRange.end);

  return (
    <div
      className="absolute right-3 top-1/2 z-20 -translate-y-1/2"
      onPointerEnter={() => {
        pointerInside.current = true;
        setOpen(true);
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        setOpen(false);
        setPreviewTurn(null);
      }}
    >
      {open && (
        <div
          role="listbox"
          aria-label="对话时间线"
          className="absolute top-1/2 rounded-card border border-line bg-surface py-1 shadow-lg"
          style={{ right: "calc(100% + 10px)", width: "min(330px, 40vw)" }}
        >
          <div
            className="scrollbar-hidden overflow-y-auto overscroll-contain"
            style={{ height: Math.min(PANEL_VIEWPORT, panelTotal) }}
            onScroll={(e) => setPanelTop(e.currentTarget.scrollTop)}
          >
            <div className="relative" style={{ height: panelTotal }}>
              {panelItems.map((item, i) => {
                const index = panelRange.start + i;
                const highlighted =
                  item.turn === activeTurn || item.turn === previewTurn;
                return (
                  <button
                    key={item.turn}
                    type="button"
                    role="option"
                    aria-selected={item.turn === activeTurn}
                    onClick={() => navigate(item.turn)}
                    onPointerEnter={() => setPreviewTurn(item.turn)}
                    onFocus={() => setPreviewTurn(item.turn)}
                    className={`absolute left-0 flex w-full items-center gap-2 px-3 text-left text-[13px] transition-colors hover:bg-bubble ${
                      highlighted
                        ? "font-semibold text-foreground"
                        : "text-subtle"
                    }`}
                    style={{ top: INSET + index * ROW, height: ROW }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {previewText(item.prompt, 60) || `第 ${item.turn} 轮`}
                    </span>
                    <span className={`shrink-0 transition-all duration-150 ${markClass(item.turn)}`} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav aria-label="对话轮次刻度" className="w-6">
        <div
          ref={railRef}
          className="scrollbar-hidden overflow-y-auto overscroll-contain"
          style={{ height: Math.min(RAIL_VIEWPORT, railTotal) }}
          onScroll={(e) => setRailTop(e.currentTarget.scrollTop)}
        >
          <div className="relative w-6" style={{ height: railTotal }}>
            {railItems.map((item, i) => {
              const index = railRange.start + i;
              return (
                <button
                  key={item.turn}
                  type="button"
                  aria-label={`跳到第 ${item.turn} 轮`}
                  aria-current={item.turn === activeTurn ? "true" : undefined}
                  onClick={() => navigate(item.turn)}
                  onPointerEnter={() => setPreviewTurn(item.turn)}
                  onFocus={() => setPreviewTurn(item.turn)}
                  className="absolute right-0 flex h-[10px] w-6 items-center justify-end"
                  style={{ top: INSET + index * PITCH }}
                >
                  <span className={`transition-all duration-150 ${markClass(item.turn)}`} />
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
