use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::AppHandle;
use tokio::sync::mpsc;

use crate::error::{AetherError, AetherResult};
use crate::session::manager::{LocalOpts, SessionManager};

pub struct LocalSession {
    id: String,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn std::io::Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    closed: Arc<Mutex<bool>>,
    _read_handle: tokio::task::JoinHandle<()>,
    _wait_handle: tokio::task::JoinHandle<()>,
    _tx: mpsc::Sender<()>,
}

impl LocalSession {
    pub async fn spawn(app: AppHandle, id: String, opts: LocalOpts) -> AetherResult<Self> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AetherError::Pty(e.to_string()))?;

        let shell = default_shell();
        let mut cmd = CommandBuilder::new(&shell);
        if let Some(cwd) = opts.cwd.as_ref() {
            cmd.cwd(cwd);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AetherError::Pty(e.to_string()))?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AetherError::Pty(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AetherError::Pty(e.to_string()))?;

        let master = Arc::new(Mutex::new(pair.master));
        let writer = Arc::new(Mutex::new(writer));
        let child = Arc::new(Mutex::new(child));
        let closed = Arc::new(Mutex::new(false));

        let (tx, _rx) = mpsc::channel::<()>(1);
        let app_read = app.clone();
        let id_read = id.clone();
        let read_handle = tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        SessionManager::emit_data(&app_read, &id_read, &buf[..n]);
                    }
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        break;
                    }
                }
            }
        });

        let id_wait = id.clone();
        let app_wait = app.clone();
        let child_wait = child.clone();
        let closed_wait = closed.clone();
        let wait_handle = tokio::task::spawn_blocking(move || {
            let exit_code = {
                let mut guard = child_wait.lock();
                guard.wait().map(|s| s.exit_code() as i32).unwrap_or(-1)
            };
            *closed_wait.lock() = true;
            SessionManager::emit_exit(&app_wait, &id_wait, exit_code);
        });

        Ok(Self {
            id,
            master,
            writer,
            child,
            closed,
            _read_handle: read_handle,
            _wait_handle: wait_handle,
            _tx: tx,
        })
    }

    pub async fn write(&mut self, data: &[u8]) -> AetherResult<()> {
        if *self.closed.lock() {
            return Err(AetherError::SessionNotFound(self.id.clone()));
        }
        let writer = self.writer.clone();
        let data = data.to_vec();
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            let mut w = writer.lock();
            w.write_all(&data)?;
            w.flush()
        })
        .await
        .map_err(|e| AetherError::Other(anyhow::anyhow!(e)))?
        .map_err(AetherError::from)
    }

    pub async fn resize(&mut self, cols: u16, rows: u16) -> AetherResult<()> {
        let master = self.master.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            master
                .lock()
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| AetherError::Other(anyhow::anyhow!(e)))?
        .map_err(AetherError::Pty)
    }

    pub async fn close(&mut self) -> AetherResult<()> {
        *self.closed.lock() = true;
        let child = self.child.clone();
        tokio::task::spawn_blocking(move || {
            let _ = child.lock().kill();
        })
        .await
        .map_err(|e| AetherError::Other(anyhow::anyhow!(e)))?;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
}

#[cfg(not(target_os = "windows"))]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
}
