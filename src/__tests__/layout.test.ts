import { beforeEach, describe, expect, it } from "vitest";

import { useLayout } from "@/store/layout";

const TAB = "tab-1";

function reset() {
  useLayout.setState({ trees: {}, activePane: {} });
}

beforeEach(reset);

describe("layout store", () => {
  it("ensureTree seeds a leaf and sets active pane", () => {
    useLayout.getState().ensureTree(TAB, "p1");
    const tree = useLayout.getState().trees[TAB];
    expect(tree).toEqual({ kind: "leaf", paneId: "p1", tabId: TAB });
    expect(useLayout.getState().activePane[TAB]).toBe("p1");
  });

  it("ensureTree is idempotent — second call is a no-op", () => {
    useLayout.getState().ensureTree(TAB, "p1");
    useLayout.getState().ensureTree(TAB, "p2"); // should NOT replace p1
    expect(useLayout.getState().trees[TAB]).toMatchObject({ paneId: "p1" });
    expect(useLayout.getState().activePane[TAB]).toBe("p1");
  });

  it("splitActive horizontally produces a 50/50 split", () => {
    useLayout.getState().ensureTree(TAB, "p1");
    useLayout.getState().splitActive(TAB, "h", "p2");
    const tree = useLayout.getState().trees[TAB]!;
    expect(tree.kind).toBe("split");
    if (tree.kind !== "split") throw new Error("unreachable");
    expect(tree.dir).toBe("h");
    expect(tree.ratio).toBe(0.5);
    expect((tree.a as { paneId: string }).paneId).toBe("p1");
    expect((tree.b as { paneId: string }).paneId).toBe("p2");
    // Active pane should follow the freshly-spawned pane.
    expect(useLayout.getState().activePane[TAB]).toBe("p2");
  });

  it("splitActive vertically nests on the active leaf, not the root", () => {
    useLayout.getState().ensureTree(TAB, "p1");
    useLayout.getState().splitActive(TAB, "h", "p2"); // root: split(p1, p2)
    useLayout.getState().splitActive(TAB, "v", "p3"); // active=p2 -> split p2 vertically

    const tree = useLayout.getState().trees[TAB]!;
    if (tree.kind !== "split") throw new Error("expected split");
    expect(tree.dir).toBe("h");
    if (tree.b.kind !== "split") throw new Error("expected nested split on right side");
    expect(tree.b.dir).toBe("v");
    expect(useLayout.getState().activePane[TAB]).toBe("p3");
  });

  it("setRatio clamps to [0.1, 0.9]", () => {
    useLayout.getState().ensureTree(TAB, "p1");
    useLayout.getState().splitActive(TAB, "h", "p2");

    useLayout.getState().setRatio(TAB, [], 0.05); // way below floor
    let tree = useLayout.getState().trees[TAB]!;
    if (tree.kind !== "split") throw new Error("");
    expect(tree.ratio).toBe(0.1);

    useLayout.getState().setRatio(TAB, [], 1.5); // way above ceiling
    tree = useLayout.getState().trees[TAB]!;
    if (tree.kind !== "split") throw new Error("");
    expect(tree.ratio).toBe(0.9);
  });

  it("closePane removes a leaf and collapses the parent split", () => {
    useLayout.getState().ensureTree(TAB, "p1");
    useLayout.getState().splitActive(TAB, "h", "p2");
    useLayout.getState().closePane(TAB, "p2");

    const tree = useLayout.getState().trees[TAB]!;
    expect(tree.kind).toBe("leaf");
    if (tree.kind !== "leaf") throw new Error("");
    expect(tree.paneId).toBe("p1");
    expect(useLayout.getState().activePane[TAB]).toBe("p1");
  });

  it("closing the last pane drops the tab from the store", () => {
    useLayout.getState().ensureTree(TAB, "only");
    useLayout.getState().closePane(TAB, "only");
    expect(useLayout.getState().trees[TAB]).toBeUndefined();
    expect(useLayout.getState().activePane[TAB]).toBeUndefined();
  });

  it("collectPanes lists every leaf in left-to-right order", () => {
    useLayout.getState().ensureTree(TAB, "p1");
    useLayout.getState().splitActive(TAB, "h", "p2");
    useLayout.getState().splitActive(TAB, "v", "p3"); // splits p2 -> p2/p3
    expect(useLayout.getState().collectPanes(TAB)).toEqual(["p1", "p2", "p3"]);
  });

  it("setActivePane is independent of layout shape", () => {
    useLayout.getState().ensureTree(TAB, "p1");
    useLayout.getState().splitActive(TAB, "h", "p2");
    useLayout.getState().setActivePane(TAB, "p1");
    expect(useLayout.getState().activePane[TAB]).toBe("p1");
  });

  it("collectPanes returns empty for an unknown tab", () => {
    expect(useLayout.getState().collectPanes("does-not-exist")).toEqual([]);
  });

  it("split with unknown active pane is a no-op (no crash, no mutation)", () => {
    useLayout.getState().ensureTree(TAB, "p1");
    useLayout.getState().setActivePane(TAB, "ghost");
    useLayout.getState().splitActive(TAB, "h", "p2");
    expect(useLayout.getState().trees[TAB]).toMatchObject({ paneId: "p1" });
  });
});
