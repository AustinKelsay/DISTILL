# Distill

Distill is a local-first app for collecting, normalizing, indexing, tagging, labeling, and exporting personal LLM chat history.

The initial sources are:

- OpenAI Codex CLI
- Claude Code

The core architectural idea is simple:

- source-specific connectors stay thin
- Distill normalizes everything into one shared local model
- raw captures are preserved
- search, tagging, labeling, and export happen on standardized data

## Runtime

The current scaffold uses:

- Electron
- TypeScript
- SQLite as the planned local database

The app is desktop-first, but it keeps a small CLI surface for development and diagnostics.

## Current Status

Implemented now:

- Electron + TypeScript project scaffold
- local source detection for Codex CLI and Claude Code
- a shared `doctor` report builder
- CLI doctor command
- minimal Electron shell that can surface local source detection
- documented discovery findings from this machine
- documented schema draft and implementation blueprint

Not implemented yet:

- SQLite bootstrap
- capture discovery pipeline
- raw capture import
- normalization into sessions and messages
- search
- tags, labels, and export

## Project Documents

- [PLAN.md](/Users/plebdev/Desktop/code/DISTILL/PLAN.md): product plan and MVP scope
- [DISCOVERY.md](/Users/plebdev/Desktop/code/DISTILL/DISCOVERY.md): verified local source locations, sample formats, and parser notes
- [IMPLEMENTATION.md](/Users/plebdev/Desktop/code/DISTILL/IMPLEMENTATION.md): connector contract, normalized shapes, and implementation blueprint
- [schema.sql](/Users/plebdev/Desktop/code/DISTILL/schema.sql): current SQLite schema draft

## Commands

Install dependencies:

```bash
npm install
```

Build the TypeScript project:

```bash
npm run build
```

Run the local source doctor in the terminal:

```bash
npm run doctor
```

Run tests:

```bash
npm test
```

Start the Electron app:

```bash
npm start
```

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
