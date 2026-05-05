use anyhow::Context;
use keyring::Entry;

const SERVICE: &str = "dev.aether.terminal";

fn entry(key: &str) -> anyhow::Result<Entry> {
    Entry::new(SERVICE, key).context("opening keyring entry")
}

pub fn set(key: &str, value: &str) -> anyhow::Result<()> {
    entry(key)?
        .set_password(value)
        .context("storing secret in keyring")
}

pub fn get(key: &str) -> anyhow::Result<Option<String>> {
    match entry(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e).context("reading secret from keyring"),
    }
}

pub fn delete(key: &str) -> anyhow::Result<()> {
    match entry(key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e).context("deleting secret"),
    }
}
