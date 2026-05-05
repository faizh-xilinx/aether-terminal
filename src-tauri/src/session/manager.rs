use std::sync::Arc;

use dashmap::DashMap;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::{AetherError, AetherResult};
use crate::session::local::LocalSession;
use crate::session::remote::SshSession;

#[derive(Debug, Clone)]
pub struct LocalOpts {
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone)]
pub struct SshOpts {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub use_agent: bool,
    /// If true, an unknown host key will be accepted and added to known_hosts
    /// (trust-on-first-use). If false, unknown keys cause connection failure.
    pub trust_unknown_host_key: bool,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionRecord {
    pub id: String,
    pub kind: String,
    pub label: String,
}

pub enum SessionHandle {
    Local(Arc<Mutex<LocalSession>>),
    Ssh(Arc<Mutex<SshSession>>),
}

pub struct SessionManager {
    app: AppHandle,
    sessions: DashMap<String, SessionHandle>,
    meta: DashMap<String, SessionRecord>,
}

impl SessionManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            sessions: DashMap::new(),
            meta: DashMap::new(),
        }
    }

    pub fn app_handle(&self) -> &AppHandle {
        &self.app
    }

    pub async fn open_local(&self, opts: LocalOpts) -> AetherResult<String> {
        let id = Uuid::new_v4().to_string();
        let session = LocalSession::spawn(self.app.clone(), id.clone(), opts.clone()).await?;
        self.sessions
            .insert(id.clone(), SessionHandle::Local(Arc::new(Mutex::new(session))));
        self.meta.insert(
            id.clone(),
            SessionRecord {
                id: id.clone(),
                kind: "local".into(),
                label: format!("local: {}", opts.cwd.unwrap_or_else(|| "~".into())),
            },
        );
        Ok(id)
    }

    pub async fn open_ssh(&self, opts: SshOpts) -> AetherResult<String> {
        let id = Uuid::new_v4().to_string();
        let label = format!("{}@{}:{}", opts.user, opts.host, opts.port);
        let session = SshSession::connect(self.app.clone(), id.clone(), opts).await?;
        self.sessions
            .insert(id.clone(), SessionHandle::Ssh(Arc::new(Mutex::new(session))));
        self.meta.insert(
            id.clone(),
            SessionRecord {
                id: id.clone(),
                kind: "ssh".into(),
                label,
            },
        );
        Ok(id)
    }

    pub async fn write(&self, id: &str, data: &[u8]) -> AetherResult<()> {
        let handle = self
            .sessions
            .get(id)
            .ok_or_else(|| AetherError::SessionNotFound(id.into()))?;
        match handle.value() {
            SessionHandle::Local(s) => s.lock().await.write(data).await,
            SessionHandle::Ssh(s) => s.lock().await.write(data).await,
        }
    }

    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> AetherResult<()> {
        let handle = self
            .sessions
            .get(id)
            .ok_or_else(|| AetherError::SessionNotFound(id.into()))?;
        match handle.value() {
            SessionHandle::Local(s) => s.lock().await.resize(cols, rows).await,
            SessionHandle::Ssh(s) => s.lock().await.resize(cols, rows).await,
        }
    }

    pub async fn close(&self, id: &str) -> AetherResult<()> {
        if let Some((_, handle)) = self.sessions.remove(id) {
            match handle {
                SessionHandle::Local(s) => s.lock().await.close().await?,
                SessionHandle::Ssh(s) => s.lock().await.close().await?,
            }
        }
        self.meta.remove(id);
        Ok(())
    }

    pub fn list(&self) -> Vec<SessionRecord> {
        self.meta.iter().map(|e| e.value().clone()).collect()
    }

    pub fn emit_data(app: &AppHandle, id: &str, data: &[u8]) {
        let _ = app.emit(
            &format!("session:data:{id}"),
            String::from_utf8_lossy(data).to_string(),
        );
    }

    pub fn emit_exit(app: &AppHandle, id: &str, code: i32) {
        let _ = app.emit(&format!("session:exit:{id}"), code);
    }
}
