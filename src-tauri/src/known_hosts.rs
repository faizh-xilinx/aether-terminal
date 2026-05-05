use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use anyhow::Context;
use russh_keys::key::PublicKey;
use russh_keys::PublicKeyBase64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostKeyDecision {
    /// Host is in `known_hosts` and the key matches. Connection allowed.
    Match,
    /// Host is not in `known_hosts`. Caller must prompt for trust-on-first-use.
    Unknown,
    /// Host is in `known_hosts` but the presented key does NOT match the
    /// stored key. This is a potential MITM and the connection MUST be aborted
    /// without further user prompting except a clear warning.
    Mismatch { stored_type: String },
}

pub fn known_hosts_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("known_hosts"))
}

pub fn check(host: &str, port: u16, presented: &PublicKey) -> anyhow::Result<HostKeyDecision> {
    let Some(path) = known_hosts_path() else {
        return Ok(HostKeyDecision::Unknown);
    };
    if !path.exists() {
        return Ok(HostKeyDecision::Unknown);
    }
    let raw = std::fs::read_to_string(&path).context("reading known_hosts")?;
    let entries = parse(&raw);

    let lookup_keys = host_lookup_keys(host, port);
    let presented_b64 = presented.public_key_base64();
    let presented_type = presented.name().to_string();

    let mut stored_type_for_mismatch: Option<String> = None;
    for entry in &entries {
        if !lookup_keys.iter().any(|k| matches_pattern(&entry.host, k)) {
            continue;
        }
        if entry.key_type == presented_type && entry.key_b64 == presented_b64 {
            return Ok(HostKeyDecision::Match);
        }
        stored_type_for_mismatch = Some(entry.key_type.clone());
    }

    if let Some(t) = stored_type_for_mismatch {
        Ok(HostKeyDecision::Mismatch { stored_type: t })
    } else {
        Ok(HostKeyDecision::Unknown)
    }
}

pub fn add(host: &str, port: u16, key: &PublicKey) -> anyhow::Result<()> {
    let Some(path) = known_hosts_path() else {
        anyhow::bail!("no home directory; cannot persist known_hosts");
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let host_token = if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    };
    let line = format!(
        "{host_token} {kt} {kb}\n",
        kt = key.name(),
        kb = key.public_key_base64()
    );

    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .context("opening known_hosts for append")?;
    f.write_all(line.as_bytes())
        .context("writing known_hosts entry")?;
    Ok(())
}

#[derive(Debug)]
struct Entry {
    host: String,
    key_type: String,
    key_b64: String,
}

fn parse(raw: &str) -> Vec<Entry> {
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let host = parts.next();
        let kt = parts.next();
        let kb = parts.next();
        if let (Some(h), Some(t), Some(b)) = (host, kt, kb) {
            // Skip hashed entries (`|1|...`); we don't support them yet.
            if h.starts_with("|1|") {
                continue;
            }
            for h in h.split(',') {
                out.push(Entry {
                    host: h.to_string(),
                    key_type: t.to_string(),
                    key_b64: b.to_string(),
                });
            }
        }
    }
    out
}

fn host_lookup_keys(host: &str, port: u16) -> Vec<String> {
    let mut keys = Vec::with_capacity(2);
    if port == 22 {
        keys.push(host.to_string());
    }
    keys.push(format!("[{host}]:{port}"));
    keys
}

fn matches_pattern(pattern: &str, host: &str) -> bool {
    if pattern == host {
        return true;
    }
    if pattern.contains('*') || pattern.contains('?') {
        let regex = pattern
            .chars()
            .map(|c| match c {
                '*' => ".*".to_string(),
                '?' => ".".to_string(),
                '.' => "\\.".to_string(),
                ch => regex_quote(ch),
            })
            .collect::<String>();
        if let Ok(re) = regex_lite::Regex::new(&format!("^{}$", regex)) {
            return re.is_match(host);
        }
    }
    false
}

fn regex_quote(c: char) -> String {
    if "[](){}+\\^$|".contains(c) {
        format!("\\{c}")
    } else {
        c.to_string()
    }
}

// Inline mini-regex implementation so we don't pull in a heavy `regex` dep
// for what is essentially globbing. Supports `^...$` anchors, `.`, `.*`, and
// `\\<char>` literal escapes.
mod regex_lite {
    pub struct Regex(String);
    impl Regex {
        pub fn new(pattern: &str) -> Result<Self, ()> {
            Ok(Regex(pattern.to_string()))
        }
        pub fn is_match(&self, s: &str) -> bool {
            let pat = self.0.trim_start_matches('^').trim_end_matches('$');
            match_glob(pat, s)
        }
    }

    fn match_glob(pat: &str, s: &str) -> bool {
        let pb: Vec<char> = pat.chars().collect();
        let sb: Vec<char> = s.chars().collect();
        match_glob_inner(&pb, 0, &sb, 0)
    }

    fn match_glob_inner(pat: &[char], pi: usize, s: &[char], si: usize) -> bool {
        if pi == pat.len() {
            return si == s.len();
        }
        let c = pat[pi];
        if c == '\\' && pi + 1 < pat.len() {
            if si < s.len() && pat[pi + 1] == s[si] {
                return match_glob_inner(pat, pi + 2, s, si + 1);
            }
            return false;
        }
        if c == '.' && pi + 1 < pat.len() && pat[pi + 1] == '*' {
            for i in si..=s.len() {
                if match_glob_inner(pat, pi + 2, s, i) {
                    return true;
                }
            }
            return false;
        }
        if c == '.' {
            if si < s.len() {
                return match_glob_inner(pat, pi + 1, s, si + 1);
            }
            return false;
        }
        if si < s.len() && pat[pi] == s[si] {
            return match_glob_inner(pat, pi + 1, s, si + 1);
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_hosts() {
        let raw = "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n# comment\n[10.0.0.1]:2222 ssh-rsa AAAA\n";
        let e = parse(raw);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].host, "github.com");
        assert_eq!(e[1].host, "[10.0.0.1]:2222");
    }

    #[test]
    fn pattern_match_simple() {
        assert!(matches_pattern("github.com", "github.com"));
        assert!(!matches_pattern("github.com", "gist.github.com"));
        assert!(matches_pattern("*.github.com", "gist.github.com"));
        assert!(!matches_pattern("*.github.com", "evil.com"));
    }
}
