import { Plus, X, Server, Terminal as TermIcon, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { useSessions } from "@/store/sessions";
import { useUI } from "@/store/ui";
import { ipc } from "@/lib/ipc";

export function TabBar() {
  const tabs = useSessions((s) => s.tabs);
  const activeId = useSessions((s) => s.activeId);
  const setActive = useSessions((s) => s.setActive);
  const removeTab = useSessions((s) => s.removeTab);
  const addTab = useSessions((s) => s.addTab);
  const patchTab = useSessions((s) => s.patchTab);
  const toggleConnect = useUI((s) => s.toggleConnect);

  const newLocal = () => {
    const tabId = crypto.randomUUID();
    addTab({
      id: tabId,
      sessionId: null,
      kind: "local",
      title: "local",
      busy: true,
      exited: false,
    });
    ipc
      .openLocal(80, 24)
      .then((sid) => patchTab(tabId, { sessionId: sid, busy: false }))
      .catch(() => patchTab(tabId, { busy: false, exited: true }));
  };

  const close = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (tab?.sessionId) ipc.closeSession(tab.sessionId).catch(() => {});
    removeTab(id);
  };

  return (
    <div className="h-10 flex items-center border-b border-border bg-bg/50 px-2 gap-1 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setActive(t.id)}
          onAuxClick={(e) => e.button === 1 && close(t.id)}
          className={cn(
            "group relative flex items-center gap-2 h-7 pl-2 pr-1 rounded-md",
            "text-[12px] text-fg-muted hover:text-fg transition-colors max-w-[200px]",
            t.id === activeId
              ? "bg-bg-elevated text-fg shadow-sm"
              : "hover:bg-bg-subtle"
          )}
        >
          {t.busy ? (
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          ) : t.kind === "ssh" ? (
            <Server className="h-3 w-3 shrink-0 text-accent" />
          ) : (
            <TermIcon className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{t.title}</span>
          {t.exited && <span className="pill !py-0 !text-[9px]">exited</span>}
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              close(t.id);
            }}
            className="ml-1 h-4 w-4 inline-flex items-center justify-center rounded
                       text-fg-subtle hover:text-fg hover:bg-bg/80 opacity-0
                       group-hover:opacity-100 transition-opacity"
          >
            <X className="h-3 w-3" />
          </span>
        </button>
      ))}
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
      </div>
    </div>
  );
}
