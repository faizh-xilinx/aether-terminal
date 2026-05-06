//! DPAPI-backed encrypted-file persistence for the Cursor token.
//!
//! The OS keyring is the *first* line of cross-launch persistence in
//! Aether, but on Windows the Credential Manager backend can silently fail
//! to round-trip secrets in a non-interactive process — we tolerate that
//! with an in-memory cache, but the cache evaporates the moment the user
//! quits Aether. This module gives us a deterministic Windows fallback by
//! writing the token to disk, encrypted with the user's DPAPI key.
//!
//! Threat model: data is decryptable only by the same Windows user
//! account on the same machine. That matches what `keyring` would
//! provide via Credential Manager in the happy path. It does not protect
//! against another process running as the same user (Windows itself
//! offers no equivalent boundary), and we don't claim to.
//!
//! On non-Windows targets every public function is a stub returning
//! `None`/`Ok(())` so the call sites stay portable.

#[cfg(windows)]
use std::path::PathBuf;

#[cfg(windows)]
const SESSION_FILE: &str = "session.bin";

/// Returns the absolute path of the encrypted session file. `None` only when
/// `dirs::config_dir()` is unavailable (extremely rare).
///
/// In tests, set `AETHER_SECRETS_DIR` to redirect the file to a per-test
/// temporary directory. This lets `secrets::tests` and `auth::tests` (which
/// both exercise `store`/`load`) run in parallel without racing on the
/// same real `%APPDATA%\Aether\session.bin`.
#[cfg(windows)]
fn session_path() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("AETHER_SECRETS_DIR") {
        return Some(PathBuf::from(custom).join(SESSION_FILE));
    }
    let mut p = dirs::config_dir()?;
    p.push("Aether");
    Some(p.join(SESSION_FILE))
}

#[cfg(windows)]
fn ensure_dir(path: &std::path::Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

/// Encrypt `plaintext` with DPAPI and persist to `%APPDATA%\Aether\session.bin`.
/// Overwrites any previous content. Idempotent.
pub fn store(plaintext: &str) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        use windows::Win32::Security::Cryptography::{
            CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        };

        let path = session_path().ok_or_else(|| anyhow::anyhow!("could not resolve config dir"))?;
        ensure_dir(&path)?;

        let input_bytes = plaintext.as_bytes().to_vec();
        // CRYPT_INTEGER_BLOB::pbData is *mut u8 by signature, but
        // CryptProtectData treats it as read-only — casting through
        // *mut u8 from a non-mut buffer is sound and saves a redundant
        // mut binding.
        let input = CRYPT_INTEGER_BLOB {
            cbData: input_bytes.len() as u32,
            pbData: input_bytes.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

        // Description shown by some DPAPI tools when the credential is
        // surfaced to the user. Keep it human-readable.
        let description: Vec<u16> = "Aether — Cursor API key\0".encode_utf16().collect();

        let result = unsafe {
            CryptProtectData(
                &input,
                PCWSTR(description.as_ptr()),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        result.map_err(|e| anyhow::anyhow!("CryptProtectData failed: {e}"))?;

        // Copy the encrypted bytes out, then return the LocalAlloc'd buffer
        // to Windows. Forgetting this leaks memory on every save.
        let encrypted =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe {
            let _ = LocalFree(HLOCAL(output.pbData as _));
        }

        std::fs::write(&path, encrypted)?;
        // Lock the file down to the current user only. On NTFS the default
        // ACL inherited from %APPDATA% already restricts to the user, but
        // belt-and-suspenders: explicit user-RW + everyone-deny would be
        // ideal here. We rely on the inherited ACL for 0.1.1; revisit if a
        // managed Windows config rewrites the parent ACL.
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = plaintext;
        Ok(())
    }
}

/// Decrypt and return the previously-stored plaintext, or `None` if no file
/// exists (i.e. user has never signed in on this machine, or signed out).
pub fn load() -> anyhow::Result<Option<String>> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        use windows::Win32::Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        };

        let path = session_path().ok_or_else(|| anyhow::anyhow!("could not resolve config dir"))?;
        if !path.exists() {
            return Ok(None);
        }
        let blob = std::fs::read(&path)?;
        if blob.is_empty() {
            return Ok(None);
        }

        let input = CRYPT_INTEGER_BLOB {
            cbData: blob.len() as u32,
            pbData: blob.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        let mut description_out: windows::core::PWSTR = windows::core::PWSTR::null();

        let result = unsafe {
            CryptUnprotectData(
                &input,
                Some(&mut description_out),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if let Err(e) = result {
            // A failed decrypt usually means the file came from a different
            // user account or was tampered with. Surface it as a soft error
            // rather than crashing — caller will fall back to other sources.
            tracing::warn!(error = %e, "DPAPI unprotect failed; ignoring stale session.bin");
            return Ok(None);
        }

        let plaintext =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe {
            let _ = LocalFree(HLOCAL(output.pbData as _));
            if !description_out.is_null() {
                let _ = LocalFree(HLOCAL(description_out.as_ptr() as _));
            }
        }

        Ok(Some(String::from_utf8(plaintext)?))
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

/// Module-level lock used by tests in both `secrets::tests` and
/// `auth::tests` to serialise parallel access to the singleton
/// `session.bin` file and the `AETHER_SECRETS_DIR` env override. Without
/// it, a parallel `cargo test` interleaves the two modules' tests and
/// they clobber each other's tokens.
#[cfg(test)]
pub(crate) static TEST_FILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Remove the encrypted session file, if it exists.
pub fn forget() -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        if let Some(path) = session_path() {
            if path.exists() {
                std::fs::remove_file(&path)?;
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// DPAPI round-trip: write, read back, delete. Redirects the session
    /// file into a unique temp dir so it can run in parallel with
    /// `auth::tests` without clobbering their shared file.
    #[test]
    fn round_trip_real_dpapi() {
        let _g = TEST_FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!(
            "aether-secrets-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("AETHER_SECRETS_DIR", &dir);

        // Test-isolated dir, so we know it starts empty.
        assert!(load().expect("initial load").is_none());

        store("crsr_dpapi_round_trip_marker_4711").expect("store");
        let read = load().expect("load").expect("Some token");
        assert_eq!(read, "crsr_dpapi_round_trip_marker_4711");

        forget().expect("post-test cleanup");
        assert!(load().expect("load after forget").is_none());

        std::env::remove_var("AETHER_SECRETS_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
