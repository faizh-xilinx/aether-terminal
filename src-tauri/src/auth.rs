//! Cursor authentication.
//!
//! Aether supports three auth modes, ranked from best UX to fallback:
//!
//! 1. **Browser sign-in via `cursor-agent` CLI** — if the official CLI is on
//!    PATH, we shell out to `cursor-agent login`. The CLI opens the user's
//!    default browser and stores credentials in `~/.cursor/auth.json`. Aether
//!    then reads that file and copies the token into the OS keyring.
//! 2. **Browser sign-in + paste key** — if the CLI isn't installed, we open
//!    `https://cursor.com/dashboard/integrations` in the default browser. The
//!    user generates a key there and pastes it back into Aether. We validate
//!    by pinging the SDK, then store in the keyring.
//! 3. **`CURSOR_API_KEY` env var** — picked up implicitly by the SDK if no
//!    keyring-stored token exists.
//!
//! In all cases, the secret is persisted via `keyring` (DPAPI on Windows,
//! Keychain on macOS, libsecret on Linux). It is never written to the Aether
//! config file or to disk in plaintext.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::secrets;
use crate::vault;

const VAULT_KEY: &str = "cursor-token";

/// In-process token cache. Primary store; keyring is best-effort backup.
///
/// Why a memory cache: Windows Credential Manager (and a few Linux backends
/// in non-interactive sessions) accept a `set_password()` and then
/// immediately return `NoEntry` from `get_password()` — documented in
/// `vault::tests::keyring_round_trip`. Aether hit this exact bug in the
/// real app: a freshly-pasted token vanished on the very next call to
/// `active_token()`. The cache makes save → read deterministic for the
/// life of the process, while we still attempt keyring writes for
/// cross-launch persistence.
static TOKEN_CACHE: Mutex<Option<String>> = Mutex::new(None);

fn cache_get() -> Option<String> {
    TOKEN_CACHE.lock().ok().and_then(|g| g.clone())
}

fn cache_set(token: Option<String>) {
    if let Ok(mut g) = TOKEN_CACHE.lock() {
        *g = token;
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthStatus {
    pub authenticated: bool,
    /// Source of the active credential. Useful for the UI (e.g. show
    /// "Signed in via Cursor CLI" vs "Using stored API key").
    pub source: AuthSource,
    /// Whether the official `cursor-agent` CLI is detected on PATH.
    pub cli_available: bool,
    /// Path to the cursor-agent binary, if found.
    pub cli_path: Option<String>,
    /// True if an `auth.json` exists somewhere we know about (Cursor IDE,
    /// `cursor-agent` CLI). Aether will *not* auto-adopt it — the UI uses
    /// this flag to offer a one-click "Reuse IDE login".
    pub auth_json_available: bool,
    /// True if the on-disk auth.json appears to be a JWT session token
    /// (which the public SDK doesn't accept) rather than a `crsr_…` API key.
    /// Lets the UI warn before adopting.
    pub auth_json_is_session: bool,
    /// User identifier surfaced by the CLI / SDK, if known.
    pub user: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthSource {
    None,
    Keyring,
    EnvVar,
    CursorCli,
}

pub fn status() -> AuthStatus {
    let (cli_available, cli_path) = match find_cursor_cli() {
        Some(p) => (true, Some(p.display().to_string())),
        None => (false, None),
    };

    // Authenticated state is determined by an explicit sign-in source
    // only: the in-process cache, the OS keyring, or `CURSOR_API_KEY`.
    // The on-disk auth.json from Cursor IDE/CLI is a *candidate* the user
    // can opt into through the AuthDialog — never automatic — otherwise
    // sign-out would silently re-adopt it.
    let (authenticated, source, user) = if cache_get().is_some() {
        (true, AuthSource::Keyring, None)
    } else if let Ok(Some(_)) = vault::get(VAULT_KEY) {
        (true, AuthSource::Keyring, None)
    } else if std::env::var("CURSOR_API_KEY").is_ok() {
        (true, AuthSource::EnvVar, None)
    } else {
        (false, AuthSource::None, None)
    };

    // Probe for an existing auth.json without adopting it.
    let candidate = read_cursor_cli_token().ok().flatten();
    let auth_json_available = candidate.is_some();
    let auth_json_is_session = candidate
        .as_ref()
        .map(|t| !token_looks_like_api_key(&t.access_token))
        .unwrap_or(false);

    AuthStatus {
        authenticated,
        source,
        cli_available,
        cli_path,
        auth_json_available,
        auth_json_is_session,
        user: user.or_else(|| candidate.and_then(|t| t.user_email)),
    }
}

/// Returns the active token used by the SDK. Sources, in order:
/// in-process cache → keyring → `CURSOR_API_KEY`. The CLI / IDE
/// `auth.json` is reached via [`adopt_cli_token`] under user consent,
/// never automatically.
pub fn active_token() -> anyhow::Result<Option<String>> {
    if let Some(t) = cache_get() {
        return Ok(Some(t));
    }
    if let Some(t) = vault::get(VAULT_KEY)? {
        // Promote keyring hits into the cache so subsequent reads are O(1)
        // and so a flaky keyring backend can't drop us mid-session.
        cache_set(Some(t.clone()));
        return Ok(Some(t));
    }
    if let Ok(t) = std::env::var("CURSOR_API_KEY") {
        return Ok(Some(t));
    }
    Ok(None)
}

/// Returns true if the token looks like a Cursor public API key (`crsr_…`)
/// rather than a JWT-shaped session token. The official `@cursor/sdk` accepts
/// only the API-key shape — JWTs from `auth.json` (Cursor IDE / CLI session
/// tokens) make Agent.create throw an opaque `CursorAgentError("Error")`.
pub fn token_looks_like_api_key(token: &str) -> bool {
    let t = token.trim();
    // crsr_ keys are the documented public form. Service-account keys also
    // use this prefix. JWTs always start with "eyJ" (base64-encoded JSON).
    t.starts_with("crsr_") && !t.starts_with("eyJ")
}

pub fn save_token(token: &str) -> anyhow::Result<()> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        anyhow::bail!("empty token");
    }
    // 1. Cache (in-process, instant) — authoritative for this run.
    cache_set(Some(trimmed.to_string()));
    // 2. OS keyring (best-effort) — works on macOS / most Linux GUIs and
    //    on Windows when Credential Manager cooperates.
    if let Err(e) = vault::set(VAULT_KEY, trimmed) {
        tracing::warn!(error = %e, "keyring write failed, falling back to encrypted file");
    }
    // 3. DPAPI-encrypted session.bin — deterministic Windows persistence;
    //    a no-op on other platforms. Even when the keyring drops the
    //    secret, this lets the next Aether launch hydrate the cache
    //    transparently.
    if let Err(e) = secrets::store(trimmed) {
        tracing::warn!(error = %e, "encrypted session file write failed");
    }
    Ok(())
}

pub fn forget_token() -> anyhow::Result<()> {
    cache_set(None);
    if let Err(e) = vault::delete(VAULT_KEY) {
        tracing::warn!(error = %e, "keyring delete failed (cache already cleared)");
    }
    if let Err(e) = secrets::forget() {
        tracing::warn!(error = %e, "could not delete encrypted session file");
    }
    Ok(())
}

/// Pulls any persisted token off disk and into the in-process cache.
/// Returns `Ok(true)` if a token was loaded, `Ok(false)` if no stored
/// session exists. Called once during Tauri's setup hook.
pub fn hydrate_from_disk() -> anyhow::Result<bool> {
    if cache_get().is_some() {
        return Ok(true);
    }
    if let Some(t) = secrets::load()? {
        cache_set(Some(t));
        return Ok(true);
    }
    if let Some(t) = vault::get(VAULT_KEY).ok().flatten() {
        cache_set(Some(t));
        return Ok(true);
    }
    Ok(false)
}

/// Spawn the `cursor-agent login` browser flow and wait for it to exit. Does
/// NOT capture or return the token — `auth.json` becomes the source of truth
/// once the flow completes.
pub async fn run_cli_login() -> anyhow::Result<()> {
    let Some(path) = find_cursor_cli() else {
        anyhow::bail!("cursor-agent CLI not found on PATH");
    };
    let status = Command::new(path)
        .arg("login")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .context("spawning cursor-agent login")?;
    if !status.success() {
        anyhow::bail!(
            "cursor-agent login exited with code {}",
            status.code().unwrap_or(-1)
        );
    }
    Ok(())
}

/// Adopts the credential currently held by `cursor-agent` (i.e. read
/// `~/.cursor/auth.json`) and writes it into Aether's keyring so it persists
/// even if the CLI is uninstalled or its file is rotated.
pub fn adopt_cli_token() -> anyhow::Result<bool> {
    let Some(token) = read_cursor_cli_token()? else {
        return Ok(false);
    };
    save_token(&token.access_token)?;
    Ok(true)
}

#[derive(Debug, Clone)]
pub struct CliToken {
    pub access_token: String,
    pub user_email: Option<String>,
}

/// Every well-known location an `auth.json` may live in, on the host OS.
///
/// The official cursor.com docs reference `~/.cursor/auth.json` for the CLI,
/// but the **Cursor IDE** itself stores the same shape file at
/// `%APPDATA%\Cursor\auth.json` on Windows (capital "C", under
/// AppData\Roaming, not the dot-prefixed cursor-agent dir). When a user is
/// already signed in to the IDE we want to seamlessly reuse that token
/// instead of forcing them through `cursor-agent login` again.
fn auth_json_candidates() -> Vec<PathBuf> {
    // When `CURSOR_CONFIG_DIR` is explicitly set, treat it as a hard
    // override — useful for tests and for power users who want a custom
    // home. We deliberately skip the well-known locations in that case so
    // the override is total.
    if let Ok(custom) = std::env::var("CURSOR_CONFIG_DIR") {
        return vec![PathBuf::from(custom).join("auth.json")];
    }

    let mut out: Vec<PathBuf> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        out.push(home.join(".cursor").join("auth.json"));
        out.push(home.join(".cursor-agent").join("auth.json"));
        out.push(home.join(".config").join("cursor-agent").join("auth.json"));
    }

    if cfg!(windows) {
        if let Ok(roaming) = std::env::var("APPDATA") {
            out.push(PathBuf::from(&roaming).join("Cursor").join("auth.json"));
            out.push(
                PathBuf::from(&roaming)
                    .join("cursor-agent")
                    .join("auth.json"),
            );
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            out.push(PathBuf::from(&local).join("cursor-agent").join("auth.json"));
            out.push(PathBuf::from(&local).join("Cursor").join("auth.json"));
        }
    }

    if cfg!(target_os = "macos") {
        if let Some(home) = dirs::home_dir() {
            out.push(
                home.join("Library")
                    .join("Application Support")
                    .join("Cursor")
                    .join("auth.json"),
            );
            out.push(
                home.join("Library")
                    .join("Application Support")
                    .join("cursor-agent")
                    .join("auth.json"),
            );
        }
    }

    // De-dupe while preserving order.
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| seen.insert(p.clone()));
    out
}

pub fn read_cursor_cli_token() -> anyhow::Result<Option<CliToken>> {
    // Pick the most recently-modified auth.json among all known locations.
    // Falls back to the first existing one if mtimes can't be read. This
    // lets us reuse a freshly-completed CLI login over a stale IDE login,
    // and vice-versa.
    let candidates = auth_json_candidates();
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
    for path in &candidates {
        if !path.exists() {
            continue;
        }
        let mtime = std::fs::metadata(path)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        match &best {
            None => best = Some((path.clone(), mtime)),
            Some((_, t)) if mtime > *t => best = Some((path.clone(), mtime)),
            _ => {}
        }
    }
    let Some((path, _)) = best else {
        tracing::debug!("no auth.json found in any well-known location");
        return Ok(None);
    };

    tracing::info!(path = %path.display(), "reading cursor auth.json");
    let raw =
        std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).with_context(|| format!("parsing {}", path.display()))?;

    // The file format is not officially stable; probe a few likely fields.
    let access_token = ["accessToken", "access_token", "apiKey", "api_key", "token"]
        .into_iter()
        .find_map(|k| value.get(k).and_then(|v| v.as_str()))
        .map(|s| s.to_string());

    let user_email = ["email", "userEmail", "user_email"]
        .into_iter()
        .find_map(|k| value.get(k).and_then(|v| v.as_str()))
        .or_else(|| {
            value
                .get("user")
                .and_then(|u| u.get("email"))
                .and_then(|v| v.as_str())
        })
        .map(|s| s.to_string());

    Ok(access_token.map(|access_token| CliToken {
        access_token,
        user_email,
    }))
}

fn find_cursor_cli() -> Option<PathBuf> {
    for cmd in ["cursor-agent", "agent", "cursor-agent.exe", "agent.exe"] {
        if let Ok(out) = std::process::Command::new(if cfg!(windows) { "where" } else { "which" })
            .arg(cmd)
            .output()
        {
            if out.status.success() {
                if let Some(line) = String::from_utf8_lossy(&out.stdout).lines().next() {
                    let p = PathBuf::from(line.trim());
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
    }

    // Fall back to the well-known install locations the official installer
    // writes to. PATH may not have been refreshed in Aether's process yet.
    if let Some(home) = dirs::home_dir() {
        let unix = home.join(".local").join("bin").join("agent");
        if unix.exists() {
            return Some(unix);
        }
    }
    if cfg!(windows) {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            // Order matches the official Cursor install script's actual
            // layout (`%LOCALAPPDATA%\cursor-agent\agent.exe`, no /bin
            // subdirectory) plus a few alternate locations from older
            // distributions / community ports.
            for sub in [
                "cursor-agent\\agent.exe",
                "cursor-agent\\cursor-agent.exe",
                "cursor-agent\\bin\\agent.exe",
                "Programs\\cursor-cli\\agent.exe",
                "Programs\\cursor-agent\\agent.exe",
            ] {
                let p = std::path::Path::new(&local).join(sub);
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }

    None
}

/// Public re-export so command handlers can use the same detection as
/// `status()`.
pub fn find_cursor_cli_public() -> Option<PathBuf> {
    find_cursor_cli()
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests share `CURSOR_CONFIG_DIR` (a process-global env var) so they
    // must not run in parallel. We serialise them with a mutex.
    use std::sync::Mutex;
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn tempdir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("aether-auth-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn with_cursor_dir<F: FnOnce()>(json: Option<&str>, f: F) {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempdir();
        if let Some(j) = json {
            std::fs::write(dir.join("auth.json"), j).unwrap();
        }
        std::env::set_var("CURSOR_CONFIG_DIR", &dir);
        let prev_api_key = std::env::var("CURSOR_API_KEY").ok();
        std::env::remove_var("CURSOR_API_KEY");
        f();
        std::env::remove_var("CURSOR_CONFIG_DIR");
        if let Some(k) = prev_api_key {
            std::env::set_var("CURSOR_API_KEY", k);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_access_token_and_email() {
        with_cursor_dir(
            Some(r#"{"accessToken":"crsr_abc","email":"me@example.com"}"#),
            || {
                let token = read_cursor_cli_token().unwrap().unwrap();
                assert_eq!(token.access_token, "crsr_abc");
                assert_eq!(token.user_email.as_deref(), Some("me@example.com"));
            },
        );
    }

    #[test]
    fn parses_snake_case_field_variants() {
        with_cursor_dir(
            Some(r#"{"access_token":"crsr_xyz","user_email":"u@e.com"}"#),
            || {
                let token = read_cursor_cli_token().unwrap().unwrap();
                assert_eq!(token.access_token, "crsr_xyz");
                assert_eq!(token.user_email.as_deref(), Some("u@e.com"));
            },
        );
    }

    #[test]
    fn parses_nested_user_email() {
        with_cursor_dir(
            Some(r#"{"apiKey":"crsr_nested","user":{"email":"nested@e.com"}}"#),
            || {
                let token = read_cursor_cli_token().unwrap().unwrap();
                assert_eq!(token.access_token, "crsr_nested");
                assert_eq!(token.user_email.as_deref(), Some("nested@e.com"));
            },
        );
    }

    #[test]
    fn missing_auth_json_returns_none() {
        with_cursor_dir(None, || {
            assert!(read_cursor_cli_token().unwrap().is_none());
        });
    }

    #[test]
    fn malformed_auth_json_returns_error() {
        with_cursor_dir(Some("not json at all"), || {
            assert!(read_cursor_cli_token().is_err());
        });
    }

    #[test]
    fn json_without_token_field_returns_none() {
        with_cursor_dir(Some(r#"{"foo":"bar"}"#), || {
            assert!(read_cursor_cli_token().unwrap().is_none());
        });
    }

    #[test]
    fn active_token_priority_falls_back_to_env_var() {
        // If keyring is empty and there is no auth.json, env var wins.
        // (We can't reliably stub the keyring in a unit test; we trust that
        // `vault::get` returns None for an unused key. The keyring step is
        // exercised in the integration tests.)
        let _g = ENV_LOCK.lock().unwrap();
        cache_set(None); // ensure cache doesn't leak from a prior test
        let dir = tempdir();
        std::env::set_var("CURSOR_CONFIG_DIR", &dir);
        std::env::set_var("CURSOR_API_KEY", "env-only-key");
        let active = active_token().unwrap();
        std::env::remove_var("CURSOR_CONFIG_DIR");
        std::env::remove_var("CURSOR_API_KEY");
        cache_set(None);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(active.as_deref(), Some("env-only-key"));
    }

    #[test]
    fn save_token_makes_active_token_round_trip_via_cache() {
        // The Windows Credential Manager backend can be flaky; this test
        // pins the behaviour that survives that flakiness — save_token
        // populates the in-process cache so active_token() always returns
        // the just-saved value, even when the keyring read silently fails.
        let _g = ENV_LOCK.lock().unwrap();
        cache_set(None);
        std::env::remove_var("CURSOR_API_KEY");

        save_token("crsr_round_trip_test").expect("save_token");
        let active = active_token().expect("active_token");
        assert_eq!(active.as_deref(), Some("crsr_round_trip_test"));

        forget_token().expect("forget_token");
        let after_forget = active_token().expect("active_token after forget");
        // Cache is cleared by forget_token; in test env neither keyring
        // nor env var holds a token, so it should be None.
        cache_set(None);
        assert!(after_forget.is_none() || after_forget.as_deref() == Some(""));
    }

    #[test]
    fn token_looks_like_api_key_recognises_real_shapes() {
        assert!(token_looks_like_api_key("crsr_abc123"));
        assert!(token_looks_like_api_key(
            "crsr_long_key_with_underscores_AND_uppercase_99"
        ));
        // JWTs from auth.json must be rejected.
        assert!(!token_looks_like_api_key(
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig"
        ));
        // Random strings, empty, whitespace.
        assert!(!token_looks_like_api_key("not-an-api-key"));
        assert!(!token_looks_like_api_key(""));
        assert!(!token_looks_like_api_key("   "));
    }
}
