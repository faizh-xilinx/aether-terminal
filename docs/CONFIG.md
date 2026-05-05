# Configuration

Aether reads `%APPDATA%\Aether\config.toml` on startup. The file is created on first launch with sane defaults.

## Full reference

```toml
[appearance]
theme        = "midnight"        # midnight | monokai-pro | dracula | tokyo-night
font_family  = "JetBrains Mono"
font_size    = 13
line_height  = 1.25
ligatures    = true
opacity      = 0.96              # 0.0 - 1.0; 1.0 = opaque
cursor_style = "bar"             # bar | block | underline
cursor_blink = true

[ssh]
config_path  = "~/.ssh/config"
known_hosts  = "~/.ssh/known_hosts"
keepalive_s  = 30
default_port = 22

[terminal]
scrollback   = 10000
shell        = ""                # empty = OS default ($SHELL or COMSPEC)
copy_on_select = false

[ai]
enabled      = true
model        = "composer-2"
api_key_env  = "CURSOR_API_KEY"
include_scrollback_lines = 200   # lines of context shared with the agent

[hotkeys]
new_tab      = "Ctrl+T"
close_tab    = "Ctrl+W"
quick_connect = "Ctrl+K"
command_palette = "Ctrl+Shift+P"
toggle_ai    = "Ctrl+I"

[vault]
# Credentials are stored in the OS keyring (DPAPI on Windows, Keychain on macOS,
# libsecret on Linux). This file holds non-secret references only.

[[vault.entry]]
id          = "prod-db"
description = "Production DB jump host"
```

## Precedence

1. CLI flags (`--theme`, `--config`)
2. `%APPDATA%\Aether\config.toml`
3. Built-in defaults

## Migration

Aether tracks config version internally. Breaking changes ship with an `aether config migrate` command.
