import { create } from "zustand";

export type PaneId = string;
export type Direction = "h" | "v";

export type Layout =
  | { kind: "leaf"; paneId: PaneId; tabId: string }
  | { kind: "split"; dir: Direction; ratio: number; a: Layout; b: Layout };

interface LayoutStore {
  /** Map<tabId, Layout>. Each tab gets its own pane tree. */
  trees: Record<string, Layout>;
  /** Currently focused pane within each tab. */
  activePane: Record<string, PaneId>;

  ensureTree: (tabId: string, initialPaneId: PaneId) => void;
  splitActive: (tabId: string, dir: Direction, newPaneId: PaneId) => void;
  closePane: (tabId: string, paneId: PaneId) => void;
  setActivePane: (tabId: string, paneId: PaneId) => void;
  setRatio: (tabId: string, path: number[], ratio: number) => void;
  collectPanes: (tabId: string) => PaneId[];
}

function leaf(paneId: PaneId, tabId: string): Layout {
  return { kind: "leaf", paneId, tabId };
}

function setRatioAt(layout: Layout, path: number[], ratio: number): Layout {
  if (path.length === 0 || layout.kind !== "split") return layout;
  const [head, ...rest] = path;
  if (head === undefined) return layout;
  if (rest.length === 0) {
    return { ...layout, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
  }
  if (head === 0)
    return { ...layout, a: setRatioAt(layout.a, rest, ratio) };
  return { ...layout, b: setRatioAt(layout.b, rest, ratio) };
}

function findActiveLeaf(layout: Layout, paneId: PaneId): boolean {
  if (layout.kind === "leaf") return layout.paneId === paneId;
  return findActiveLeaf(layout.a, paneId) || findActiveLeaf(layout.b, paneId);
}

function splitAt(
  layout: Layout,
  paneId: PaneId,
  dir: Direction,
  newPaneId: PaneId,
  tabId: string
): Layout {
  if (layout.kind === "leaf") {
    if (layout.paneId !== paneId) return layout;
    return {
      kind: "split",
      dir,
      ratio: 0.5,
      a: layout,
      b: leaf(newPaneId, tabId),
    };
  }
  return {
    ...layout,
    a: splitAt(layout.a, paneId, dir, newPaneId, tabId),
    b: splitAt(layout.b, paneId, dir, newPaneId, tabId),
  };
}

function removeAt(layout: Layout, paneId: PaneId): Layout | null {
  if (layout.kind === "leaf") {
    return layout.paneId === paneId ? null : layout;
  }
  const a = removeAt(layout.a, paneId);
  const b = removeAt(layout.b, paneId);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return { ...layout, a, b };
}

function collect(layout: Layout): PaneId[] {
  if (layout.kind === "leaf") return [layout.paneId];
  return [...collect(layout.a), ...collect(layout.b)];
}

export const useLayout = create<LayoutStore>((set, get) => ({
  trees: {},
  activePane: {},

  ensureTree: (tabId, initialPaneId) =>
    set((s) => {
      if (s.trees[tabId]) return s;
      return {
        trees: { ...s.trees, [tabId]: leaf(initialPaneId, tabId) },
        activePane: { ...s.activePane, [tabId]: initialPaneId },
      };
    }),

  splitActive: (tabId, dir, newPaneId) =>
    set((s) => {
      const tree = s.trees[tabId];
      if (!tree) return s;
      const active = s.activePane[tabId];
      if (!active || !findActiveLeaf(tree, active)) return s;
      return {
        trees: {
          ...s.trees,
          [tabId]: splitAt(tree, active, dir, newPaneId, tabId),
        },
        activePane: { ...s.activePane, [tabId]: newPaneId },
      };
    }),

  closePane: (tabId, paneId) =>
    set((s) => {
      const tree = s.trees[tabId];
      if (!tree) return s;
      const next = removeAt(tree, paneId);
      const trees = { ...s.trees };
      const activePane = { ...s.activePane };
      if (next === null) {
        delete trees[tabId];
        delete activePane[tabId];
      } else {
        trees[tabId] = next;
        if (activePane[tabId] === paneId) {
          activePane[tabId] = collect(next)[0] ?? "";
        }
      }
      return { trees, activePane };
    }),

  setActivePane: (tabId, paneId) =>
    set((s) => ({ activePane: { ...s.activePane, [tabId]: paneId } })),

  setRatio: (tabId, path, ratio) =>
    set((s) => {
      const tree = s.trees[tabId];
      if (!tree) return s;
      return { trees: { ...s.trees, [tabId]: setRatioAt(tree, path, ratio) } };
    }),

  collectPanes: (tabId) => {
    const tree = get().trees[tabId];
    return tree ? collect(tree) : [];
  },
}));
