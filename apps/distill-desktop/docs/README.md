# Distill Desktop Docs

This directory is the planning and rebuild package for `apps/distill-desktop`.

It exists to answer one question clearly:

How does the Rust app get from a read-only scaffold to a real replacement for Distill Electron?

## Scope

These docs are authoritative for the Rust rebuild direction inside `apps/distill-desktop`.

They do not replace the Electron canonical docs as the definition of current product behavior. Instead:

- Electron docs define the behavior we are rebuilding toward
- desktop docs define the Rust-side roadmap, sequencing, and acceptance plan

## Read Order

Read these files in order:

1. `docs/plans/parity-gap-map.md`
2. `docs/roadmap/rebuild-roadmap.md`
3. `docs/testing/parity-acceptance-matrix.md`

Then read the Electron baseline docs when implementing a specific capability:

1. `../distill-electron/docs/specs/architecture.md`
2. `../distill-electron/docs/specs/data-model.md`
3. `../distill-electron/docs/specs/ingest-pipeline.md`
4. `../distill-electron/docs/specs/connectors.md`
5. `../distill-electron/docs/specs/search-curation-export.md`
6. `../distill-electron/docs/specs/activity-and-ops.md`
7. `../distill-electron/docs/testing/contract-test-matrix.md`

## Current Reality

The current Rust app is still a read-only shell:

- it opens an existing Distill Electron home
- it renders `Sessions`, `Logs`, and `DB`
- it does not yet import, curate, sync, export, or audit

That is useful scaffolding, but not product parity.

## Source Of Truth By Concern

- parity assessment: `docs/plans/parity-gap-map.md`
- staged implementation plan: `docs/roadmap/rebuild-roadmap.md`
- acceptance and test intent: `docs/testing/parity-acceptance-matrix.md`

## Working Rule

Keep rebuild planning and implementation inside `apps/distill-desktop` unless the user explicitly asks for coordinated Electron changes.
