use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::ai::AiBridge;
use crate::auth::{self, AuthStatus};
use crate::error::{AetherError, AetherResult};
use crate::session::{LocalOpts, SshOpts};
use crate::ssh_config;
use crate::vault;
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub kind: String,
    pub label: String,
}

#[tauri::command]
pub async fn open_local(
    state: State<'_, AppState>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> AetherResult<String> {
    state
        .sessions
        .open_local(LocalOpts { cwd, cols, rows })
        .await
}

#[derive(Debug, Deserialize)]
pub struct OpenSshArgs {
    pub host: String,
    pub port: Option<u16>,
    pub user: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub use_agent: Option<bool>,
    pub trust_unknown_host_key: Option<bool>,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub async fn open_ssh(state: State<'_, AppState>, args: OpenSshArgs) -> AetherResult<String> {
    state
        .sessions
        .open_ssh(SshOpts {
            host: args.host,
            port: args.port.unwrap_or(22),
            user: args.user,
            password: args.password,
            private_key_path: args.private_key_path,
            private_key_passphrase: args.private_key_passphrase,
            use_agent: args.use_agent.unwrap_or(false),
            trust_unknown_host_key: args.trust_unknown_host_key.unwrap_or(true),
            cols: args.cols,
            rows: args.rows,
        })
        .await
}

#[tauri::command]
pub async fn write_session(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> AetherResult<()> {
    state.sessions.write(&id, data.as_bytes()).await
}

#[tauri::command]
pub async fn resize_session(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> AetherResult<()> {
    state.sessions.resize(&id, cols, rows).await
}

#[tauri::command]
pub async fn close_session(state: State<'_, AppState>, id: String) -> AetherResult<()> {
    state.sessions.close(&id).await
}

#[tauri::command]
pub async fn list_sessions(state: State<'_, AppState>) -> AetherResult<Vec<SessionInfo>> {
    Ok(state
        .sessions
        .list()
        .into_iter()
        .map(|s| SessionInfo {
            id: s.id,
            kind: s.kind,
            label: s.label,
        })
        .collect())
}

#[tauri::command]
pub async fn list_ssh_hosts() -> AetherResult<Vec<ssh_config::HostEntry>> {
    ssh_config::list_hosts().map_err(|e| AetherError::Config(e.to_string()))
}

#[tauri::command]
pub async fn vault_set(key: String, value: String) -> AetherResult<()> {
    vault::set(&key, &value).map_err(|e| AetherError::Vault(e.to_string()))
}

#[tauri::command]
pub async fn vault_get(key: String) -> AetherResult<Option<String>> {
    vault::get(&key).map_err(|e| AetherError::Vault(e.to_string()))
}

#[tauri::command]
pub async fn vault_delete(key: String) -> AetherResult<()> {
    vault::delete(&key).map_err(|e| AetherError::Vault(e.to_string()))
}

#[tauri::command]
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

async fn get_ai(state: &State<'_, AppState>) -> AetherResult<AiBridge> {
    let app = state.sessions.app_handle().clone();
    let dir = state.sidecar_dir.clone();
    let cell = state.ai.clone();
    let bridge = cell
        .get_or_try_init(|| async move { AiBridge::spawn(app, dir).await })
        .await?;
    Ok(bridge.clone())
}

#[tauri::command]
pub async fn ai_ping(state: State<'_, AppState>) -> AetherResult<()> {
    get_ai(&state).await?.ping().await
}

#[tauri::command]
pub async fn ai_create_agent(
    state: State<'_, AppState>,
    cwd: Option<String>,
    model: Option<String>,
) -> AetherResult<String> {
    let api_key = auth::active_token().map_err(|e| AetherError::Vault(e.to_string()))?;
    let Some(api_key) = api_key else {
        return Err(AetherError::Other(anyhow::anyhow!(
            "not signed in to Cursor — open the AI sidebar to sign in"
        )));
    };
    if !auth::token_looks_like_api_key(&api_key) {
        return Err(AetherError::Other(anyhow::anyhow!(
            "Aether is using your Cursor IDE session token, but the @cursor/sdk requires a real API key (the value that starts with `crsr_`). Sign out from the AI header pill, then click 'Continue with Cursor' to open cursor.com/dashboard/integrations and paste a key generated there."
        )));
    }
    get_ai(&state)
        .await?
        .create_agent(cwd, model, Some(api_key))
        .await
}

#[tauri::command]
pub async fn ai_send(
    state: State<'_, AppState>,
    agent_id: String,
    prompt: String,
) -> AetherResult<serde_json::Value> {
    get_ai(&state).await?.send(&agent_id, &prompt).await
}

#[tauri::command]
pub async fn ai_dispose(state: State<'_, AppState>, agent_id: String) -> AetherResult<()> {
    get_ai(&state).await?.dispose(&agent_id).await
}

#[tauri::command]
pub async fn auth_status() -> AetherResult<AuthStatus> {
    Ok(auth::status())
}

#[tauri::command]
pub async fn auth_save_token(token: String) -> AetherResult<()> {
    auth::save_token(&token).map_err(|e| AetherError::Vault(e.to_string()))
}

#[tauri::command]
pub async fn auth_forget() -> AetherResult<()> {
    auth::forget_token().map_err(|e| AetherError::Vault(e.to_string()))
}

#[tauri::command]
pub async fn auth_run_cli_login() -> AetherResult<()> {
    auth::run_cli_login()
        .await
        .map_err(|e| AetherError::Other(anyhow::anyhow!(e)))
}

#[tauri::command]
pub async fn auth_adopt_cli_token() -> AetherResult<bool> {
    auth::adopt_cli_token().map_err(|e| AetherError::Vault(e.to_string()))
}

#[tauri::command]
pub async fn auth_open_dashboard(app: tauri::AppHandle) -> AetherResult<()> {
    app.opener()
        .open_url("https://cursor.com/dashboard/integrations", None::<String>)
        .map_err(|e| AetherError::Other(anyhow::anyhow!(e)))
}

/// Spawns the official Cursor CLI installer in a *visible* shell window the
/// user can watch, and polls for the binary's appearance with a timeout.
///
/// We deliberately do NOT capture stdout/stderr through pipes here, because
/// `Invoke-RestMethod`'s download progress can stall a piped stdout for many
/// seconds — making `Command::output()` look indistinguishable from a hang.
/// Instead we rely on the well-known install destination (which we discovered
/// by reading the live install script) and poll for it.
#[tauri::command]
pub async fn auth_install_cli() -> AetherResult<String> {
    use std::time::Duration;
    use tokio::process::Command;
    use tokio::time::sleep;

    // Where the official installer drops the binary. Polling for its
    // appearance is dramatically more reliable than waiting on the script's
    // overall exit, because the script does post-install bookkeeping that
    // may extend beyond the moment the binary is usable.
    let target = if cfg!(windows) {
        std::env::var("LOCALAPPDATA")
            .map(|p| std::path::PathBuf::from(p).join("cursor-agent").join("agent.exe"))
            .map_err(|_| AetherError::Other(anyhow::anyhow!("LOCALAPPDATA not set")))?
    } else {
        dirs::home_dir()
            .ok_or_else(|| AetherError::Other(anyhow::anyhow!("no home dir")))?
            .join(".local")
            .join("bin")
            .join("agent")
    };

    // Spawn the installer in a fresh PowerShell window so the user sees real
    // download progress and any error messages. `start` is a cmd.exe builtin.
    let spawn_result = if cfg!(windows) {
        Command::new("cmd.exe")
            .args([
                "/c",
                "start",
                "Aether — installing Cursor CLI",
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "Write-Host 'Aether is installing the Cursor CLI...'; Write-Host ''; \
                 try { irm 'https://cursor.com/install?win32=true' | iex; \
                       Write-Host ''; Write-Host 'Done. You can close this window.' -ForegroundColor Green } \
                 catch { Write-Host ''; Write-Host \"Install failed: $_\" -ForegroundColor Red; \
                         Write-Host 'Press any key to close.'; \
                         [void][System.Console]::ReadKey($true) }",
            ])
            .spawn()
    } else {
        Command::new("sh")
            .args([
                "-c",
                "curl -fsS https://cursor.com/install | bash",
            ])
            .spawn()
    };

    spawn_result.map_err(|e| {
        AetherError::Other(anyhow::anyhow!("could not start installer shell: {e}"))
    })?;

    // Poll for the binary up to 5 minutes. The official installer ships a
    // ~30 MB zip and most users will see it appear within 60 s.
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    let mut last_log = std::time::Instant::now();
    while std::time::Instant::now() < deadline {
        if target.exists() {
            tracing::info!(path = %target.display(), "cursor CLI installed");
            return Ok(target.display().to_string());
        }
        if let Some(found) = auth::find_cursor_cli_public() {
            tracing::info!(path = %found.display(), "cursor CLI detected");
            return Ok(found.display().to_string());
        }
        if last_log.elapsed() >= Duration::from_secs(15) {
            tracing::info!("still waiting for cursor-agent install...");
            last_log = std::time::Instant::now();
        }
        sleep(Duration::from_millis(750)).await;
    }

    Err(AetherError::Other(anyhow::anyhow!(
        "Cursor CLI install did not complete within 5 minutes. \
         Check the installer window for an error, or run this manually:\n\n  \
         irm 'https://cursor.com/install?win32=true' | iex"
    )))
}
