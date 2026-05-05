use serde::{Deserialize, Serialize};
use tauri::State;

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
