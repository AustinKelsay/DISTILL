# Distill Desktop Parity Gap Map

This document maps the current Rust scaffold against the Electron canonical product behavior.

## Baseline

Electron remains the product baseline as defined by:

- `../../distill-electron/docs/specs/architecture.md`
- `../../distill-electron/docs/specs/data-model.md`
- `../../distill-electron/docs/specs/ingest-pipeline.md`
- `../../distill-electron/docs/specs/connectors.md`
- `../../distill-electron/docs/specs/search-curation-export.md`
- `../../distill-electron/docs/specs/activity-and-ops.md`
- `../../distill-electron/docs/testing/contract-test-matrix.md`

## Current Rust Coverage

The Rust app currently implements only a narrow read-only inspection layer:

- native desktop shell with `Slint` and `winit`
- read-only access to an existing Electron SQLite database
- session list and detail rendering
- logs rendering from existing jobs and exports
- DB browsing and guarded read-only SQL
- shell preference persistence

The Rust app does not currently own canonical Distill behavior.

## Gap Summary By Product Layer

## 1. Source Discovery

Electron baseline:

- detect supported source installations
- discover candidate captures independently per source
- continue across partial source failures

Rust status:

- missing

Required for parity:

- typed discovery model for `codex`, `claude_code`, and `opencode`
- local root detection
- capture enumeration
- source health/status reporting

## 2. Connectors

Electron baseline:

- four operations per connector: `detect`, `discoverCaptures`, `snapshotCapture`, `parseCapture`
- source-specific parsing rules with canonical shared outputs

Rust status:

- missing

Required for parity:

- Rust connector trait matching the Electron contract semantically
- connector implementations for `codex`, `claude_code`, and `opencode`
- shared parsed output types
- fixture-backed contract tests

## 3. Snapshot And Raw Capture Ownership

Electron baseline:

- Distill-owned raw capture persistence
- checksum and byte-size tracking
- recoverable inline/blob storage
- canonical dedupe key on `(source_kind, source_path, raw_sha256)`

Rust status:

- missing

Required for parity:

- canonical capture storage model in Rust
- blob store management
- replayable raw capture references
- snapshot failure handling without partial mutation

## 4. Ingest Pipeline And Projection Replacement

Electron baseline:

- append-only capture history
- append-only capture records
- replace-on-success session projection
- rollback-on-failure semantics
- deterministic session identity fallback when sources lack stable ids

Rust status:

- missing

Required for parity:

- ingest orchestrator
- normalization transaction boundary
- projection replacement for `sessions`, `messages`, and `artifacts`
- parse failure retention with prior projection intact

## 5. Canonical Storage Model

Electron baseline:

- `sources`
- `captures`
- `capture_records`
- `sessions`
- `messages`
- `artifacts`
- `tags` and `tag_assignments`
- `labels` and `label_assignments`
- `exports`
- `activity_events`
- `jobs`

Rust status:

- reads an existing Electron schema
- owns none of the schema lifecycle or writes

Required for parity:

- Rust schema ownership and migrations
- typed storage layer around the canonical entities
- compatibility path for opening Electron-era homes during migration

## 6. Search And Query

Electron baseline:

- SQLite FTS over the current materialized projection
- punctuation-safe query normalization
- query read models derived from current projection and manual curation state

Rust status:

- simple in-memory read-model filtering
- no FTS

Required for parity:

- FTS tables or equivalent SQLite-backed search indexes
- canonical token normalization behavior
- session list/detail queries sourced from the current projection only

## 7. Manual Curation

Electron baseline:

- manual session-level tags
- manual session-level labels
- dataset-label exclusivity
- workflow state derivation
- auditable curation changes

Rust status:

- displays existing labels and tags only
- no write paths

Required for parity:

- tag add/remove flows
- label toggle flows
- transactional exclusivity enforcement for dataset labels
- activity event emission for every curation change

## 8. Export

Electron baseline:

- standard dataset export for `train` and `holdout`
- export eligibility rules
- turn-pair derivation
- export bookkeeping

Rust status:

- missing

Required for parity:

- export planning and execution paths
- JSONL or equivalent export writers
- export row persistence
- export detail in logs and activity history

## 9. Activity And Operations

Electron baseline:

- append-only `activity_events`
- sync lifecycle audit
- operational `jobs`
- logs derived from jobs and exports

Rust status:

- reads existing jobs and exports as logs
- does not create activity or jobs

Required for parity:

- activity event writer
- sync job queue and state machine
- logs/query layer over Rust-owned jobs and exports

## 10. Desktop Product Shell

Electron baseline:

- full product workflow: discover, import, review, curate, export, inspect ops

Rust status:

- read-only workbench

Required for parity:

- source management and sync actions
- curation actions
- export actions
- failure and empty-state UX for real operations
- a redesigned desktop UI once engine parity starts to land

## What Counts As Parity

`distill-desktop` reaches parity only when it can replace Electron for the canonical local-first workflow:

`discover -> snapshot -> preserve -> normalize -> search -> curate -> export`

Read-only inspection alone does not count as parity.

## Immediate Conclusion

The next rebuild work should target the product engine, not the UI:

1. canonical Rust storage ownership
2. connectors and ingest
3. search and curation writes
4. export and operations
5. polished desktop UX on top of the working engine
