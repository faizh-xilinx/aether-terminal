use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::error::{AetherError, AetherResult};

struct PendingRequest {
    tx: oneshot::Sender<Result<Value, String>>,
}

#[derive(Clone)]
pub struct AiBridge {
    app: AppHandle,
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
    pending: Arc<Mutex<std::collections::HashMap<String, PendingRequest>>>,
    _child: Arc<tokio::sync::Mutex<Child>>,
}

impl AiBridge {
    pub async fn spawn(app: AppHandle, sidecar_dir: PathBuf) -> AetherResult<Self> {
        let entry = sidecar_dir.join("dist").join("index.js");
        if !entry.exists() {
            return Err(AetherError::Other(anyhow::anyhow!(
                "sidecar entry not found at {} \u{2014} run `npm --prefix sidecar run build`",
                entry.display()
            )));
        }

        let mut cmd = Command::new("node");
        cmd.arg(entry)
            .current_dir(&sidecar_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        if let Ok(key) = std::env::var("CURSOR_API_KEY") {
            cmd.env("CURSOR_API_KEY", key);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| AetherError::Other(anyhow::anyhow!("spawn sidecar: {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AetherError::Other(anyhow::anyhow!("no stdin on sidecar")))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AetherError::Other(anyhow::anyhow!("no stdout on sidecar")))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AetherError::Other(anyhow::anyhow!("no stderr on sidecar")))?;

        let pending: Arc<Mutex<std::collections::HashMap<String, PendingRequest>>> =
            Arc::new(Mutex::new(std::collections::HashMap::new()));

        let pending_for_reader = pending.clone();
        let app_for_reader = app.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    tracing::warn!(?line, "invalid sidecar frame");
                    continue;
                };
                if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
                    if let Some(req) = pending_for_reader.lock().remove(id) {
                        if let Some(err) = value.get("error") {
                            let _ = req.tx.send(Err(err.to_string()));
                        } else {
                            let _ = req.tx.send(Ok(value
                                .get("result")
                                .cloned()
                                .unwrap_or(Value::Null)));
                        }
                    }
                } else if let Some(event_kind) =
                    value.get("event").and_then(|v| v.as_str())
                {
                    let _ = app_for_reader.emit(&format!("ai:{event_kind}"), value);
                }
            }
            tracing::info!("sidecar stdout closed");
        });

        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                tracing::info!(target: "sidecar", "{line}");
            }
        });

        Ok(Self {
            app,
            stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
            pending,
            _child: Arc::new(tokio::sync::Mutex::new(child)),
        })
    }

    pub async fn rpc(&self, method: &str, params: Value) -> AetherResult<Value> {
        let id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .insert(id.clone(), PendingRequest { tx });

        let frame = json!({ "id": id, "method": method, "params": params });
        let line = serde_json::to_string(&frame)
            .map_err(|e| AetherError::Other(anyhow::anyhow!(e)))?;

        {
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(AetherError::Io)?;
            stdin.write_all(b"\n").await.map_err(AetherError::Io)?;
            stdin.flush().await.map_err(AetherError::Io)?;
        }

        match rx.await {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(msg)) => Err(AetherError::Other(anyhow::anyhow!(msg))),
            Err(_) => Err(AetherError::Other(anyhow::anyhow!(
                "sidecar dropped response channel"
            ))),
        }
    }

    pub async fn create_agent(
        &self,
        cwd: Option<String>,
        model: Option<String>,
        api_key: Option<String>,
    ) -> AetherResult<String> {
        let mut params = json!({});
        if let Some(c) = cwd {
            params["cwd"] = json!(c);
        }
        if let Some(m) = model {
            params["model"] = json!(m);
        }
        if let Some(k) = api_key {
            params["apiKey"] = json!(k);
        }
        let result = self.rpc("agent.create", params).await?;
        Ok(result
            .get("agentId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string())
    }

    pub async fn send(&self, agent_id: &str, prompt: &str) -> AetherResult<Value> {
        self.rpc("agent.send", json!({ "agentId": agent_id, "prompt": prompt }))
            .await
    }

    pub async fn dispose(&self, agent_id: &str) -> AetherResult<()> {
        self.rpc("agent.dispose", json!({ "agentId": agent_id }))
            .await?;
        Ok(())
    }

    /// Lazy ping just to verify the sidecar is alive and replying.
    pub async fn ping(&self) -> AetherResult<()> {
        self.rpc("ping", json!({})).await?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn app(&self) -> &AppHandle {
        &self.app
    }
}
