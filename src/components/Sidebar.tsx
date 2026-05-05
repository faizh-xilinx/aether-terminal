import {
  TerminalSquare,
  Globe,
  KeyRound,
  Settings,
  Bot,
  Search,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { useUI } from "@/store/ui";

export function Sidebar() {
  const togglePalette = useUI((s) => s.togglePalette);
  const toggleConnect = useUI((s) => s.toggleConnect);
  const toggleAi = useUI((s) => s.toggleAi);
  const aiOpen = useUI((s) => s.aiOpen);

  return (
    <aside className="w-12 shrink-0 flex flex-col items-center justify-between py-2 border-r border-border bg-bg/40">
      <div className="flex flex-col items-center gap-1">
        <SideBtn label="Quick connect" onClick={() => toggleConnect()}>
          <Globe className="h-4 w-4" />
        </SideBtn>
        <SideBtn label="Sessions" onClick={() => togglePalette()}>
          <TerminalSquare className="h-4 w-4" />
        </SideBtn>
        <SideBtn label="Search">
          <Search className="h-4 w-4" />
        </SideBtn>
        <SideBtn label="Vault">
          <KeyRound className="h-4 w-4" />
        </SideBtn>
      </div>
      <div className="flex flex-col items-center gap-1">
        <SideBtn
          label="AI"
          active={aiOpen}
          onClick={() => toggleAi()}
        >
          <Bot className="h-4 w-4" />
        </SideBtn>
        <SideBtn label="Settings">
          <Settings className="h-4 w-4" />
        </SideBtn>
      </div>
    </aside>
  );
}

interface SideBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

function SideBtn({ label, active, className, children, ...rest }: SideBtnProps) {
  return (
    <button
      {...rest}
      title={label}
      className={cn(
        "h-9 w-9 flex items-center justify-center rounded-lg",
        "text-fg-muted hover:text-fg hover:bg-bg-elevated transition-colors",
        active && "bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent",
        className
      )}
    >
      {children}
    </button>
  );
}
