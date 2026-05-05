import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { useLayout, type Layout } from "@/store/layout";

interface Props {
  tabId: string;
  layout: Layout;
  path: number[];
  renderPane: (paneId: string, isActive: boolean) => React.ReactNode;
}

export function SplitPane({ tabId, layout, path, renderPane }: Props) {
  const setRatio = useLayout((s) => s.setRatio);
  const setActivePane = useLayout((s) => s.setActivePane);
  const activePaneId = useLayout((s) => s.activePane[tabId]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el || layout.kind !== "split") return;
      const rect = el.getBoundingClientRect();
      const ratio =
        layout.dir === "h"
          ? (e.clientX - rect.left) / rect.width
          : (e.clientY - rect.top) / rect.height;
      setRatio(tabId, path, ratio);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, layout, path, setRatio, tabId]);

  if (layout.kind === "leaf") {
    return (
      <div
        onMouseDown={() => setActivePane(tabId, layout.paneId)}
        className={cn(
          "relative h-full w-full",
          "ring-0 transition-shadow",
          activePaneId === layout.paneId &&
            "ring-1 ring-accent/40 ring-inset"
        )}
      >
        {renderPane(layout.paneId, activePaneId === layout.paneId)}
      </div>
    );
  }

  const isHorizontal = layout.dir === "h";
  const aSize = `${layout.ratio * 100}%`;
  const bSize = `${(1 - layout.ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full flex",
        isHorizontal ? "flex-row" : "flex-col"
      )}
    >
      <div style={isHorizontal ? { width: aSize } : { height: aSize }}>
        <SplitPane
          tabId={tabId}
          layout={layout.a}
          path={[...path, 0]}
          renderPane={renderPane}
        />
      </div>
      <div
        onMouseDown={() => setDragging(true)}
        className={cn(
          "relative shrink-0 z-10 group",
          isHorizontal
            ? "w-px hover:w-1 cursor-col-resize"
            : "h-px hover:h-1 cursor-row-resize",
          "bg-border hover:bg-accent/40 transition-all"
        )}
      >
        <div
          className={cn(
            "absolute",
            isHorizontal
              ? "inset-y-0 -left-1 -right-1"
              : "inset-x-0 -top-1 -bottom-1"
          )}
        />
      </div>
      <div style={isHorizontal ? { width: bSize } : { height: bSize }}>
        <SplitPane
          tabId={tabId}
          layout={layout.b}
          path={[...path, 1]}
          renderPane={renderPane}
        />
      </div>
    </div>
  );
}
