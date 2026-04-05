# Distill Desktop Agent Instructions

This file is authoritative for work inside `apps/distill-desktop`.

## First Rule

Do not treat the current Rust implementation as product truth. It is still a scaffold.

When planning or implementing parity work, read this package first:

1. `docs/README.md`
2. `docs/plans/parity-gap-map.md`
3. `docs/roadmap/rebuild-roadmap.md`
4. `docs/testing/parity-acceptance-matrix.md`

Then use the Electron canonical docs as the functional baseline:

1. `../distill-electron/docs/specs/architecture.md`
2. `../distill-electron/docs/specs/data-model.md`
3. `../distill-electron/docs/specs/ingest-pipeline.md`
4. `../distill-electron/docs/specs/connectors.md`
5. `../distill-electron/docs/specs/search-curation-export.md`
6. `../distill-electron/docs/specs/activity-and-ops.md`
7. `../distill-electron/docs/testing/contract-test-matrix.md`

## Intent

`distill-desktop` is a Rust rebuild toward Electron functional parity.

Current intent:

- keep Electron stable as the source of shipped behavior
- keep rebuild planning and implementation self-contained under `apps/distill-desktop`
- avoid opportunistic edits to `apps/distill-electron` unless the user explicitly asks for cross-app work
- prefer engine parity over UI polish in early phases

## Source Of Truth

For Rust rebuild direction:

- the docs package under `apps/distill-desktop/docs/` is authoritative

For current shipped product behavior:

- the Electron canonical docs remain the baseline authority

If Rust docs and current Rust code differ, the docs describe the intended rebuild target and the code describes the current scaffold.

## Change Rules

For behavior-changing desktop work:

1. update the relevant file under `apps/distill-desktop/docs/`
2. update or add executable tests for the claimed contract
3. keep parity language tied to the Electron canonical docs
4. do not redefine Electron behavior locally without calling out the divergence explicitly

## Architecture Bias

Default bias for the rebuild:

- Rust core first
- native desktop shell second
- thin UI over typed read/write interfaces
- no WebView dependency
- no dependence on Electron internals for the long-term architecture

## What Not To Do

- do not patch Electron docs just to describe Rust planning
- do not claim parity from read-only inspection features
- do not let temporary UI scaffolding define the product architecture
- do not add speculative cloud or multi-user scope that is outside the Electron canonical docs
