use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use russh::client::{Config, Handle, Handler, Msg, Session};
use russh::keys::{decode_secret_key, key, load_secret_key};
use russh::{Channel, ChannelId, ChannelMsg, Disconnect};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::error::{AetherError, AetherResult};
use crate::session::manager::{SessionManager, SshOpts};

struct ClientHandler;

#[async_trait]
impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO: known_hosts verification with TOFU prompt.
        // For alpha, accept any host key. Will be replaced before beta.
        Ok(true)
    }
}

pub struct SshSession {
    id: String,
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    channel: Arc<Mutex<Option<Channel<Msg>>>>,
    _runner: tokio::task::JoinHandle<()>,
    closed: Arc<Mutex<bool>>,
}

impl SshSession {
    pub async fn connect(
        app: AppHandle,
        id: String,
        opts: SshOpts,
    ) -> AetherResult<Self> {
        let config = Arc::new(Config {
            inactivity_timeout: Some(Duration::from_secs(0)),
            keepalive_interval: Some(Duration::from_secs(30)),
            ..Default::default()
        });

        let mut handle = russh::client::connect(config, (opts.host.as_str(), opts.port), ClientHandler)
            .await
            .map_err(|e| AetherError::Ssh(format!("connect failed: {e}")))?;

        let authed = authenticate(&mut handle, &opts).await?;
        if !authed {
            return Err(AetherError::SshAuth { user: opts.user });
        }

        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| AetherError::Ssh(format!("channel open: {e}")))?;

        channel
            .request_pty(
                false,
                "xterm-256color",
                opts.cols as u32,
                opts.rows as u32,
                0,
                0,
                &[],
            )
            .await
            .map_err(|e| AetherError::Ssh(format!("request_pty: {e}")))?;

        channel
            .request_shell(false)
            .await
            .map_err(|e| AetherError::Ssh(format!("request_shell: {e}")))?;

        let channel_arc = Arc::new(Mutex::new(Some(channel)));
        let closed = Arc::new(Mutex::new(false));

        let app_read = app.clone();
        let id_read = id.clone();
        let channel_read = channel_arc.clone();
        let closed_read = closed.clone();
        let runner = tokio::spawn(async move {
            loop {
                let msg = {
                    let mut guard = channel_read.lock().await;
                    let Some(ch) = guard.as_mut() else { break; };
                    match ch.wait().await {
                        Some(m) => m,
                        None => break,
                    }
                };
                match msg {
                    ChannelMsg::Data { ref data } => {
                        SessionManager::emit_data(&app_read, &id_read, data);
                    }
                    ChannelMsg::ExtendedData { ref data, .. } => {
                        SessionManager::emit_data(&app_read, &id_read, data);
                    }
                    ChannelMsg::ExitStatus { exit_status } => {
                        *closed_read.lock().await = true;
                        SessionManager::emit_exit(&app_read, &id_read, exit_status as i32);
                    }
                    ChannelMsg::Eof | ChannelMsg::Close => {
                        *closed_read.lock().await = true;
                        SessionManager::emit_exit(&app_read, &id_read, 0);
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(Self {
            id,
            handle: Arc::new(Mutex::new(handle)),
            channel: channel_arc,
            _runner: runner,
            closed,
        })
    }

    pub async fn write(&mut self, data: &[u8]) -> AetherResult<()> {
        if *self.closed.lock().await {
            return Err(AetherError::SessionNotFound(self.id.clone()));
        }
        let mut guard = self.channel.lock().await;
        let ch = guard
            .as_mut()
            .ok_or_else(|| AetherError::Ssh("channel closed".into()))?;
        ch.data(data)
            .await
            .map_err(|e| AetherError::Ssh(format!("write: {e}")))
    }

    pub async fn resize(&mut self, cols: u16, rows: u16) -> AetherResult<()> {
        let mut guard = self.channel.lock().await;
        let ch = guard
            .as_mut()
            .ok_or_else(|| AetherError::Ssh("channel closed".into()))?;
        ch.window_change(cols as u32, rows as u32, 0, 0)
            .await
            .map_err(|e| AetherError::Ssh(format!("resize: {e}")))
    }

    pub async fn close(&mut self) -> AetherResult<()> {
        *self.closed.lock().await = true;
        if let Some(ch) = self.channel.lock().await.take() {
            let _ = ch.close().await;
        }
        let _ = self
            .handle
            .lock()
            .await
            .disconnect(Disconnect::ByApplication, "bye", "")
            .await;
        Ok(())
    }
}

async fn authenticate(handle: &mut Handle<ClientHandler>, opts: &SshOpts) -> AetherResult<bool> {
    if let Some(path) = opts.private_key_path.as_ref() {
        let path = shellexpand::tilde(path).to_string();
        let key = match opts.private_key_passphrase.as_deref() {
            Some(pass) if !pass.is_empty() => load_secret_key(&path, Some(pass))?,
            _ => load_secret_key(&path, None)?,
        };
        let r = handle
            .authenticate_publickey(opts.user.clone(), Arc::new(key))
            .await?;
        if r {
            return Ok(true);
        }
    }

    if let Some(pw) = opts.password.as_ref() {
        let r = handle.authenticate_password(opts.user.clone(), pw).await?;
        if r {
            return Ok(true);
        }
    }

    Ok(false)
}

// Silence unused-import warnings on platforms where decode_secret_key/ChannelId aren't referenced.
#[allow(dead_code)]
fn _kept_imports(_: ChannelId, _: &[u8]) {
    let _ = decode_secret_key::<&str>;
}
