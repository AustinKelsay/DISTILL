# Distill Plan

## Product Direction

Distill should start ruthlessly simple and local-first:

- one local app
- one SQLite database
- one blobs folder
- one local discovery and ingest flow
- one timeline UI

The core loop is:

`capture -> log -> search -> tag -> label -> export`

## Runtime Direction

The current implementation direction is:

- Electron for the local app shell
- TypeScript for application and connector code
- SQLite for the local data layer

This keeps the desktop UI, shared application logic, and connector work in one stack.

## Core Idea

Distill is a local conversation collector for developer LLM chats.

It should pull in local chat history that already exists on the machine, preserve the raw source data, normalize it into one queryable model, and make it easy to:

- review what happened
- search old conversations
- tag sessions automatically
- label sessions intentionally
- export curated data later

## Local Layout

Use a single local working directory:

```text
~/.distill/
  distill.db
  blobs/
    sha256/...
  imports/
  exports/
```

- `distill.db` stores normalized records, metadata, tags, labels, jobs, and activity.
- `blobs/` stores large raw artifacts like JSON, HTML, screenshots, and attachments.
- `imports/` is a watched folder for manual drops.
- `exports/` holds generated datasets.

The split is simple:

- SQLite for structured state
- filesystem for raw artifacts
- Electron app shell for the local product surface

## Initial Sources

V1 should only support local chat data from:

- OpenAI Codex CLI
- Claude Code

That means the first ingest path is not browser capture. It is local filesystem discovery.

Distill should:

- verify the relevant tools appear to be installed
- locate their local chat/session storage
- inspect the real file formats
- ingest from those locations directly

The product assumption is simple:

the user has already used Codex CLI and/or Claude Code, and the useful history is already on disk.

## Data Model

The model should stay small and deliberate.

### Raw Intake

`captures` is append-only raw intake.

It exists to:

- preserve exactly what was received
- support replay and re-normalization later
- make ingest robust and auditable

### Normalized Working Model

`sessions` and `messages` are the working model used by the app.

They should contain the stable fields needed for:

- timeline views
- transcript views
- search
- filtering
- tagging
- labeling
- export

### Activity Layer

`activity_events` powers the product surface.

Every meaningful action should emit an event, such as:

- `captured`
- `updated`
- `indexed`
- `tagged`
- `labeled`
- `deduped`
- `exported`

### Jobs Layer

`jobs` powers background work:

- indexing
- auto-tagging
- future enrichment
- exports

This gives automation without overbuilding event sourcing or distributed workers.

## Initial Schema

```sql
sources(
  id, kind, account_name, created_at
)

captures(
  id, source_id, external_session_id, raw_hash, raw_payload_json,
  raw_blob_path, captured_at, status, error_text
)

sessions(
  id, source_id, external_session_id, title, url, model,
  started_at, updated_at, message_count, token_estimate,
  summary, metadata_json
)

messages(
  id, session_id, external_message_id, ordinal, role,
  text, created_at, metadata_json, text_hash
)

artifacts(
  id, session_id, message_id, kind, blob_path, sha256, metadata_json
)

tags(
  id, name, kind, created_at
)

tag_assignments(
  id, object_type, object_id, tag_id, origin, confidence, created_at
)

labels(
  id, name, scope, created_at
)

label_assignments(
  id, object_type, object_id, label_id, origin, created_at
)

jobs(
  id, type, object_type, object_id, status, attempts,
  run_after, created_at, updated_at
)

activity_events(
  id, event_type, object_type, object_id, payload_json, created_at
)
```

## Ingest Strategy

Do not begin with OAuth, provider APIs, or browser extensions.

Start with three local ingest paths:

1. Direct local source discovery for Codex CLI and Claude Code
2. Watched import folder
3. Tiny local capture API for future local tools and scripts

The first and most important path is direct discovery of local session files.

Distill should be able to:

1. check whether Codex CLI and Claude Code appear to exist on the machine
2. look in known local storage locations
3. verify chat/session files are present
4. parse those local artifacts
5. ingest them into the canonical model

The local capture API can still exist, but it is not the primary MVP path. It is just a future-friendly local interface, something like:

```text
POST http://127.0.0.1:<port>/capture
```

The most important ingest rule:

Local source adapters should ingest full session snapshots, not diffs.

That keeps adapters thin and stable. Distill does the hard part:

1. discover source files
2. read and preserve raw capture
3. hash and dedupe
4. normalize into sessions/messages
5. enqueue indexing and tagging jobs
6. append activity events
7. show it immediately in the UI

## Canonical Capture Format

Every local source adapter should output the same internal payload shape:

```json
{
  "source": "codex",
  "account": "local",
  "external_session_id": "abc123",
  "title": "Polish dashboard styling and data",
  "url": null,
  "model": "gpt-5.4",
  "captured_at": "2026-03-25T18:20:00Z",
  "messages": [
    {
      "external_message_id": "m1",
      "role": "user",
      "text": "Help me think through the dashboard changes here.",
      "created_at": "2026-03-25T18:18:00Z",
      "metadata": {}
    }
  ],
  "raw": {
    "html_blob_path": "...",
    "json": {}
  }
}
```

This is the key abstraction. New sources should only need new adapters that map local data into this shape.

## Source Discovery

The very first implementation task is source discovery for:

- Codex CLI
- Claude Code

Distill should maintain a small source registry with, for each source:

- expected app/tool name
- likely install check
- likely local storage paths
- file format expectations
- parser status

The initial user experience should be:

1. Distill checks whether Codex CLI or Claude Code appear to be installed
2. Distill scans likely local session paths
3. Distill shows what it found
4. user runs or confirms import
5. Distill ingests existing local history

This is simpler and more reliable than asking the user to install a browser extension before any value exists.

## Search And Indexing

V1 should use:

- normal SQL indexes for source, model, date, and state filters
- one SQLite FTS index for transcript text and titles

Do not add embeddings or a vector database in v1.

The main early need is:

- find a conversation quickly
- filter it cleanly
- open it immediately

FTS is enough for that.

## Tags

Tags should be cheap, abundant, and reversible.

They mostly describe.

Starter tags:

- source tags
- model tags
- structural tags like `has-code`, `has-link`, `has-image`, `long-session`
- topic tags like `coding`, `writing`, `research`, `brainstorming`
- user project tags like `distill`

Every tag assignment should track origin:

- `auto_rule`
- `manual`
- later `model`

## Labels

Labels should be stronger than tags.

Tags describe.
Labels decide.

For v1, keep labels session-level only.

Starter labels:

- `train`
- `holdout`
- `exclude`
- `sensitive`
- `favorite`

That gives immediate curation value without message-level complexity.

## Primary Product Surface

The first UI should be an activity timeline, not a complex dataset workbench.

### Activity Feed

A reverse-chronological feed driven by `activity_events`.

Each item should show:

- source icon
- session title
- short prompt preview or summary
- timestamp
- model, tags, and labels
- pipeline status like `Logged`, `Indexed`, `Tagged`
- quick actions like `Train`, `Exclude`, `Add tag`, `Open`

### Search

One global search box with filters:

- source
- model
- date range
- label
- tag

### Session Detail

Transcript view plus metadata:

- title
- source URL
- model
- tags
- labels
- artifacts
- raw capture versions

## Product Feel

The satisfying part is not fancy AI. It is that Distill quietly keeps up.

Important MVP details:

- source discovery status per tool
- clear indication of found local history
- instant appearance in the activity feed
- visible pipeline chips
- idempotent re-capture without duplicates
- tiny success feedback after capture
- unreviewed session queue
- fast keyboard actions

## Export

Include one useful export path early:

- export all sessions labeled `train`
- write JSONL
- include raw conversation form and turn-pair form
- include metadata like source, model, tags, labels, and timestamps

This closes the product loop and proves curation has value.

## What Not To Build Yet

Avoid these in MVP:

- cloud sync
- multi-user collaboration
- browser extension work
- vector search
- auto-LLM labeling in the critical path
- fine-tuning orchestration
- dataset versioning UI
- complex permissions
- plugin marketplace work

## Best Build Order

1. Local DB, schema, and blob storage
2. Source discovery for Codex CLI and Claude Code
3. Parsers for their local session formats
4. Direct local ingest pipeline
5. Manual import folder
6. Activity feed
7. Session detail view
8. Search, filters, and FTS
9. Auto tags
10. Manual labels
11. Export labeled sessions

## Definition Of MVP

Distill MVP is done when it can:

- detect Codex CLI and Claude Code on the local machine
- find their local chat/session history when present
- preserve raw captures
- normalize sessions and messages into SQLite
- show them immediately in an activity feed
- support search and filters
- assign automatic tags
- assign manual labels
- export curated `train` data as JSONL

## Next Artifact

The next high-leverage deliverables after the current ingest spine are:

- search over normalized data using the existing FTS table
- manual curation flows for tags and labels
- first JSONL export path for labeled sessions
- richer artifact and raw-capture inspection in the UI

## Current Foundation

Already in place:

- Electron + TypeScript scaffold
- local source doctor for Codex CLI and Claude Code
- direct import pipeline for Codex and Claude local session files
- normalized `sessions`, `messages`, and `artifacts` persistence
- recent-session dashboard query and session detail UI
- test coverage for doctor, parse, import, and query flows
- discovery notes from this machine
- SQLite schema
- implementation blueprint
