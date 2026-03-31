# Distill Implementation Map

This file is informative. It describes the current TypeScript/Electron implementation and how it maps to the canonical specs under `docs/`.

Start with the canonical architecture here:

- [docs/specs/architecture.md](docs/specs/architecture.md)

## Current Runtime

- desktop shell: Electron
- application code: TypeScript
- local data layer: SQLite

## Current Module Map

### Connectors

- `src/connectors/index.ts`
- `src/connectors/codex/*`
- `src/connectors/claude_code/*`
- `src/connectors/opencode/*`

These modules implement the current source-specific logic for detect, discover, snapshot, and parse behavior.

Canonical reference:

- [docs/specs/connectors.md](docs/specs/connectors.md)

### Import And Storage

- `src/distill/import.ts`
- `src/distill/db.ts`
- `schema.sql`

These modules implement the current importer, database helpers, and SQLite schema.

Canonical references:

- [docs/specs/data-model.md](docs/specs/data-model.md)
- [docs/specs/ingest-pipeline.md](docs/specs/ingest-pipeline.md)

### Query, Curation, And Export

- `src/distill/query.ts`
- `src/distill/curation.ts`
- `src/distill/export.ts`

Canonical reference:

- [docs/specs/search-curation-export.md](docs/specs/search-curation-export.md)

### Operations

- `src/distill/jobs.ts`
- `src/distill/logs.ts`
- `src/electron/main.ts`
- `src/electron/preload.ts`
- `src/renderer/app.ts`

Canonical reference:

- [docs/specs/activity-and-ops.md](docs/specs/activity-and-ops.md)

### Tests

- `src/test/*.test.ts`

Current tests primarily validate current implementation behavior. The canonical contract-test plan lives in [docs/testing/contract-test-matrix.md](docs/testing/contract-test-matrix.md).

## Current Behavior Notes

The current code already has a solid connector boundary and a working normalized import spine, but several canonical rules are not yet implemented.

Important current gaps:

- raw capture contents are not yet persisted into Distill-owned recoverable storage
- projection semantics are implemented implicitly rather than as a first-class model
- `activity_events` coverage is incomplete
- manual curation is not yet auditable
- jobs and logs currently carry some behavior that the canonical docs classify as operational rather than authoritative

See [docs/gaps/current-state-gap-register.md](docs/gaps/current-state-gap-register.md) for the tracked divergence list.

## How This File Should Be Used

Use this file when you need to find the current code quickly.

Do not use this file as the authority for target behavior. The canonical behavior specs live under `docs/specs/`.
