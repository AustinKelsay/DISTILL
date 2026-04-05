# distill-desktop

`distill-desktop` is the native Rust starter for the Distill desktop rebuild.

The current starter is intentionally desktop-first and engine-first:

- native shell built with `Slint` on the `winit` backend
- defaults to a Rust-owned Distill home and schema
- can open an existing Distill Electron home in explicit compatibility mode
- renders `Sessions`, `Logs`, and `DB` workbench views
- keeps all writes out of the Electron data directory in compatibility mode

Planning and parity docs for the rebuild live under `docs/`.

## Current Scope

- macOS and Linux are first-class targets
- the shell defaults to a Rust-owned app home under your local app data directory
- override the Rust app home with `DISTILL_DESKTOP_HOME=/path/to/home`
- switch to Electron compatibility mode with `DISTILL_SOURCE_MODE=electron_compat`
- override the Electron home with `DISTILL_ELECTRON_HOME=/path/to/.distill-electron`
- shell preferences are stored separately from the Electron app data
- write flows such as import, export mutation, and label/tag edits are not wired yet

## Layout

- `AGENTS.md`: desktop-local instructions for future work
- `docs/`: parity gap map, rebuild roadmap, and acceptance plan
- `src/app.rs`: bootstrap and path resolution
- `src/controller.rs`: synchronous UI orchestration, callbacks, and preferences
- `src/data/`: read-only SQLite and filesystem queries over Electron-compatible data
- `src/view_models.rs`: UI-facing state contracts
- `ui/shell.slint`: shell-level native workbench window
- `ui/sessions_pane.slint`, `ui/logs_pane.slint`, `ui/db_pane.slint`: route panes and stores
- `ui/components.slint`: shared Slint structs and reusable components
- `scripts/`: packaging helpers for macOS and Linux

## Commands

Run the desktop shell:

```bash
cargo run -p distill-desktop
```

Run in Electron compatibility mode against a specific Distill Electron home:

```bash
DISTILL_SOURCE_MODE=electron_compat DISTILL_ELECTRON_HOME="$HOME/.distill-electron" cargo run -p distill-desktop
```

Validate the starter:

```bash
cargo check -p distill-desktop
cargo test -p distill-desktop
```

## Packaging

Stage a macOS `.app` bundle:

```bash
apps/distill-desktop/scripts/build-macos.sh
```

Stage a Linux bundle and tarball:

```bash
apps/distill-desktop/scripts/build-linux.sh
```

Both scripts compile the release binary and write staged artifacts under `apps/distill-desktop/dist/`.
