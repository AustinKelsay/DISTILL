# Distill 0.2.0-beta.3

This is the third beta release of the Rust-first Distill rebuild, following
`v0.2.0-beta.2`.

## Scope delta over beta.2

- Fix Pi Source detection to be file-backed without an executable gate. Pi
  detection now requires only a configured sessions root (matching the Droid
  pattern), not the `pi` CLI on PATH. The beta.2 release incorrectly required
  the executable; this release removes that gate so Pi sessions are detected
  and synced purely from file-backed JSONL.
- Correct the second-beta release doc to reflect the file-backed detection
  model.

## Product boundary (unchanged from beta.1)

The beta ships the Rust Library, thin Rust CLI, Tauri 2 desktop host, and
React/TypeScript/Vite renderer. The old Electron/TypeScript product source is
retired and is not bundled or required. Legacy Electron homes remain supported as
read-only migration input through the native migration seam.

## Release artifacts

The tag workflow builds:

- macOS `.app` archive on `macos-14`
- Linux `.deb` and AppImage on Ubuntu 24.04
- Windows NSIS and MSI installers on `windows-latest`

Release builds never enable the smoke-only `VITE_DISTILL_SMOKE_DOM_ACTIVATE`
route. The Linux package smoke is a separate CI workflow and creates that flag only
in a temporary file before packaging.

## Verification

Before tagging, run:

```bash
npm ci
npm run release:check
npm run check:docs
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run desktop:typecheck
npm run desktop:lint
npm run desktop:format
npm run desktop:test
npm run desktop:frontend:build
```

## Signing and support boundaries (unchanged from beta.1)

The first-beta workflow intentionally builds an unsigned/ad-hoc macOS artifact;
Developer ID signing, hardened runtime, notarization, and ticket stapling are a
follow-up release gate rather than a beta claim. Windows installers are
build-verified but have no automated UI smoke claim in beta. The Windows MSI uses
the platform-only numeric Tauri version `0.2.0-3`, which WiX maps to package
version `0.2.0.3`; the release tag, release metadata, and artifact names
remain the canonical `0.2.0-beta.3` beta version. This mapping is kept in
`tauri.windows.beta.conf.json` and enforced by `npm run release:check`.
Screen-reader speech, live-user-home migration, and host-installed provider
behavior remain human or out-of-scope validation gates.
