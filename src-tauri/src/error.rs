use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AetherError {
    #[error("session not found: {0}")]
    SessionNotFound(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("pty error: {0}")]
    Pty(String),

    #[error("ssh error: {0}")]
    Ssh(String),

    #[error("ssh auth failed for user '{user}'")]
    SshAuth { user: String },

    #[error("config error: {0}")]
    Config(String),

    #[error("vault error: {0}")]
    Vault(String),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl From<russh::Error> for AetherError {
    fn from(e: russh::Error) -> Self {
        AetherError::Ssh(e.to_string())
    }
}

impl From<russh_keys::Error> for AetherError {
    fn from(e: russh_keys::Error) -> Self {
        AetherError::Ssh(e.to_string())
    }
}

impl Serialize for AetherError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AetherResult<T> = std::result::Result<T, AetherError>;
