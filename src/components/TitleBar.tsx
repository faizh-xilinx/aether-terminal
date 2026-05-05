import { Minus, Square, X, Sparkles } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { cn } from "@/lib/cn";

const win = getCurrentWindow();

export function TitleBar() {
  return (
    <div
      className="h-9 select-none flex items-center px-3 border-b border-border bg-bg/70 backdrop-blur"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-2 pointer-events-none">
        <div className="flex items-center justify-center h-5 w-5 rounded-md bg-accent/20 text-accent">
          <Sparkles className="h-3 w-3" />
        </div>
        <span className="text-[12px] font-medium tracking-wide text-fg-muted">
          Aether
        </span>
        <span className="pill ml-2">alpha</span>
      </div>
      <div className="flex-1" data-tauri-drag-region />
      <div className="flex items-center">
        <WindowBtn onClick={() => win.minimize()} aria-label="Minimize">
          <Minus className="h-3.5 w-3.5" />
        </WindowBtn>
        <WindowBtn onClick={() => win.toggleMaximize()} aria-label="Maximize">
          <Square className="h-3 w-3" />
        </WindowBtn>
        <WindowBtn
          onClick={() => win.close()}
          aria-label="Close"
          className="hover:bg-danger/30"
        >
          <X className="h-3.5 w-3.5" />
        </WindowBtn>
      </div>
    </div>
  );
}

function WindowBtn({
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cn(
        "h-9 w-11 flex items-center justify-center text-fg-muted hover:bg-bg-elevated hover:text-fg",
        className
      )}
    />
  );
}
