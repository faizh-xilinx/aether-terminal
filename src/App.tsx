import { useEffect } from "react";

import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { TabBar } from "@/components/TabBar";
import { TerminalView } from "@/components/Terminal";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickConnect } from "@/components/QuickConnect";
import { AISidebar } from "@/components/AISidebar";
import { AuthDialog } from "@/components/AuthDialog";
import { SplitPane } from "@/components/SplitPane";
import { useSessions } from "@/store/sessions";
import { useLayout } from "@/store/layout";
import { useUI } from "@/store/ui";
import { useAuth } from "@/store/auth";
import { cn } from "@/lib/cn";
import {
  closeActivePane,
  openTabWithSpec,
  splitActivePane,
} from "@/lib/panes";

export default function App() {
  const tabs = useSessions((s) => s.tabs);
  const activeTabId = useSessions((s) => s.activeTabId);
  const panes = useSessions((s) => s.panes);
  const trees = useLayout((s) => s.trees);
  const aiOpen = useUI((s) => s.aiOpen);
  const authOpen = useUI((s) => s.authOpen);
  const togglePalette = useUI((s) => s.togglePalette);
  const toggleConnect = useUI((s) => s.toggleConnect);
  const toggleAi = useUI((s) => s.toggleAi);
  const toggleAuth = useUI((s) => s.toggleAuth);
  const refreshAuth = useAuth((s) => s.refresh);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (tabs.length === 0) {
      openTabWithSpec({ kind: "local" }).catch((err) =>
        console.error("could not open initial local tab", err)
      );
    }
  }, [tabs.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      // Mod + Shift + P → command palette
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        togglePalette();
        return;
      }
      // Mod + K → quick connect
      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleConnect();
        return;
      }
      // Mod + I → toggle AI sidebar
      if (mod && !e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        toggleAi();
        return;
      }
      // Mod + \  → split right (vertical divider)
      // Mod + Shift + \ → split down (horizontal divider)
      if (mod && (e.key === "\\" || e.code === "Backslash")) {
        e.preventDefault();
        splitActivePane(e.shiftKey ? "v" : "h").catch((err) =>
          console.error("split failed", err)
        );
        return;
      }
      // Mod + Shift + W → close active pane
      if (mod && e.shiftKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        closeActivePane().catch(() => {});
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette, toggleConnect, toggleAi]);

  return (
    <div className="aether-body flex flex-col h-screen w-screen">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex flex-1 flex-col min-w-0">
          <TabBar />
          <div className="flex flex-1 min-h-0">
            <div className="flex-1 min-w-0 relative">
              {tabs.map((tab) => {
                const tree = trees[tab.id];
                if (!tree) return null;
                return (
                  <div
                    key={tab.id}
                    className={cn(
                      "absolute inset-0",
                      tab.id === activeTabId
                        ? "visible z-10"
                        : "invisible -z-10 pointer-events-none"
                    )}
                  >
                    <SplitPane
                      tabId={tab.id}
                      layout={tree}
                      path={[]}
                      renderPane={(paneId, isActive) => {
                        const pane = panes[paneId];
                        return pane ? (
                          <TerminalView pane={pane} active={isActive} />
                        ) : null;
                      }}
                    />
                  </div>
                );
              })}
              {tabs.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-fg-subtle">
                  No active sessions
                </div>
              )}
            </div>
            {aiOpen && <AISidebar />}
          </div>
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <QuickConnect />
      <AuthDialog open={authOpen} onOpenChange={(o) => toggleAuth(o)} />
    </div>
  );
}
