mod ai;
mod auth;
mod commands;
mod error;
mod known_hosts;
mod secrets;
mod session;
mod ssh_config;
mod vault;

use std::sync::Arc;

use ai::AiBridge;
use session::SessionManager;
use tauri::Manager;
use tokio::sync::OnceCell;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub sessions: Arc<SessionManager>,
    pub ai: Arc<OnceCell<AiBridge>>,
    pub sidecar_dir: std::path::PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("aether=info")),
        )
        .with_target(false)
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let sessions = Arc::new(SessionManager::new(handle.clone()));
            let sidecar_dir = sidecar_dir(&handle);

            // Hydrate the in-process token cache from the encrypted
            // session file before any UI code runs. If the keyring
            // backend is unreliable on this Windows install, this is the
            // only path that gives us cross-launch persistence.
            match auth::hydrate_from_disk() {
                Ok(true) => {
                    tracing::info!("loaded persisted Cursor session from session.bin")
                }
                Ok(false) => {}
                Err(e) => tracing::warn!(error = %e, "failed to read session.bin"),
            }

            app.manage(AppState {
                sessions,
                ai: Arc::new(OnceCell::new()),
                sidecar_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_local,
            commands::open_ssh,
            commands::write_session,
            commands::resize_session,
            commands::close_session,
            commands::list_sessions,
            commands::list_ssh_hosts,
            commands::vault_set,
            commands::vault_get,
            commands::vault_delete,
            commands::app_version,
            commands::ai_ping,
            commands::ai_create_agent,
            commands::ai_send,
            commands::ai_dispose,
            commands::auth_status,
            commands::auth_save_token,
            commands::auth_forget,
            commands::auth_run_cli_login,
            commands::auth_adopt_cli_token,
            commands::auth_open_dashboard,
            commands::auth_install_cli,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aether");
}

/// Resolves the path to the bundled sidecar JS entry. In dev we point to the
/// repo's `sidecar/` checkout; in a packaged build the sidecar ships as a
/// resource.
fn sidecar_dir(handle: &tauri::AppHandle) -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("AETHER_SIDECAR_DIR") {
        return std::path::PathBuf::from(dir);
    }
    if let Ok(resource) = handle
        .path()
        .resolve("sidecar", tauri::path::BaseDirectory::Resource)
    {
        if resource.exists() {
            return resource;
        }
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    if cwd.join("sidecar").exists() {
        return cwd.join("sidecar");
    }
    cwd.parent()
        .map(|p| p.join("sidecar"))
        .unwrap_or_else(|| cwd.join("sidecar"))
}
