import { beforeEach, describe, expect, it } from "vitest";

import { useSessions, type Pane, type Tab } from "@/store/sessions";

function makeTab(id: string, title = id): Tab {
  return { id, title };
}
function makePane(id: string, sessionId: string | null = null): Pane {
  return {
    id,
    sessionId,
    kind: "local",
    title: "local",
    busy: false,
    exited: false,
    spec: { kind: "local" },
  };
}

beforeEach(() => useSessions.setState({ tabs: [], panes: {}, activeTabId: null }));

describe("sessions store", () => {
  it("addTab seeds the tab + initial pane and sets the active tab", () => {
    useSessions.getState().addTab(makeTab("t1"), makePane("p1", "sid-1"));
    const s = useSessions.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe("t1");
    expect(s.panes["p1"]?.sessionId).toBe("sid-1");
  });

  it("removeTab pops the tab and rebases activeTabId", () => {
    const s = useSessions.getState();
    s.addTab(makeTab("t1"), makePane("p1"));
    s.addTab(makeTab("t2"), makePane("p2"));
    s.addTab(makeTab("t3"), makePane("p3"));
    s.removeTab("t2");
    expect(useSessions.getState().tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(useSessions.getState().activeTabId).toBe("t3"); // unchanged
    s.removeTab("t3"); // removes the active one — should fall back
    expect(useSessions.getState().activeTabId).toBe("t1");
  });

  it("removeTab on the only tab nulls the active id", () => {
    const s = useSessions.getState();
    s.addTab(makeTab("only"), makePane("p"));
    s.removeTab("only");
    expect(useSessions.getState().activeTabId).toBeNull();
  });

  it("patchPane merges fields and ignores unknown ids", () => {
    const s = useSessions.getState();
    s.addTab(makeTab("t1"), makePane("p1"));
    s.patchPane("p1", { busy: true, title: "renamed" });
    expect(useSessions.getState().panes["p1"]?.busy).toBe(true);
    expect(useSessions.getState().panes["p1"]?.title).toBe("renamed");
    // Unknown pane id is a silent no-op.
    s.patchPane("nope", { busy: true });
    expect(useSessions.getState().panes["nope"]).toBeUndefined();
  });

  it("removePane drops the pane from the map without touching tabs", () => {
    const s = useSessions.getState();
    s.addTab(makeTab("t1"), makePane("p1"));
    s.addPane(makePane("p2"));
    s.removePane("p1");
    expect(useSessions.getState().panes["p1"]).toBeUndefined();
    expect(useSessions.getState().panes["p2"]).toBeDefined();
    expect(useSessions.getState().tabs).toHaveLength(1); // tabs untouched
  });

  it("setTabTitle is a partial update, doesn't disturb active or other tabs", () => {
    const s = useSessions.getState();
    s.addTab(makeTab("t1", "first"), makePane("p1"));
    s.addTab(makeTab("t2", "second"), makePane("p2"));
    s.setTabTitle("t1", "renamed");
    expect(useSessions.getState().tabs.find((t) => t.id === "t1")?.title).toBe("renamed");
    expect(useSessions.getState().tabs.find((t) => t.id === "t2")?.title).toBe("second");
    expect(useSessions.getState().activeTabId).toBe("t2");
  });

  it("getPane returns undefined for unknown ids", () => {
    expect(useSessions.getState().getPane("nope")).toBeUndefined();
  });
});
