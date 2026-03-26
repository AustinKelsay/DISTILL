# Distill

Distill is a local-first desktop app for collecting, normalizing, indexing, tagging, labeling, and exporting personal LLM chat history.

The first two local sources are:

- OpenAI Codex CLI
- Claude Code

The architectural line is deliberate:

- source-specific connectors stay thin
- Distill preserves raw captures from disk
- Distill normalizes everything into one shared local model
- search, curation, and export operate on standardized data

## Current Status

Implemented now:

- Electron + TypeScript desktop scaffold
- local source detection for Codex CLI and Claude Code
- CLI `doctor` command
- SQLite bootstrap from `schema.sql`
- CLI `import` command
- CLI `export` command
- idempotent raw capture recording keyed by source path and SHA-256
- normalized `sessions`, `messages`, and `artifacts` import
- parser coverage for Codex archived sessions and Claude project sessions
- basic dashboard query for recent sessions
- interactive search UI over normalized FTS results
- session detail query and transcript read model
- manual session tags and labels
- labeled JSONL export
- minimal Electron UI showing source health, recent sessions, search, session detail, curation controls, and export actions
- tests for doctor, parsing, import, query, and export behavior

Not implemented yet:

- background job processing beyond schema placeholders
- richer artifact browsing in the Electron UI

## Local Storage

By default Distill writes to:

```text
~/.distill/
  distill.db
  blobs/
  imports/
  exports/
```

Path overrides:

- `DISTILL_HOME`: override the Distill working directory
- `CODEX_HOME`: override the Codex data root
- `CLAUDE_HOME`: override the Claude Code data root

## Supported Sources

Codex CLI:

- detects the `codex` executable on `PATH`
- reads archived sessions from `~/.codex/archived_sessions`
- uses `session_index.jsonl` and `history.jsonl` as auxiliary metadata only

Claude Code:

- detects the `claude` executable on `PATH`
- reads project session files from `~/.claude/projects`
- uses `history.jsonl` as auxiliary metadata only

Both connectors preserve raw records and derive user-facing transcript messages from filtered subsets of those event streams.

Operational notes:

- `npm run export` defaults to the `train` label if no label is provided.
- Search tolerates punctuation-heavy input such as quoted text and dashed tokens.
- The Electron renderer escapes transcript and metadata text before injecting it into the UI.

## Commands

Install dependencies:

```bash
npm install
```

Build the project:

```bash
npm run build
```

Scan local source health:

```bash
npm run doctor
```

Import local captures into `~/.distill/distill.db`:

```bash
npm run import
```

Export labeled sessions as JSONL:

```bash
npm run export -- train
```

Show command help:

```bash
npm run doctor -- --help
npm run import -- --help
npm run export -- --help
```

Run tests:

```bash
npm test
```

Launch the Electron app:

```bash
npm start
```

## Import Behavior

The current importer:

1. detects local sources
2. discovers candidate capture files
3. hashes each raw file
4. skips captures already imported with the same `(source, path, sha256)`
5. parses raw records
6. upserts normalized sessions
7. replaces normalized messages and artifacts for each imported session
8. supports manual session curation through tags and labels
9. exports labeled sessions as JSONL

That means re-running `npm run import` is expected and safe. New or changed files import again; previously normalized identical captures are skipped.

## Project Documents

- [PLAN.md](/Users/plebdev/Desktop/code/DISTILL/PLAN.md): product direction and MVP definition
- [DISCOVERY.md](/Users/plebdev/Desktop/code/DISTILL/DISCOVERY.md): verified local source locations, sample formats, and parser notes
- [IMPLEMENTATION.md](/Users/plebdev/Desktop/code/DISTILL/IMPLEMENTATION.md): connector contract, normalized shapes, and ingest blueprint
- [schema.sql](/Users/plebdev/Desktop/code/DISTILL/schema.sql): current SQLite schema

## Source Tree

```text
src/
  cli/
  connectors/
    codex/
    claude_code/
  distill/
  electron/
  renderer/
  shared/
  test/
static/
```

## Design Rules

- local-first
- preserve raw captures
- normalize into one Distill model
- keep provider-specific logic inside connectors
- keep the shared ingest pipeline source-agnostic
- favor idempotent re-import over fragile diff logic
