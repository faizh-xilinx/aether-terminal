import { ipc } from "@/lib/ipc";
import { useLayout, type Direction } from "@/store/layout";
import { useSessions, type Pane, type SessionSpec, type Tab } from "@/store/sessions";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export function newPaneId(): string {
  return crypto.randomUUID();
}

export function newTabId(): string {
  return crypto.randomUUID();
}

/**
 * Opens an OS-level session for the given pane spec and patches the pane's
 * `sessionId`. Errors are surfaced as `exited`+`exitCode=-1` so the UI can
 * show a "session failed to open" placeholder rather than spinning forever.
 */
export async function spawnSessionForPane(
  paneId: string,
  spec: SessionSpec
): Promise<void> {
  const { patchPane } = useSessions.getState();
  try {
    let sessionId: string;
    if (spec.kind === "local") {
      sessionId = await ipc.openLocal(DEFAULT_COLS, DEFAULT_ROWS, spec.cwd);
    } else {
      sessionId = await ipc.openSsh({
        host: spec.host,
        port: spec.port,
        user: spec.user,
        password: spec.password,
        privateKeyPath: spec.privateKeyPath,
        privateKeyPassphrase: spec.privateKeyPassphrase,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      });
    }
    patchPane(paneId, { sessionId, busy: false });
  } catch (err) {
    console.error("session open failed", err);
    patchPane(paneId, {
      busy: false,
      exited: true,
      exitCode: -1,
      subtitle: String(err).slice(0, 200),
    });
  }
}

/** Build a starter pane for a brand new tab. */
export function buildPane(spec: SessionSpec, overrides: Partial<Pane> = {}): Pane {
  return {
    id: newPaneId(),
    sessionId: null,
    kind: spec.kind,
    title: spec.kind === "ssh" ? `${spec.user}@${spec.host}` : "local",
    subtitle: spec.kind === "ssh" ? `${spec.host}:${spec.port}` : undefined,
    busy: true,
    exited: false,
    spec,
    ...overrides,
  };
}

/** Spawn a brand new tab containing a single pane that runs `spec`. */
export async function openTabWithSpec(spec: SessionSpec): Promise<{ tab: Tab; pane: Pane }> {
  const tab: Tab = { id: newTabId(), title: spec.kind === "ssh" ? `${spec.user}@${spec.host}` : "local" };
  const pane = buildPane(spec);
  useSessions.getState().addTab(tab, pane);
  useLayout.getState().ensureTree(tab.id, pane.id);
  await spawnSessionForPane(pane.id, spec);
  return { tab, pane };
}

/**
 * Split the currently focused pane in `dir` direction. The new pane
 * duplicates the focused pane's session spec — splitting an SSH host opens
 * a second connection to the same host; splitting a local PTY opens
 * another shell with the same starting directory.
 */
export async function splitActivePane(dir: Direction): Promise<void> {
  const sessionState = useSessions.getState();
  const layoutState = useLayout.getState();
  const tabId = sessionState.activeTabId;
  if (!tabId) return;
  const sourceId = layoutState.activePane[tabId];
  if (!sourceId) return;
  const source = sessionState.panes[sourceId];
  if (!source) return;

  const newPane = buildPane(source.spec);
  sessionState.addPane(newPane);
  layoutState.splitActive(tabId, dir, newPane.id);
  await spawnSessionForPane(newPane.id, source.spec);
}

/** Close the currently active pane. Closes the tab if it was the last pane. */
export async function closeActivePane(): Promise<void> {
  const tabId = useSessions.getState().activeTabId;
  if (!tabId) return;
  const paneId = useLayout.getState().activePane[tabId];
  if (!paneId) return;
  await closePaneById(tabId, paneId);
}

export async function closePaneById(tabId: string, paneId: string): Promise<void> {
  const pane = useSessions.getState().panes[paneId];
  if (pane?.sessionId) {
    ipc.closeSession(pane.sessionId).catch(() => {});
  }

  useLayout.getState().closePane(tabId, paneId);
  useSessions.getState().removePane(paneId);

  // If the tab no longer has any panes, drop the tab too.
  const remaining = useLayout.getState().collectPanes(tabId);
  if (remaining.length === 0) {
    useSessions.getState().removeTab(tabId);
  }
}
