import { useEffect, useState } from "react";
import {
  Sparkles,
  Mail,
  KeyRound,
  ExternalLink,
  Check,
  Loader2,
  AlertCircle,
  Download,
} from "lucide-react";

import { ipc } from "@/lib/ipc";
import { useAuth } from "@/store/auth";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Stage =
  | { kind: "idle" }
  | { kind: "browser-login" }
  | { kind: "paste"; afterDashboard: boolean }
  | { kind: "validating" }
  | { kind: "installing-cli" };

export function AuthDialog({ open, onOpenChange }: Props) {
  const auth = useAuth();
  const refresh = useAuth((s) => s.refresh);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStage({ kind: "idle" });
      setToken("");
      setError(null);
      refresh();
    }
  }, [open, refresh]);

  if (!open) return null;

  const cliAvailable = auth.status?.cli_available ?? false;

  const signInWithBrowser = async () => {
    setError(null);
    if (cliAvailable) {
      setStage({ kind: "browser-login" });
      try {
        await ipc.authRunCliLogin();
        const adopted = await ipc.authAdoptCliToken();
        if (!adopted) {
          throw new Error(
            "cursor-agent finished but no token was found in ~/.cursor/auth.json"
          );
        }
        await auth.refresh();
        onOpenChange(false);
      } catch (e) {
        setError(String(e));
        setStage({ kind: "idle" });
      }
    } else {
      try {
        await ipc.authOpenDashboard();
        setStage({ kind: "paste", afterDashboard: true });
      } catch (e) {
        setError(String(e));
      }
    }
  };

  const installCli = async () => {
    setError(null);
    setStage({ kind: "installing-cli" });
    try {
      await ipc.authInstallCli();
      await auth.refresh();
      setStage({ kind: "idle" });
    } catch (e) {
      const msg = String(e);
      const manual =
        navigator.platform.toLowerCase().includes("win")
          ? "irm 'https://cursor.com/install?win32=true' | iex"
          : "curl -fsS https://cursor.com/install | bash";
      setError(`${msg}\n\nYou can install manually with:\n  ${manual}`);
      setStage({ kind: "idle" });
    }
  };

  const submitToken = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Paste your Cursor API key first");
      return;
    }
    setError(null);
    setStage({ kind: "validating" });
    try {
      await auth.saveToken(trimmed);
      try {
        await ipc.aiPing();
      } catch (pingErr) {
        await auth.forget();
        throw new Error(`Token rejected by Cursor: ${pingErr}`);
      }
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
      setStage({ kind: "idle" });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={() => onOpenChange(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md glass rounded-xl shadow-panel overflow-hidden animate-slide-up"
      >
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-accent/15 text-accent flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="text-sm font-medium">Sign in to Cursor</div>
            <div className="text-[11px] text-fg-subtle">
              Aether uses your Cursor account for AI features.
            </div>
          </div>
        </div>

        <div className="p-5 space-y-3">
          {auth.status?.authenticated && stage.kind === "idle" && (
            <SignedInPanel
              email={auth.status.user}
              source={auth.status.source}
              onSignOut={async () => {
                await auth.forget();
              }}
            />
          )}

          {stage.kind === "browser-login" && (
            <Status>
              Opening your browser… complete the login on cursor.com, then come
              back here. Aether will pick up the credential automatically.
            </Status>
          )}

          {stage.kind === "validating" && <Status>Validating your token…</Status>}

          {stage.kind === "installing-cli" && (
            <Status>Installing the official Cursor CLI via npm…</Status>
          )}

          {stage.kind === "idle" && !auth.status?.authenticated && (
            <>
              <button onClick={signInWithBrowser} className="auth-btn-primary">
                <Mail className="h-4 w-4" />
                <span className="flex-1 text-left">
                  <div>Continue with Cursor</div>
                  <div className="text-[11px] opacity-70">
                    {cliAvailable
                      ? "Sign in with your email in the browser"
                      : "Open Cursor dashboard, paste your key once"}
                  </div>
                </span>
                <ExternalLink className="h-3.5 w-3.5 opacity-60" />
              </button>

              {!cliAvailable && (
                <button onClick={installCli} className="auth-btn">
                  <Download className="h-4 w-4" />
                  <span className="flex-1 text-left">
                    Install Cursor CLI for one-click sign-in
                    <div className="text-[11px] opacity-60">
                      Runs <code className="font-mono">npm install -g cursor-agent</code>
                    </div>
                  </span>
                </button>
              )}
            </>
          )}

          {stage.kind === "paste" && (
            <div className="space-y-2.5">
              {stage.afterDashboard && (
                <div className="text-[12px] text-fg-muted bg-bg-subtle rounded-md px-3 py-2 border border-border">
                  We opened <span className="text-fg">cursor.com/dashboard/integrations</span> in
                  your browser. Generate an API key there, then paste it below
                  — Aether will store it securely in your OS keyring and never
                  prompt again.
                </div>
              )}
              <label className="text-[11px] uppercase tracking-wider text-fg-subtle flex items-center gap-1.5">
                <KeyRound className="h-3 w-3" /> Cursor API key
              </label>
              <input
                type="password"
                autoFocus
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitToken()}
                placeholder="crsr_..."
                className="input font-mono text-[12px]"
              />
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStage({ kind: "idle" })}
                  className="btn"
                >
                  Back
                </button>
                <button
                  onClick={submitToken}
                  disabled={!token.trim()}
                  className="btn-primary disabled:opacity-50 flex-1"
                >
                  Sign in & store securely
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-[12px] text-danger flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {!auth.status?.authenticated && stage.kind === "idle" && (
            <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle pt-1">
              <Check className="h-3 w-3 text-success" /> Token stored via Windows
              DPAPI in your OS keyring — never written to disk in plaintext.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SignedInPanel({
  email,
  source,
  onSignOut,
}: {
  email: string | null;
  source: string;
  onSignOut: () => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 px-3 py-2.5 rounded-md bg-success/10 border border-success/20">
        <div className="h-7 w-7 rounded-full bg-success/20 text-success flex items-center justify-center mt-0.5">
          <Check className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-fg">
            {email ?? "Signed in to Cursor"}
          </div>
          <div className="text-[11px] text-fg-subtle">
            {sourceLabel(source)}
          </div>
        </div>
      </div>
      <button onClick={onSignOut} className="btn w-full">
        Sign out
      </button>
    </div>
  );
}

function sourceLabel(source: string): string {
  switch (source) {
    case "keyring":
      return "Token in OS keyring";
    case "env_var":
      return "Using CURSOR_API_KEY environment variable";
    case "cursor_cli":
      return "Reusing credentials from cursor-agent CLI";
    default:
      return "Not signed in";
  }
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-3 rounded-md bg-bg-subtle border border-border text-[13px] text-fg-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent shrink-0" />
      {children}
    </div>
  );
}

export default AuthDialog;
