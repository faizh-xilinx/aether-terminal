import { Command } from "cmdk";
import { useEffect } from "react";
import {
  Plus,
  Server,
  Palette,
  Bot,
  Search,
  KeyRound,
  Settings as Cog,
  LogIn,
  LogOut,
} from "lucide-react";

import { useUI } from "@/store/ui";
import { useSessions } from "@/store/sessions";
import { useAuth } from "@/store/auth";
import { THEMES } from "@/lib/themes";
import { ipc } from "@/lib/ipc";

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const togglePalette = useUI((s) => s.togglePalette);
  const toggleConnect = useUI((s) => s.toggleConnect);
  const toggleAi = useUI((s) => s.toggleAi);
  const toggleAuth = useUI((s) => s.toggleAuth);
  const setTheme = useUI((s) => s.setTheme);
  const addTab = useSessions((s) => s.addTab);
  const patchTab = useSessions((s) => s.patchTab);
  const authStatus = useAuth((s) => s.status);
  const forgetAuth = useAuth((s) => s.forget);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        togglePalette(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, togglePalette]);

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
    togglePalette(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={() => togglePalette(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl glass rounded-xl shadow-panel overflow-hidden animate-slide-up"
      >
        <Command label="Aether commands" className="flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Search className="h-4 w-4 text-fg-subtle" />
            <Command.Input
              autoFocus
              placeholder="Run a command, switch a session…"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-fg-subtle"
            />
            <span className="kbd">esc</span>
          </div>
          <Command.List className="max-h-[50vh] overflow-y-auto p-1">
            <Command.Empty className="px-4 py-6 text-center text-fg-subtle text-sm">
              No matching commands
            </Command.Empty>
            <Command.Group heading="Sessions" className="ae-group">
              <Item icon={<Plus className="h-4 w-4" />} onSelect={newLocal} kbd="⌘T">
                New local terminal
              </Item>
              <Item
                icon={<Server className="h-4 w-4" />}
                onSelect={() => {
                  togglePalette(false);
                  toggleConnect(true);
                }}
                kbd="⌘K"
              >
                Connect via SSH…
              </Item>
            </Command.Group>
            <Command.Group heading="AI">
              <Item
                icon={<Bot className="h-4 w-4" />}
                onSelect={() => {
                  togglePalette(false);
                  toggleAi();
                }}
                kbd="⌘I"
              >
                Toggle AI sidebar
              </Item>
              {authStatus?.authenticated ? (
                <Item
                  icon={<LogOut className="h-4 w-4" />}
                  onSelect={() => {
                    togglePalette(false);
                    forgetAuth();
                  }}
                >
                  Sign out of Cursor{authStatus.user ? ` (${authStatus.user})` : ""}
                </Item>
              ) : (
                <Item
                  icon={<LogIn className="h-4 w-4" />}
                  onSelect={() => {
                    togglePalette(false);
                    toggleAuth(true);
                  }}
                >
                  Sign in to Cursor with email
                </Item>
              )}
            </Command.Group>
            <Command.Group heading="Theme">
              {THEMES.map((t) => (
                <Item
                  key={t.id}
                  icon={<Palette className="h-4 w-4" />}
                  onSelect={() => {
                    setTheme(t.id);
                    togglePalette(false);
                  }}
                >
                  Use theme: {t.name}
                </Item>
              ))}
            </Command.Group>
            <Command.Group heading="Vault & settings">
              <Item icon={<KeyRound className="h-4 w-4" />}>
                Open credential vault
              </Item>
              <Item icon={<Cog className="h-4 w-4" />}>Open settings</Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function Item({
  icon,
  children,
  kbd,
  onSelect,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  kbd?: string;
  onSelect?: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-fg-muted
                 aria-selected:bg-bg-elevated aria-selected:text-fg cursor-pointer"
    >
      <span className="text-fg-subtle">{icon}</span>
      <span className="flex-1">{children}</span>
      {kbd && <span className="kbd">{kbd}</span>}
    </Command.Item>
  );
}
