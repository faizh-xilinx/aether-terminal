import { Plus, X, Server, Terminal as TermIcon, Loader2, Columns2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { useSessions } from "@/store/sessions";
import { useLayout } from "@/store/layout";
import { useUI } from "@/store/ui";
import { closePaneById, openTabWithSpec, splitActivePane } from "@/lib/panes";

export function TabBar() {
  const tabs = useSessions((s) => s.tabs);
  const activeTabId = useSessions((s) => s.activeTabId);
  const panes = useSessions((s) => s.panes);
  const setActiveTab = useSessions((s) => s.setActiveTab);
  const trees = useLayout((s) => s.trees);
  const toggleConnect = useUI((s) => s.toggleConnect);

  const newLocal = () => {
    openTabWithSpec({ kind: "local" }).catch(() => {});
  };

  const closeTab = (tabId: string) => {
    const tree = useLayout.getState().trees[tabId];
    if (!tree) return;
    const paneIds = useLayout.getState().collectPanes(tabId);
    paneIds.forEach((pid) => closePaneById(tabId, pid).catch(() => {}));
  };

  return (
    <div className="h-10 flex items-center border-b border-border bg-bg/50 px-2 gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const paneIds = trees[tab.id]
          ? useLayout.getState().collectPanes(tab.id)
          : [];
        const tabPanes = paneIds
          .map((pid) => panes[pid])
          .filter((p): p is NonNullable<typeof p> => Boolean(p));
        const anyBusy = tabPanes.some((p) => p.busy);
        const allExited = tabPanes.length > 0 && tabPanes.every((p) => p.exited);
        const anySsh = tabPanes.some((p) => p.kind === "ssh");
        const split = tabPanes.length > 1;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
            className={cn(
              "group relative flex items-center gap-2 h-7 pl-2 pr-1 rounded-md",
              "text-[12px] text-fg-muted hover:text-fg transition-colors max-w-[220px]",
              tab.id === activeTabId
                ? "bg-bg-elevated text-fg shadow-sm"
                : "hover:bg-bg-subtle"
            )}
          >
            {anyBusy ? (
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
            ) : anySsh ? (
              <Server className="h-3 w-3 shrink-0 text-accent" />
            ) : (
              <TermIcon className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">{tab.title}</span>
            {split && (
              <span title={`${tabPanes.length} panes`} className="pill !py-0 !text-[9px] !px-1.5">
                <Columns2 className="h-2.5 w-2.5" />
                {tabPanes.length}
              </span>
            )}
            {allExited && <span className="pill !py-0 !text-[9px]">exited</span>}
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="ml-1 h-4 w-4 inline-flex items-center justify-center rounded
                         text-fg-subtle hover:text-fg hover:bg-bg/80 opacity-0
                         group-hover:opacity-100 transition-opacity"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        );
      })}
      <div className="flex items-center gap-1 ml-1">
        <button
          onClick={newLocal}
          title="New local terminal (Ctrl+T)"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md
                     text-fg-muted hover:text-fg hover:bg-bg-elevated"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => toggleConnect(true)}
          title="Quick connect (Ctrl+K)"
          className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md
                     text-[12px] text-fg-muted hover:text-fg hover:bg-bg-elevated"
        >
          <Server className="h-3.5 w-3.5" /> SSH
          <span className="kbd">⌘K</span>
        </button>
        <span className="w-px h-4 bg-border mx-1" />
        <button
          onClick={() => splitActivePane("h").catch(() => {})}
          title="Split right (Ctrl+\\)"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md
                     text-fg-muted hover:text-fg hover:bg-bg-elevated"
        >
          <Columns2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => splitActivePane("v").catch(() => {})}
          title="Split down (Ctrl+Shift+\\)"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md
                     text-fg-muted hover:text-fg hover:bg-bg-elevated rotate-90"
        >
          <Columns2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
