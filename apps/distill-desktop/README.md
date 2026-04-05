# distill-desktop

`distill-desktop` is the native Rust starter for the Distill desktop rebuild.

The current starter is intentionally desktop-first and read-only:

- native shell built with `Slint` on the `winit` backend
- reads an existing Distill Electron home in compatibility mode
- renders `Sessions`, `Logs`, and `DB` workbench views
- keeps all writes out of the Electron data directory

Planning and parity docs for the rebuild live under `docs/`.

## Current Scope

- macOS and Linux are first-class targets
- the shell defaults to `~/.distill-electron`
- override the source home with `DISTILL_ELECTRON_HOME=/path/to/home`
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

Run against a specific Distill Electron home:

```bash
DISTILL_ELECTRON_HOME="$HOME/.distill-electron" cargo run -p distill-desktop
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
