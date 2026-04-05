# distill Agent Instructions

This repository is the umbrella monorepo for Distill desktop products.

## Repo Layout

- `apps/distill-electron`: the current Electron application
- `apps/distill-desktop`: the Rust rewrite scaffold

## Canonical Docs

For Electron app work, the authoritative docs and instructions live under:

1. `apps/distill-electron/AGENTS.md`
2. `apps/distill-electron/docs/README.md`

Do not infer Electron behavior from implementation files before reading that app-local docs package.

There is no canonical product spec package yet for `apps/distill-desktop`; treat it as scaffold-only unless new docs are added.
