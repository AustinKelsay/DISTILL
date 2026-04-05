# Distill Desktop Rebuild Roadmap

This document defines the staged plan for turning `apps/distill-desktop` into a real Rust replacement for Distill Electron.

## Strategy

The rebuild strategy is:

1. keep Electron stable as the working product
2. build the Rust engine to parity before chasing UI parity
3. keep rebuild docs and implementation inside `apps/distill-desktop`
4. use Electron canonical docs as the functional contract
5. prove each phase with executable acceptance tests before claiming parity

## Target Architecture

The target Rust app should separate concerns into a product engine and a thin native shell.

Recommended module or crate boundaries:

- `core`: canonical domain types and shared invariants
- `storage`: schema, migrations, repositories, and transaction boundaries
- `connectors`: source traits and source implementations
- `ingest`: discovery, snapshotting, raw persistence, dedupe, parsing, and projection replacement
- `query`: FTS, session read models, logs, and DB inspection
- `curation`: tag and label commands plus workflow derivation
- `export`: export eligibility, payload derivation, and file writing
- `ops`: jobs, activity events, sync orchestration, and health reporting
- `desktop-ui`: Slint bindings, controllers, and native shell concerns
- `cli`: operator and test harness entrypoints

The current single binary crate can remain in place while these boundaries are introduced incrementally.

## Phase 0: Lock The Rebuild Contract

Goal:

- establish the Rust-local planning and acceptance package

Outputs:

- desktop-local docs package
- parity gap map
- staged roadmap
- acceptance matrix

Exit criteria:

- future Rust work can reference desktop-local docs without mutating Electron docs

## Phase 1: Storage Ownership And Compatibility

Goal:

- make Rust capable of owning the canonical data model while still opening Electron-era data safely

Outputs:

- schema and migration strategy in Rust
- typed repository layer for canonical entities
- path and blob-store policy
- compatibility mode for existing Electron homes

Key decisions:

- whether Rust reuses the existing SQLite schema exactly at first or migrates to a Rust-owned versioned schema
- how blob paths and raw capture refs are represented on disk

Acceptance:

- Rust can open a fresh home and initialize the canonical schema
- Rust can open an existing Electron home in compatibility mode
- read/write boundaries are explicit and tested

## Phase 2: Connectors And Discovery

Goal:

- reproduce the canonical source boundary in Rust

Outputs:

- shared source connector trait
- `codex` connector
- `claude_code` connector
- `opencode` connector
- fixture-backed discovery and parsing tests

Acceptance:

- each connector passes a contract suite against the shared fixtures
- connector outputs match canonical shared shapes
- connector failures are isolated per source

## Phase 3: Snapshot, Raw Capture, And Ingest

Goal:

- make Rust own capture acceptance and projection replacement

Outputs:

- capture snapshotting
- Distill-owned raw content persistence
- dedupe before capture insertion
- capture-record persistence
- replace-on-success projection writes
- failure rollback behavior

Acceptance:

- exact duplicate re-imports are skipped
- changed captures append history and replace the current projection
- parse failures preserve prior projections
- raw captures are replayable from Rust-owned storage

## Phase 4: Query And Search Parity

Goal:

- make Rust capable of the same core read paths as Electron

Outputs:

- SQLite FTS indexing and query normalization
- session list and detail read models
- artifact linkage and provenance reads
- log and DB inspection parity

Acceptance:

- punctuation-heavy searches behave like the Electron spec
- search reflects only the current projection
- session detail exposes the full canonical metadata surface

## Phase 5: Manual Curation And Audit

Goal:

- make Rust capable of the same human review workflow as Electron

Outputs:

- tag add/remove commands
- label toggle commands
- dataset-label exclusivity enforcement
- workflow-state derivation
- activity event emission for curation changes

Acceptance:

- tag and label changes are durable and auditable
- conflicting dataset labels are resolved transactionally
- query read models reflect curation changes immediately

## Phase 6: Export And Operational Parity

Goal:

- make Rust able to produce canonical exports and own operational flows

Outputs:

- `train` and `holdout` export execution
- export bookkeeping rows
- turn-pair derivation
- sync job queue and sync lifecycle updates
- logs derived from jobs and exports
- activity events for sync and export behavior

Acceptance:

- export payloads match the current projection
- review-only sessions do not leak into standard exports
- sync lifecycle appears in jobs, logs, and activity with the correct separation of concerns

## Phase 7: Product Shell Replacement

Goal:

- replace the scaffold UI with a real product shell

Outputs:

- source discovery and sync surfaces
- curation workflows
- export workflows
- activity and ops views
- settings and health surfaces
- packaging and distribution flows

Rule:

- UI polish should follow working engine behavior, not precede it

Acceptance:

- a user can complete the canonical product loop from the Rust app alone
- Electron is no longer required for routine Distill use

## Phase 8: Cutover And Decommission Readiness

Goal:

- define the bar for treating Rust as the default app

Required cutover signals:

- all critical parity suites pass in Rust
- real-user smoke tests succeed on macOS and Linux
- import, curation, export, and recovery workflows are stable
- compatibility strategy for existing Electron homes is documented
- packaging and upgrade stories are defined

## Immediate Implementation Order

The first practical build sequence should be:

1. storage ownership plan and Rust migrations
2. connector trait plus one connector end-to-end
3. raw capture persistence
4. ingest transaction path
5. projection-backed query parity

This gets the engine moving without waiting on UI redesign.

## Non-Goals For Early Phases

- dramatic UI redesign before engine parity
- cloud sync
- hosted provider integrations
- semantic search
- mobile support
- multi-user workflows

## What We Start With Next

The next implementation branch should target one narrow vertical slice:

- initialize a Rust-owned Distill home
- detect and import one source kind end-to-end
- persist raw captures and projection rows
- expose the imported result in the existing desktop shell

That is the first point where the Rust app stops being just an Electron data viewer.
