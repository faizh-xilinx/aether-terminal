import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface OpenSshArgs {
  host: string;
  port?: number;
  user: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  useAgent?: boolean;
  cols: number;
  rows: number;
}

export interface SessionInfo {
  id: string;
  kind: "local" | "ssh";
  label: string;
}

export interface HostEntry {
  alias: string;
  hostname?: string;
  user?: string;
  port?: number;
  identity_file?: string;
}

export const ipc = {
  openLocal(cols: number, rows: number, cwd?: string): Promise<string> {
    return invoke<string>("open_local", { cwd, cols, rows });
  },

  openSsh(args: OpenSshArgs): Promise<string> {
    return invoke<string>("open_ssh", {
      args: {
        host: args.host,
        port: args.port,
        user: args.user,
        password: args.password,
        private_key_path: args.privateKeyPath,
        private_key_passphrase: args.privateKeyPassphrase,
        use_agent: args.useAgent,
        cols: args.cols,
        rows: args.rows,
      },
    });
  },

  writeSession(id: string, data: string): Promise<void> {
    return invoke("write_session", { id, data });
  },

  resizeSession(id: string, cols: number, rows: number): Promise<void> {
    return invoke("resize_session", { id, cols, rows });
  },

  closeSession(id: string): Promise<void> {
    return invoke("close_session", { id });
  },

  listSessions(): Promise<SessionInfo[]> {
    return invoke("list_sessions");
  },

  listSshHosts(): Promise<HostEntry[]> {
    return invoke("list_ssh_hosts");
  },

  vaultSet(key: string, value: string): Promise<void> {
    return invoke("vault_set", { key, value });
  },

  vaultGet(key: string): Promise<string | null> {
    return invoke("vault_get", { key });
  },

  vaultDelete(key: string): Promise<void> {
    return invoke("vault_delete", { key });
  },

  appVersion(): Promise<string> {
    return invoke("app_version");
  },

  onSessionData(id: string, cb: (data: string) => void): Promise<UnlistenFn> {
    return listen<string>(`session:data:${id}`, (event) => cb(event.payload));
  },

  onSessionExit(id: string, cb: (code: number) => void): Promise<UnlistenFn> {
    return listen<number>(`session:exit:${id}`, (event) => cb(event.payload));
  },

  // ── AI bridge (sidecar @cursor/sdk) ──────────────────────────────────────
  aiPing(): Promise<void> {
    return invoke("ai_ping");
  },

  aiCreateAgent(cwd?: string, model?: string): Promise<string> {
    return invoke("ai_create_agent", { cwd, model });
  },

  aiSend(agentId: string, prompt: string): Promise<{ status: string; result?: string }> {
    return invoke("ai_send", { agentId, prompt });
  },

  aiDispose(agentId: string): Promise<void> {
    return invoke("ai_dispose", { agentId });
  },

  // ── Cursor authentication ────────────────────────────────────────────────
  authStatus(): Promise<AuthStatus> {
    return invoke("auth_status");
  },

  authSaveToken(token: string): Promise<void> {
    return invoke("auth_save_token", { token });
  },

  authForget(): Promise<void> {
    return invoke("auth_forget");
  },

  authRunCliLogin(): Promise<void> {
    return invoke("auth_run_cli_login");
  },

  authAdoptCliToken(): Promise<boolean> {
    return invoke("auth_adopt_cli_token");
  },

  authOpenDashboard(): Promise<void> {
    return invoke("auth_open_dashboard");
  },

  authInstallCli(): Promise<string> {
    return invoke("auth_install_cli");
  },
};

export interface AuthStatus {
  authenticated: boolean;
  source: "none" | "keyring" | "env_var" | "cursor_cli";
  cli_available: boolean;
  cli_path: string | null;
  user: string | null;
}
