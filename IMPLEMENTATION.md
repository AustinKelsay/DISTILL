# Distill Implementation Blueprint

## Core Framing

Distill should have:

- thin source-specific connectors
- one shared normalization pipeline
- one standardized local data model

The connectors for Codex CLI and Claude Code should only do source-specific work:

- detect whether the source exists locally
- discover relevant files
- parse source-specific records
- map them into Distill's normalized shapes

Everything after that should be shared:

- raw capture storage
- dedupe
- normalized session upsert
- normalized message upsert
- artifact extraction
- search indexing
- tagging
- labeling
- export

This is the architectural line that keeps Distill extensible without letting every new source leak provider-specific assumptions into the app.

## System Shape

The MVP implementation should be split into five layers:

1. `source discovery`
2. `source connectors`
3. `ingest pipeline`
4. `storage layer`
5. `query and export layer`

## Current Scaffold Status

Implemented now:

- Electron main process
- preload bridge
- minimal renderer view
- shared TypeScript source model
- Codex source detection
- Claude Code source detection
- shared doctor report
- CLI doctor command

This means the project already has a working source-discovery spine, even though ingest and SQLite are not wired yet.

## Shared Distill Shapes

These are the internal shapes every connector should emit.

### `DiscoveredSource`

```ts
type DiscoveredSource = {
  kind: "codex" | "claude_code";
  displayName: string;
  executablePath?: string;
  dataRoot?: string;
  installStatus: "installed" | "not_found" | "partial";
  checks: Array<{
    label: string;
    path: string;
    exists: boolean;
    fileCount?: number;
  }>;
  metadata: Record<string, unknown>;
};
```

### `DiscoveredCapture`

One row per source file that should be imported.

```ts
type DiscoveredCapture = {
  sourceKind: "codex" | "claude_code";
  captureKind: string;
  sourcePath: string;
  externalSessionId?: string;
  sourceModifiedAt?: string;
  sourceSizeBytes?: number;
};
```

### `NormalizedSession`

```ts
type NormalizedSession = {
  sourceKind: "codex" | "claude_code";
  externalSessionId: string;
  title?: string;
  projectPath?: string;
  sourceUrl?: string;
  model?: string;
  modelProvider?: string;
  cliVersion?: string;
  gitBranch?: string;
  startedAt?: string;
  updatedAt?: string;
  summary?: string;
  metadata: Record<string, unknown>;
};
```

### `NormalizedMessage`

```ts
type NormalizedMessage = {
  externalMessageId?: string;
  parentExternalMessageId?: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  createdAt?: string;
  messageKind: "text" | "meta";
  metadata: Record<string, unknown>;
};
```

### `NormalizedArtifact`

```ts
type NormalizedArtifact = {
  externalMessageId?: string;
  kind: "image" | "file" | "tool_call" | "tool_result" | "raw_json";
  mimeType?: string;
  sourcePath?: string;
  payload?: Record<string, unknown>;
};
```

### `ParsedCapture`

```ts
type ParsedCapture = {
  session: NormalizedSession;
  messages: NormalizedMessage[];
  artifacts: NormalizedArtifact[];
  rawRecords: Array<{
    lineNo: number;
    recordType: string;
    recordTimestamp?: string;
    providerMessageId?: string;
    parentProviderMessageId?: string;
    role?: string;
    isMeta: boolean;
    contentText?: string;
    contentJson: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }>;
};
```

## Connector Contract

Each connector should implement the same contract:

```ts
interface SourceConnector {
  kind: "codex" | "claude_code";
  detect(): Promise<DiscoveredSource>;
  discoverCaptures(): Promise<DiscoveredCapture[]>;
  fingerprintCapture(capture: DiscoveredCapture): Promise<{
    rawSha256: string;
    rawBlobPath?: string;
    sourceModifiedAt?: string;
    sourceSizeBytes?: number;
  }>;
  parseCapture(capture: DiscoveredCapture): Promise<ParsedCapture>;
}
```

The contract is intentionally narrow.

Connectors should not:

- talk directly to SQLite
- decide tag policy
- decide export policy
- update search indexes themselves

They only discover and normalize.

## Shared Ingest Pipeline

This should be the same for every source:

1. detect sources
2. discover candidate captures
3. fingerprint each capture
4. skip if `(source_id, source_path, raw_sha256)` already exists
5. copy raw content into Distill blobs if needed
6. insert `captures`
7. parse into raw records, normalized session, normalized messages, and artifacts
8. insert `capture_records`
9. upsert `sessions`
10. upsert `messages`
11. insert `artifacts`
12. emit `activity_events`
13. enqueue `jobs` for indexing and auto-tagging

## Dedupe Rules

### Capture-Level Dedupe

Capture dedupe should use:

- source kind
- source file path
- raw SHA-256

If those match, the capture is already known.

### Session-Level Dedupe

Session uniqueness should use:

- source kind
- external session ID

### Message-Level Dedupe

Prefer:

- external message ID when present

Fallback:

- session ID
- role
- text hash
- timestamp

The source files are append-heavy and may be re-imported many times, so idempotency matters more than perfect elegance.

## Codex Connector

## Detection

The Codex connector should verify:

- `codex` is on `PATH`
- `~/.codex` exists
- `~/.codex/archived_sessions` exists

## Capture Discovery

Initial capture set:

- every file in `~/.codex/archived_sessions/*.jsonl`

Optional auxiliary metadata sources:

- `~/.codex/session_index.jsonl`
- `~/.codex/history.jsonl`

## Parsing Rules

Use archived session files as the source of truth.

Join in `session_index.jsonl` only for:

- title
- updated timestamp

Use `history.jsonl` only as optional auxiliary history, not as the primary transcript source.

## Codex Message Extraction

Keep as transcript candidates:

- `response_item.payload.type = "message"` with role `user`
- `response_item.payload.type = "message"` with role `assistant`

Do not normalize into transcript text:

- `reasoning`
- `function_call`
- `function_call_output`
- `token_count`
- developer bootstrap messages
- environment bootstrap messages

Store those as raw records only.

## Codex Artifacts

The first Codex connector can ignore shell snapshots and tool outputs as first-class artifacts, but it should preserve references to them in metadata so they can be promoted later.

## Claude Code Connector

## Detection

The Claude connector should verify:

- `claude` is on `PATH`
- `~/.claude` exists
- `~/.claude/projects` exists

## Capture Discovery

Initial capture set:

- every file in `~/.claude/projects/**/*.jsonl`

Optional auxiliary metadata sources:

- `~/.claude/history.jsonl`

## Parsing Rules

Use project session JSONL files as the source of truth.

Use `history.jsonl` only as optional prompt-history metadata.

## Claude Message Extraction

Keep as transcript candidates:

- `user` records with `message.content` text blocks
- `assistant` records with `message.content` text blocks

Do not normalize into transcript text:

- `queue-operation`
- `progress`
- `thinking` blocks
- `tool_use` blocks
- `tool_result` blocks
- meta-only records

## Claude Artifacts

Promote to artifacts:

- image blocks
- tool use blocks
- tool result blocks
- pasted content references when recoverable

## Storage Responsibilities

The storage layer should expose a small set of operations:

- `upsertSource`
- `insertCapture`
- `insertCaptureRecords`
- `upsertSession`
- `replaceOrUpsertMessages`
- `insertArtifacts`
- `appendActivityEvent`
- `enqueueJob`

This prevents connector code from growing database logic everywhere.

## Initial Module Boundaries

The first implementation can be organized like this:

```text
src/
  distill/
    types.ts
    ingest.ts
    hashing.ts
    blobs.ts
    db.ts
    schema.ts
  connectors/
    codex/
      detect.ts
      discover.ts
      parse.ts
      normalize.ts
    claude_code/
      detect.ts
      discover.ts
      parse.ts
      normalize.ts
  cli/
    main.ts
    commands/
      doctor.ts
      sources.ts
      import.ts
```

## First CLI Surface

Keep the first CLI very small:

### `distill doctor`

Shows:

- whether Codex CLI is installed
- whether Claude Code is installed
- whether local data roots exist
- how many candidate capture files were found

### `distill sources`

Shows discovered source metadata and local paths.

### `distill import`

Runs:

- source discovery
- capture discovery
- ingest
- summary output

## Milestone Order

### Milestone 1

Build:

- SQLite initialization
- schema application
- source detection
- `distill doctor`

### Milestone 2

Build:

- Codex connector
- ingest of archived session files
- basic session/message normalization

### Milestone 3

Build:

- Claude connector
- image/tool artifact extraction
- shared import pipeline

### Milestone 4

Build:

- FTS indexing
- simple query layer
- export of `train` labeled sessions

## Open Decisions

These are the only meaningful design choices still open before coding:

- runtime: Node/TypeScript vs another local-first stack
- whether to store full raw file contents in blobs always or only for large files
- whether message replacement should be full-session rewrite or row-level upsert during re-import

None of those block implementation planning. They only affect ergonomics.

## Recommended Immediate Next Step

The runtime and initial project skeleton are now chosen and implemented, and `distill doctor` already works.

So the next actual coding step is:

1. wire `schema.sql` into a DB bootstrap
2. add capture discovery
3. implement the Codex importer
4. implement the Claude importer
5. connect the Electron shell to real import state
