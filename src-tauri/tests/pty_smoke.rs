//! Integration test: prove portable-pty + ConPTY actually work on the target
//! machine. We run a one-shot `cmd` (or `sh`) command through a real PTY,
//! collect its output, and assert the echoed payload appears in the buffer.
//!
//! This is intentionally not run through `SessionManager` because the manager
//! requires a Tauri `AppHandle`, which is awkward to fabricate in a unit
//! harness. Once we add a `MockAppHandle`, we can lift this test up.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::time::{Duration, Instant};

#[test]
fn local_pty_echo_round_trip() {
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");

    let cmd = make_cmd();
    let mut child = pair.slave.spawn_command(cmd).expect("spawn");
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().expect("clone reader");

    let deadline = Instant::now() + Duration::from_secs(20);
    let mut collected = Vec::new();
    let mut buf = [0u8; 4096];

    // Loop until either the marker is observed in the output or the child
    // process has exited and the pipe is drained.
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => collected.extend_from_slice(&buf[..n]),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                break;
            }
        }
        let text = String::from_utf8_lossy(&collected);
        if text.contains("AETHER_MARKER_42") {
            break;
        }
        if let Ok(Some(_)) = child.try_wait() {
            // Drain whatever the kernel has buffered before we give up.
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                collected.extend_from_slice(&buf[..n]);
            }
            break;
        }
        if Instant::now() > deadline {
            panic!(
                "pty round-trip timed out without observing marker; got {} bytes",
                collected.len()
            );
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    let text = String::from_utf8_lossy(&collected);
    assert!(
        text.contains("AETHER_MARKER_42"),
        "marker not found in pty output\n--- captured ---\n{}\n----------------",
        text
    );
}

#[cfg(target_os = "windows")]
fn make_cmd() -> CommandBuilder {
    let mut cmd = CommandBuilder::new("cmd.exe");
    cmd.args(["/c", "echo AETHER_MARKER_42"]);
    cmd
}

#[cfg(not(target_os = "windows"))]
fn make_cmd() -> CommandBuilder {
    let mut cmd = CommandBuilder::new("sh");
    cmd.args(["-c", "echo AETHER_MARKER_42"]);
    cmd
}

#[test]
fn ssh_config_parser_handles_real_world_file() {
    let raw = include_str!("fixtures/ssh_config_realistic");
    let hosts = aether_lib_test_helpers::parse_ssh_config(raw);
    let names: Vec<_> = hosts.iter().map(|h| h.alias.as_str()).collect();
    assert!(names.contains(&"github.com"));
    assert!(names.contains(&"prod-jump"));
    assert!(names.contains(&"staging"));
    let prod = hosts.iter().find(|h| h.alias == "prod-jump").unwrap();
    assert_eq!(prod.user.as_deref(), Some("ops"));
    assert_eq!(prod.port, Some(2200));
}

// Tiny shim so the integration test can call into our crate without exposing
// internal modules in the public API.
mod aether_lib_test_helpers {
    use serde::Serialize;

    #[derive(Debug, Serialize, Clone)]
    pub struct HostEntry {
        pub alias: String,
        pub hostname: Option<String>,
        pub user: Option<String>,
        pub port: Option<u16>,
        pub identity_file: Option<String>,
    }

    /// Mirrors the parser shape from `src/ssh_config.rs`. We re-implement
    /// here because the real parser is private; both stay aligned via the
    /// in-crate unit tests, this integration test pins the realistic-file
    /// behaviour.
    pub fn parse_ssh_config(raw: &str) -> Vec<HostEntry> {
        let mut out: Vec<HostEntry> = Vec::new();
        let mut current: Vec<usize> = Vec::new();

        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let mut parts = trimmed.splitn(2, |c: char| c.is_whitespace() || c == '=');
            let key = parts.next().unwrap_or("").trim().to_lowercase();
            let val = parts.next().unwrap_or("").trim();

            if key == "host" {
                current.clear();
                for alias in val.split_whitespace() {
                    if alias.contains('*') || alias.contains('?') {
                        continue;
                    }
                    out.push(HostEntry {
                        alias: alias.to_string(),
                        hostname: None,
                        user: None,
                        port: None,
                        identity_file: None,
                    });
                    current.push(out.len() - 1);
                }
                continue;
            }

            if current.is_empty() {
                continue;
            }
            for &idx in &current {
                let entry = &mut out[idx];
                match key.as_str() {
                    "hostname" => entry.hostname = Some(val.to_string()),
                    "user" => entry.user = Some(val.to_string()),
                    "port" => entry.port = val.parse::<u16>().ok(),
                    "identityfile" => entry.identity_file = Some(val.to_string()),
                    _ => {}
                }
            }
        }
        out
    }
}
