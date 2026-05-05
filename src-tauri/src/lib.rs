mod commands;
mod error;
mod session;
mod ssh_config;
mod vault;

use std::sync::Arc;

use session::SessionManager;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub sessions: Arc<SessionManager>,
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
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let sessions = Arc::new(SessionManager::new(handle));
            app.manage(AppState { sessions });
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aether");
}
