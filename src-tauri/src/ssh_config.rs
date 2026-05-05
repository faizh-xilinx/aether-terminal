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
    let mut current: Option<HostEntry> = None;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let mut parts = trimmed.splitn(2, |c: char| c.is_whitespace() || c == '=');
        let key = parts.next().unwrap_or("").trim().to_lowercase();
        let val = parts.next().unwrap_or("").trim();

        if key == "host" {
            if let Some(prev) = current.take() {
                out.push(prev);
            }
            for alias in val.split_whitespace() {
                if alias == "*" {
                    continue;
                }
                current = Some(HostEntry {
                    alias: alias.to_string(),
                    hostname: None,
                    user: None,
                    port: None,
                    identity_file: None,
                });
            }
            continue;
        }

        let Some(entry) = current.as_mut() else { continue };
        match key.as_str() {
            "hostname" => entry.hostname = Some(val.to_string()),
            "user" => entry.user = Some(val.to_string()),
            "port" => entry.port = val.parse::<u16>().ok(),
            "identityfile" => entry.identity_file = Some(val.to_string()),
            _ => {}
        }
    }
    if let Some(last) = current.take() {
        out.push(last);
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
}
