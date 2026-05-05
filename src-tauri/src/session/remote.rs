use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use russh::client::{Config, Handle, Handler};
use russh::keys::{key, load_secret_key};
use russh::{ChannelMsg, Disconnect};
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};

use crate::error::{AetherError, AetherResult};
use crate::known_hosts::{self, HostKeyDecision};
use crate::session::manager::{SessionManager, SshOpts};

/// Operations the I/O task can perform on the channel. Sent over an mpsc so
/// the task that owns the channel is the only one calling `data()`,
/// `window_change()`, etc. — keeping reads and writes serialised without a
/// mutex around the channel itself (which would deadlock against
/// `Channel::wait().await`).
enum ChannelOp {
    Data(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

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
    ops_tx: mpsc::Sender<ChannelOp>,
    _runner: tokio::task::JoinHandle<()>,
    closed: Arc<AtomicBool>,
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
            .map_err(|e| {
                AetherError::Ssh(format!(
                    "could not reach {}:{} ({}). Check the hostname and port, that the SSH server is running, and that no firewall blocks the connection.",
                    opts.host, opts.port, e
                ))
            })?;

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

        // Channel I/O task: owns the channel exclusively, multiplexes
        // server-pushed messages and outbound write/resize/close ops via
        // tokio::select!. This is the canonical russh pattern; trying to
        // protect the channel with a mutex deadlocks because
        // `channel.wait().await` holds its receive side indefinitely.
        let (ops_tx, mut ops_rx) = mpsc::channel::<ChannelOp>(64);
        let closed = Arc::new(AtomicBool::new(false));
        let app_for_runner = app.clone();
        let id_for_runner = id.clone();
        let closed_for_runner = closed.clone();

        let runner = tokio::spawn(async move {
            let mut channel = channel;
            loop {
                tokio::select! {
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { ref data }) => {
                                SessionManager::emit_data(&app_for_runner, &id_for_runner, data);
                            }
                            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                                SessionManager::emit_data(&app_for_runner, &id_for_runner, data);
                            }
                            Some(ChannelMsg::ExitStatus { exit_status }) => {
                                closed_for_runner.store(true, Ordering::SeqCst);
                                SessionManager::emit_exit(&app_for_runner, &id_for_runner, exit_status as i32);
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                                closed_for_runner.store(true, Ordering::SeqCst);
                                SessionManager::emit_exit(&app_for_runner, &id_for_runner, 0);
                                break;
                            }
                            _ => {}
                        }
                    }
                    op = ops_rx.recv() => {
                        match op {
                            Some(ChannelOp::Data(data)) => {
                                if let Err(e) = channel.data(&data[..]).await {
                                    tracing::warn!(error = %e, "ssh channel.data failed");
                                }
                            }
                            Some(ChannelOp::Resize { cols, rows }) => {
                                if let Err(e) = channel
                                    .window_change(cols as u32, rows as u32, 0, 0)
                                    .await
                                {
                                    tracing::warn!(error = %e, "ssh window_change failed");
                                }
                            }
                            Some(ChannelOp::Close) | None => {
                                let _ = channel.close().await;
                                closed_for_runner.store(true, Ordering::SeqCst);
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(Self {
            id,
            handle: Arc::new(Mutex::new(handle)),
            ops_tx,
            _runner: runner,
            closed,
        })
    }

    pub async fn write(&mut self, data: &[u8]) -> AetherResult<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(AetherError::SessionNotFound(self.id.clone()));
        }
        self.ops_tx
            .send(ChannelOp::Data(data.to_vec()))
            .await
            .map_err(|_| AetherError::Ssh("ssh i/o task is no longer running".into()))
    }

    pub async fn resize(&mut self, cols: u16, rows: u16) -> AetherResult<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.ops_tx
            .send(ChannelOp::Resize { cols, rows })
            .await
            .map_err(|_| AetherError::Ssh("ssh i/o task is no longer running".into()))
    }

    pub async fn close(&mut self) -> AetherResult<()> {
        self.closed.store(true, Ordering::SeqCst);
        // Best-effort signal to the runner; ignore errors if the task is gone.
        let _ = self.ops_tx.send(ChannelOp::Close).await;
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
