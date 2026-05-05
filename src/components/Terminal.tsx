import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";

import { ipc } from "@/lib/ipc";
import { useUI } from "@/store/ui";
import { useSessions, type Pane } from "@/store/sessions";
import { cn } from "@/lib/cn";

interface Props {
  pane: Pane;
  active: boolean;
}

export function TerminalView({ pane, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const theme = useUI((s) => s.theme);
  const patchPane = useSessions((s) => s.patchPane);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: "JetBrains Mono, MonoLisa, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      allowProposedApi: true,
      scrollback: 10000,
      fontWeight: "400",
      fontWeightBold: "600",
      smoothScrollDuration: 80,
      theme: theme.xterm,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();

    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";

    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
    } catch {
      // GPU unavailable; fall back to canvas/dom renderer.
    }

    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (pane.sessionId) {
          ipc.resizeSession(pane.sessionId, term.cols, term.rows).catch(() => {});
        }
      } catch {
        // size 0 during layout transitions, ignore.
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = theme.xterm;
    }
  }, [theme]);

  useEffect(() => {
    if (!pane.sessionId || !termRef.current) return;
    const term = termRef.current;

    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    ipc
      .onSessionData(pane.sessionId, (chunk) => term.write(chunk))
      .then((un) => {
        unlistenData = un;
      });
    ipc
      .onSessionExit(pane.sessionId, (code) => {
        patchPane(pane.id, { exited: true, exitCode: code });
        term.write(`\r\n\x1b[2;90m[process exited with code ${code}]\x1b[0m\r\n`);
      })
      .then((un) => {
        unlistenExit = un;
      });

    const onData = term.onData((data) => {
      if (pane.sessionId) ipc.writeSession(pane.sessionId, data).catch(() => {});
    });

    const sizeOnce = () => {
      if (!fitRef.current || !pane.sessionId) return;
      try {
        fitRef.current.fit();
        ipc.resizeSession(pane.sessionId, term.cols, term.rows).catch(() => {});
      } catch {
        // ignore
      }
    };
    sizeOnce();

    return () => {
      onData.dispose();
      unlistenData?.();
      unlistenExit?.();
    };
  }, [pane.sessionId, pane.id, patchPane]);

  useEffect(() => {
    if (active && termRef.current) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
          termRef.current?.focus();
        } catch {
          // ignore
        }
      });
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={cn("h-full w-full", active ? "" : "opacity-95")}
    />
  );
}
