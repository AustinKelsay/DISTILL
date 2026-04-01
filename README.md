# Distill

Distill is a local-first desktop prototype for collecting, normalizing, inspecting, curating, and exporting local LLM chat history.

## Implemented Now

- Electron + TypeScript desktop prototype
- SQLite local database bootstrap from `schema.sql`
- source detection and capture discovery for Codex CLI, Claude Code, and OpenCode
- local capture persistence with recoverable raw capture storage for file-backed and virtual captures
- import pipeline that parses local captures into normalized `sessions`, `messages`, `artifacts`, and `capture_records`
- explicit replace-on-success session projection writes for `sessions`, `messages`, and `artifacts`
- basic FTS-backed search over normalized session data
- session detail, artifact inspection, DB explorer, logs, and settings views
- manual session tags and labels
- labeled JSONL export
- import and sync activity auditing across capture, projection, curation, export, and sync lifecycle events
- background sync jobs for local source refresh
- tests for import, parse, query, export, jobs, logs, preferences, and DB inspection

## Not Implemented Now

- auto-tagging
- embeddings or vector search
- watched import folders
- a local capture API
- a generalized background job system beyond source sync
- cloud sync
- dataset versioning UI

## Canonical Specs

The authoritative architecture and planning docs live under [docs/README.md](docs/README.md).

Start here:

1. [docs/README.md](docs/README.md)
2. [docs/specs/architecture.md](docs/specs/architecture.md)
3. [docs/specs/data-model.md](docs/specs/data-model.md)
4. [docs/specs/ingest-pipeline.md](docs/specs/ingest-pipeline.md)
5. [docs/gaps/current-state-gap-register.md](docs/gaps/current-state-gap-register.md)

The root docs are summaries and pointers. They are not the canonical source of truth.
