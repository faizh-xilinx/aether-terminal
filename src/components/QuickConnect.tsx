import { useEffect, useState } from "react";
import { Server, KeyRound, User, ChevronRight } from "lucide-react";

import { useUI } from "@/store/ui";
import { useSessions } from "@/store/sessions";
import { ipc, type HostEntry } from "@/lib/ipc";
import { cn } from "@/lib/cn";

export function QuickConnect() {
  const open = useUI((s) => s.connectOpen);
  const toggle = useUI((s) => s.toggleConnect);
  const addTab = useSessions((s) => s.addTab);
  const patchTab = useSessions((s) => s.patchTab);

  const [hosts, setHosts] = useState<HostEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<HostEntry | null>(null);
  const [user, setUser] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [auth, setAuth] = useState<"key" | "password">("key");
  const [keyPath, setKeyPath] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (open) {
      ipc
        .listSshHosts()
        .then(setHosts)
        .catch(() => setHosts([]));
    } else {
      setError(null);
      setSelected(null);
      setFilter("");
    }
  }, [open]);

  useEffect(() => {
    if (selected) {
      setUser(selected.user ?? "");
      setHost(selected.hostname ?? selected.alias);
      setPort(String(selected.port ?? 22));
      if (selected.identity_file) {
        setAuth("key");
        setKeyPath(selected.identity_file);
      }
    }
  }, [selected]);

  if (!open) return null;

  const filtered = hosts.filter((h) => {
    const q = filter.toLowerCase();
    return (
      h.alias.toLowerCase().includes(q) ||
      (h.hostname ?? "").toLowerCase().includes(q) ||
      (h.user ?? "").toLowerCase().includes(q)
    );
  });

  const connect = async () => {
    setError(null);
    if (!host || !user) {
      setError("Host and user are required");
      return;
    }
    setConnecting(true);
    const tabId = crypto.randomUUID();
    addTab({
      id: tabId,
      sessionId: null,
      kind: "ssh",
      title: `${user}@${host}`,
      subtitle: `${host}:${port}`,
      busy: true,
      exited: false,
    });
    try {
      const sid = await ipc.openSsh({
        host,
        port: Number(port) || 22,
        user,
        password: auth === "password" ? password : undefined,
        privateKeyPath: auth === "key" ? keyPath || undefined : undefined,
        cols: 80,
        rows: 24,
      });
      patchTab(tabId, { sessionId: sid, busy: false });
      toggle(false);
    } catch (e) {
      setError(String(e));
      patchTab(tabId, { busy: false, exited: true });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={() => toggle(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl glass rounded-xl shadow-panel overflow-hidden animate-slide-up flex"
      >
        <div className="w-72 border-r border-border flex flex-col">
          <div className="px-4 py-3 border-b border-border">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search ~/.ssh/config…"
              className="input"
              autoFocus
            />
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-sm text-fg-subtle text-center">
                {hosts.length === 0
                  ? "No hosts in ~/.ssh/config"
                  : "No matches"}
              </div>
            )}
            {filtered.map((h) => (
              <button
                key={h.alias}
                onClick={() => setSelected(h)}
                className={cn(
                  "w-full text-left flex items-center gap-2 px-3 py-2 rounded-md text-sm",
                  "hover:bg-bg-elevated text-fg-muted hover:text-fg",
                  selected?.alias === h.alias && "bg-bg-elevated text-fg"
                )}
              >
                <Server className="h-3.5 w-3.5 text-accent" />
                <div className="flex-1 truncate">
                  <div className="truncate">{h.alias}</div>
                  <div className="text-[11px] text-fg-subtle truncate">
                    {h.user ? `${h.user}@` : ""}
                    {h.hostname ?? h.alias}
                    {h.port ? `:${h.port}` : ""}
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-fg-subtle" />
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 flex flex-col">
          <div className="px-5 py-4 border-b border-border">
            <div className="text-sm font-medium">Quick connect</div>
            <div className="text-[12px] text-fg-subtle">
              {selected
                ? `Editing host alias '${selected.alias}'`
                : "Connect to a new host"}
            </div>
          </div>
          <div className="p-5 grid grid-cols-2 gap-3">
            <Field label="Host">
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="example.com"
                className="input"
              />
            </Field>
            <Field label="Port">
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="input"
                inputMode="numeric"
              />
            </Field>
            <Field label="User">
              <div className="relative">
                <User className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-fg-subtle" />
                <input
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  className="input pl-8"
                  placeholder="root"
                />
              </div>
            </Field>
            <Field label="Auth method">
              <div className="flex gap-1 bg-bg-subtle rounded-md p-1 border border-border">
                {(["key", "password"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setAuth(m)}
                    className={cn(
                      "flex-1 text-xs py-1 rounded",
                      auth === m
                        ? "bg-bg-elevated text-fg"
                        : "text-fg-muted hover:text-fg"
                    )}
                  >
                    {m === "key" ? "Key file" : "Password"}
                  </button>
                ))}
              </div>
            </Field>
            {auth === "key" ? (
              <Field label="Key path" full>
                <div className="relative">
                  <KeyRound className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-fg-subtle" />
                  <input
                    value={keyPath}
                    onChange={(e) => setKeyPath(e.target.value)}
                    placeholder="~/.ssh/id_ed25519"
                    className="input pl-8"
                  />
                </div>
              </Field>
            ) : (
              <Field label="Password" full>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder="••••••••"
                />
              </Field>
            )}
          </div>
          {error && (
            <div className="mx-5 mb-3 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-[12px] text-danger">
              {error}
            </div>
          )}
          <div className="flex-1" />
          <div className="px-5 py-3 border-t border-border flex justify-between items-center">
            <span className="text-[11px] text-fg-subtle">
              <span className="kbd mr-1">⌘K</span> to toggle • TOFU host-key prompt
              coming soon
            </span>
            <div className="flex gap-2">
              <button onClick={() => toggle(false)} className="btn">
                Cancel
              </button>
              <button
                onClick={connect}
                disabled={connecting}
                className="btn-primary disabled:opacity-50"
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", full && "col-span-2")}>
      <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
