import { useEffect } from "react";

import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { TabBar } from "@/components/TabBar";
import { TerminalView } from "@/components/Terminal";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickConnect } from "@/components/QuickConnect";
import { AISidebar } from "@/components/AISidebar";
import { useSessions } from "@/store/sessions";
import { useUI } from "@/store/ui";
import { ipc } from "@/lib/ipc";

export default function App() {
  const tabs = useSessions((s) => s.tabs);
  const activeId = useSessions((s) => s.activeId);
  const addTab = useSessions((s) => s.addTab);
  const patchTab = useSessions((s) => s.patchTab);
  const aiOpen = useUI((s) => s.aiOpen);
  const togglePalette = useUI((s) => s.togglePalette);
  const toggleConnect = useUI((s) => s.toggleConnect);
  const toggleAi = useUI((s) => s.toggleAi);

  useEffect(() => {
    if (tabs.length === 0) {
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
        .then((sessionId) => patchTab(tabId, { sessionId, busy: false }))
        .catch((err) => {
          console.error("failed to open local session", err);
          patchTab(tabId, { busy: false, exited: true });
        });
    }
  }, [tabs.length, addTab, patchTab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "p" && e.shiftKey) {
        e.preventDefault();
        togglePalette();
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleConnect();
      } else if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        toggleAi();
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
              {tabs.map((tab) => (
                <TerminalView
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeId}
                />
              ))}
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
    </div>
  );
}
