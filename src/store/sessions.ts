import { create } from "zustand";

export type TabKind = "local" | "ssh";

export interface Tab {
  id: string;
  sessionId: string | null;
  kind: TabKind;
  title: string;
  subtitle?: string;
  busy: boolean;
  exited: boolean;
  exitCode?: number;
}

interface SessionStore {
  tabs: Tab[];
  activeId: string | null;
  addTab: (tab: Tab) => void;
  removeTab: (id: string) => void;
  setActive: (id: string) => void;
  patchTab: (id: string, patch: Partial<Tab>) => void;
}

export const useSessions = create<SessionStore>((set) => ({
  tabs: [],
  activeId: null,
  addTab: (tab) =>
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id })),
  removeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId =
        s.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeId;
      return { tabs, activeId };
    }),
  setActive: (id) => set({ activeId: id }),
  patchTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
}));
