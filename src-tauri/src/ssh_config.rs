use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct HostEntry {
    pub alias: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
}

pub fn config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("config"))
}

pub fn list_hosts() -> anyhow::Result<Vec<HostEntry>> {
    let Some(path) = config_path() else {
        return Ok(Vec::new());
    };
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = std::fs::read_to_string(&path)?;
    Ok(parse(&raw))
}

fn parse(raw: &str) -> Vec<HostEntry> {
    let mut out: Vec<HostEntry> = Vec::new();
    // Indices into `out` for the alias group currently being filled in.
    // OpenSSH semantics: `Host a b c` followed by options applies those
    // options to all three aliases.
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
                // Wildcard patterns (`*`, `*.example.com`, `host?`) are template
                // blocks in ssh_config and never represent a real connectable
                // host. Filter them so they don't appear in quick-connect.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_config() {
        let raw = r#"
            Host prod
                HostName 10.0.0.1
                User admin
                Port 2222
                IdentityFile ~/.ssh/id_ed25519

            Host staging dev
                HostName example.com
                User deploy
        "#;
        let hosts = parse(raw);
        assert_eq!(hosts.len(), 3);
        assert_eq!(hosts[0].alias, "prod");
        assert_eq!(hosts[0].hostname.as_deref(), Some("10.0.0.1"));
        assert_eq!(hosts[0].port, Some(2222));
        assert_eq!(hosts[1].alias, "staging");
        assert_eq!(hosts[2].alias, "dev");
    }

    #[test]
    fn skips_comments_and_blank_lines() {
        let raw = "
            # global comment

            Host one
                HostName example.com

            # another comment
        ";
        let hosts = parse(raw);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "one");
        assert_eq!(hosts[0].hostname.as_deref(), Some("example.com"));
    }

    #[test]
    fn handles_equals_separator() {
        // OpenSSH supports `Key=Value` syntax in addition to whitespace.
        let raw = "Host eq\n  HostName=eq.example.com\n  Port=2200\n";
        let hosts = parse(raw);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].hostname.as_deref(), Some("eq.example.com"));
        assert_eq!(hosts[0].port, Some(2200));
    }

    #[test]
    fn ignores_wildcard_host_block() {
        // The `Host *` block is template-only and should not surface as a
        // selectable entry in the quick-connect list.
        let raw = "
            Host *
                ServerAliveInterval 60

            Host real
                HostName real.example.com
        ";
        let hosts = parse(raw);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "real");
    }

    #[test]
    fn invalid_port_is_dropped_silently() {
        // Parsing should not panic on a malformed port value; we just leave
        // it None and let the connect step apply the default.
        let raw = "Host bad\n  HostName bad.example.com\n  Port not-a-number\n";
        let hosts = parse(raw);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].port, None);
    }

    #[test]
    fn unknown_keys_are_ignored() {
        let raw =
            "Host weird\n  HostName w.example.com\n  ServerAliveInterval 30\n  ForwardAgent yes\n";
        let hosts = parse(raw);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].hostname.as_deref(), Some("w.example.com"));
    }

    #[test]
    fn directive_is_case_insensitive() {
        let raw = "host UPPER\n  HOSTNAME upper.example.com\n  USER deploy\n";
        let hosts = parse(raw);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].user.as_deref(), Some("deploy"));
    }
}
