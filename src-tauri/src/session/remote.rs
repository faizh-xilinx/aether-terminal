use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use russh::client::{Config, Handle, Handler, Msg};
use russh::keys::{key, load_secret_key};
use russh::{Channel, ChannelMsg, Disconnect};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::error::{AetherError, AetherResult};
use crate::known_hosts::{self, HostKeyDecision};
use crate::session::manager::{SessionManager, SshOpts};

struct ClientHandler {
    host: String,
    port: u16,
    trust_unknown: bool,
}

#[async_trait]
impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let decision = known_hosts::check(&self.host, self.port, server_public_key)
            .map_err(|e| russh::Error::IO(std::io::Error::other(e.to_string())))?;
        match decision {
            HostKeyDecision::Match => Ok(true),
            HostKeyDecision::Mismatch { stored_type } => {
                tracing::error!(
                    host = %self.host,
                    port = self.port,
                    stored_type = %stored_type,
                    presented_type = %server_public_key.name(),
                    "host key mismatch \u{2014} possible MITM, refusing connection"
                );
                Ok(false)
            }
            HostKeyDecision::Unknown => {
                if !self.trust_unknown {
                    tracing::warn!(
                        host = %self.host,
                        port = self.port,
                        "unknown host key and TOFU disabled \u{2014} refusing"
                    );
                    return Ok(false);
                }
                if let Err(e) = known_hosts::add(&self.host, self.port, server_public_key) {
                    tracing::warn!(error = %e, "failed to persist new known_hosts entry (continuing)");
                }
                tracing::info!(
                    host = %self.host,
                    port = self.port,
                    fingerprint_type = %server_public_key.name(),
                    "added new host key to known_hosts (TOFU)"
                );
                Ok(true)
            }
        }
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
    pub async fn connect(app: AppHandle, id: String, opts: SshOpts) -> AetherResult<Self> {
        let config = Arc::new(Config {
            // No inactivity timeout — interactive shells stay open.
            // 30 s keepalive matches OpenSSH ServerAliveInterval default.
            inactivity_timeout: None,
            keepalive_interval: Some(Duration::from_secs(30)),
            ..Default::default()
        });

        let handler = ClientHandler {
            host: opts.host.clone(),
            port: opts.port,
            trust_unknown: opts.trust_unknown_host_key,
        };
        tracing::info!(
            host = %opts.host,
            port = opts.port,
            user = %opts.user,
            "establishing SSH connection"
        );
        #[allow(unused_mut)]
        let mut handle = russh::client::connect(config, (opts.host.as_str(), opts.port), handler)
            .await
            .map_err(|e| AetherError::Ssh(format!("connect failed: {e}")))?;

        // `authenticate` returns Err with a rich message on failure, so the
        // success path is the only `Ok` branch we care about here.
        authenticate(&mut handle, &opts).await?;

        #[allow(unused_mut)]
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
                    let Some(ch) = guard.as_mut() else {
                        break;
                    };
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

async fn authenticate(
    handle: &mut Handle<ClientHandler>,
    opts: &SshOpts,
) -> AetherResult<bool> {
    let mut tried: Vec<String> = Vec::new();

    // 1. Explicit private key file from the connect dialog or ssh_config.
    if let Some(path) = opts.private_key_path.as_ref() {
        let expanded = shellexpand::tilde(path).to_string();
        match load_secret_key(&expanded, opts.private_key_passphrase.as_deref()) {
            Ok(key) => {
                tried.push(format!("publickey({path})"));
                tracing::info!(host = %opts.host, key = %path, "trying explicit publickey");
                if handle
                    .authenticate_publickey(opts.user.clone(), Arc::new(key))
                    .await?
                {
                    return Ok(true);
                }
            }
            Err(e) => {
                tracing::warn!(key = %path, error = %e, "failed to load explicit private key");
                tried.push(format!("publickey({path}: load failed: {e})"));
            }
        }
    }

    // 2. Default keys in ~/.ssh — the typical interactive case.
    if let Some(home) = dirs::home_dir() {
        for fname in ["id_ed25519", "id_ecdsa", "id_rsa"] {
            let path = home.join(".ssh").join(fname);
            if !path.exists() {
                continue;
            }
            // Skip if we just tried this same file as the explicit key.
            if let Some(explicit) = opts.private_key_path.as_ref() {
                let exp = shellexpand::tilde(explicit).to_string();
                if std::path::Path::new(&exp) == path {
                    continue;
                }
            }
            match load_secret_key(&path, opts.private_key_passphrase.as_deref()) {
                Ok(key) => {
                    tried.push(format!("publickey({})", path.display()));
                    tracing::info!(host = %opts.host, key = %path.display(), "trying default publickey");
                    if handle
                        .authenticate_publickey(opts.user.clone(), Arc::new(key))
                        .await?
                    {
                        return Ok(true);
                    }
                }
                Err(e) => {
                    tracing::debug!(key = %path.display(), error = %e, "default key load failed");
                }
            }
        }
    }

    // 3. Password (only attempted if explicitly provided via the dialog).
    if let Some(pw) = opts.password.as_ref() {
        tried.push("password".into());
        tracing::info!(host = %opts.host, "trying password auth");
        if handle
            .authenticate_password(opts.user.clone(), pw)
            .await?
        {
            return Ok(true);
        }
    }

    tracing::error!(
        host = %opts.host,
        user = %opts.user,
        port = opts.port,
        attempts = ?tried,
        "all SSH auth methods exhausted"
    );

    Err(AetherError::Ssh(format!(
        "authentication failed for {}@{}:{} (tried: {})",
        opts.user,
        opts.host,
        opts.port,
        if tried.is_empty() {
            "no methods — provide a key path or password".to_string()
        } else {
            tried.join(", ")
        }
    )))
}
