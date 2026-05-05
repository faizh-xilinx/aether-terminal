import { useEffect, useState } from "react";
import { Sparkles, GitBranch, Wifi } from "lucide-react";

import { ipc } from "@/lib/ipc";
import { useSessions } from "@/store/sessions";

export function StatusBar() {
  const tabs = useSessions((s) => s.tabs);
  const activeId = useSessions((s) => s.activeId);
  const active = tabs.find((t) => t.id === activeId);
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    ipc.appVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <footer className="h-6 shrink-0 flex items-center px-3 gap-3 border-t border-border bg-bg/60 text-[11px] text-fg-muted">
      <span className="flex items-center gap-1">
        <Wifi className="h-3 w-3" />
        {active?.kind === "ssh" ? active.subtitle ?? "ssh" : "local"}
      </span>
      <span className="flex items-center gap-1">
        <GitBranch className="h-3 w-3" />
        main
      </span>
      <span className="flex-1" />
      <span className="flex items-center gap-1">
        <Sparkles className="h-3 w-3 text-accent" />
        Cursor · composer-2
      </span>
      <span>v{version}</span>
    </footer>
  );
}
