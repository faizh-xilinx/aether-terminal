import { create } from "zustand";

export type PaneKind = "local" | "ssh";

/**
 * Everything needed to (re)open a session of this kind. Carried on each pane
 * so split-pane operations can spawn an equivalent sibling without prompting
 * the user again — duplicating an SSH connection should feel instantaneous.
 */
export type SessionSpec =
  | { kind: "local"; cwd?: string }
  | {
      kind: "ssh";
      host: string;
      port: number;
      user: string;
      password?: string;
      privateKeyPath?: string;
      privateKeyPassphrase?: string;
    };

export interface Pane {
  id: string;
  sessionId: string | null;
  kind: PaneKind;
  title: string;
  subtitle?: string;
  busy: boolean;
  exited: boolean;
  exitCode?: number;
  spec: SessionSpec;
}

export interface Tab {
  id: string;
  title: string;
}

interface SessionStore {
  tabs: Tab[];
  panes: Record<string, Pane>;
  activeTabId: string | null;

  addTab: (tab: Tab, initialPane: Pane) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setTabTitle: (tabId: string, title: string) => void;

  addPane: (pane: Pane) => void;
  patchPane: (id: string, patch: Partial<Pane>) => void;
  removePane: (id: string) => void;
  getPane: (id: string) => Pane | undefined;
}

export const useSessions = create<SessionStore>((set, get) => ({
  tabs: [],
  panes: {},
  activeTabId: null,

  addTab: (tab, initialPane) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      panes: { ...s.panes, [initialPane.id]: initialPane },
    })),

  removeTab: (tabId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      const activeTabId =
        s.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : s.activeTabId;
      // Pane cleanup is handled by callers via `removePane` on each pane in
      // the tab's layout tree, so the store doesn't need to know about the
      // tree structure here.
      return { tabs, activeTabId };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  setTabTitle: (tabId, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    })),

  addPane: (pane) =>
    set((s) => ({ panes: { ...s.panes, [pane.id]: pane } })),

  patchPane: (id, patch) =>
    set((s) => {
      const existing = s.panes[id];
      if (!existing) return s;
      return { panes: { ...s.panes, [id]: { ...existing, ...patch } } };
    }),

  removePane: (id) =>
    set((s) => {
      if (!s.panes[id]) return s;
      const next = { ...s.panes };
      delete next[id];
      return { panes: next };
    }),

  getPane: (id) => get().panes[id],
}));
