# Distill Contract Test Matrix

This document is normative for planned and required contract tests.

## Suite Index

| Suite | Purpose | Primary Branch |
| --- | --- | --- |
| `connector_contract` | Validate connector inputs and outputs remain within the canonical boundary. | `docs/test-matrix` |
| `raw_capture_persistence` | Validate Distill-owned recoverable raw capture storage. | `test/raw-capture-contracts` |
| `projection_replacement` | Validate replace-on-success and rollback-on-failure projection semantics. | `test/raw-capture-contracts` |
| `activity_audit` | Validate canonical audit event coverage. | `impl/activity-and-curation-audit` |
| `search_indexing` | Validate FTS and query behavior against the current projection. | `impl/query-and-search-alignment` |
| `manual_curation` | Validate manual tags and labels as the normative curation layer. | `docs/test-matrix` |
| `export_contract` | Validate export payloads against the current projection and manual curation state. | `docs/test-matrix` |
| `sync_jobs_and_logs` | Validate operational sync reporting without treating logs as the canonical audit trail. | `docs/test-matrix` |
| `doc_truthfulness` | Validate the canonical docs package stays present and wired together. | `docs/spec-foundation` |

## Fixture Requirements

Shared fixture requirements:

- at least one Codex live session
- at least one Codex archived duplicate of a live session
- at least one Claude Code session with mixed text and structured blocks
- at least one OpenCode export-backed virtual session
- one parse-failure fixture after successful snapshot
- one snapshot-failure fixture
- one large capture fixture that requires blob-backed persistence

Every fixture must document:

- source kind
- source path or virtual path
- expected external session id
- whether it should create transcript messages
- whether it should create artifacts
- whether it should trigger failure behavior

## Scenario Matrix

| Scenario ID | Suite | Scenario | Expected DB State | Expected Query / UI Outcome | Failure Expectations | Target Branch |
| --- | --- | --- | --- | --- | --- | --- |
| `CC-001` | `connector_contract` | Codex connector emits only canonical parsed shapes. | Capture parse output contains one session payload plus raw records/messages/artifacts in canonical shapes. | No source-specific storage logic leaks into shared layers. | Test fails if connector writes non-canonical fields into shared contracts. | `docs/test-matrix` |
| `CC-002` | `connector_contract` | Claude connector preserves text blocks and structured artifacts. | Parsed output includes text messages plus image/tool artifacts. | Session detail can show transcript and artifacts. | Test fails if tool/image blocks become transcript text unexpectedly. | `docs/test-matrix` |
| `CC-003` | `connector_contract` | OpenCode connector preserves visible meta parts and structured artifacts. | Parsed output includes messages/artifacts with canonical roles and kinds. | Session detail can show structured parts without provider leakage. | Test fails if unknown structured parts are dropped. | `docs/test-matrix` |
| `RCP-001` | `raw_capture_persistence` | File-backed capture persists recoverable raw content. | Capture row resolves to a valid `CaptureContentRef` with checksum and byte size. | Replay tooling can recover the original raw content. | Test fails if only hashes/metadata are stored. | `test/raw-capture-contracts` |
| `RCP-002` | `raw_capture_persistence` | Virtual OpenCode capture persists recoverable raw content. | Capture row resolves to Distill-owned content, not only transient process output. | Replay tooling can recover exported session JSON. | Test fails if replay depends on rerunning the source CLI. | `test/raw-capture-contracts` |
| `PR-001` | `projection_replacement` | Exact duplicate re-import is skipped. | No new capture row, or new row is explicitly not inserted per dedupe policy; projection rows unchanged. | Session list/detail/search remain unchanged. | Test fails if duplicate import mutates projection rows. | `test/raw-capture-contracts` |
| `PR-002` | `projection_replacement` | Changed capture appends history and replaces projection. | New capture row exists; session capture count increments; messages/artifacts reflect only newest successful projection. | Search and session detail show only current projection data. | Test fails if stale message rows remain visible. | `test/raw-capture-contracts` |
| `PR-003` | `projection_replacement` | Parse failure after snapshot preserves prior projection. | Capture exists with failure status; new capture records or projection rows are rolled back as required. | Existing session detail remains unchanged. | Test fails if partial rows remain. | `test/raw-capture-contracts` |
| `AA-001` | `activity_audit` | Successful capture and projection emit audit events. | `activity_events` includes `capture_recorded` and `projection_replaced`. | Audit views can attribute session updates to the import run. | Test fails if successful import lacks canonical audit rows. | `impl/activity-and-curation-audit` |
| `AA-002` | `activity_audit` | Snapshot or parse failure emits canonical failure audit. | `activity_events` includes `capture_failed`. | Sync detail can show failure without mutating projection. | Test fails if failures only appear in jobs/logs. | `impl/activity-and-curation-audit` |
| `AA-003` | `activity_audit` | Manual tag and label changes emit audit rows. | `activity_events` includes `tag_added`, `tag_removed`, and `label_toggled`. | Curation history is auditable. | Test fails if curation changes are silent. | `impl/activity-and-curation-audit` |
| `AA-004` | `activity_audit` | Sync lifecycle emits canonical audit rows. | `activity_events` includes `sync_queued`, `sync_started`, `sync_completed`, or `sync_failed`. | Audit and ops summaries can be reconciled. | Test fails if sync lifecycle is visible only through jobs. | `impl/activity-and-curation-audit` |
| `SI-001` | `search_indexing` | Search returns current projected transcript rows only. | FTS rows correspond to current message projection. | Search results exclude stale superseded rows. | Test fails if replaced messages remain searchable. | `impl/query-and-search-alignment` |
| `SI-002` | `search_indexing` | Search safely handles punctuation-heavy queries. | No DB corruption or invalid FTS query state. | Results still resolve for quoted and dashed input. | Test fails if queries crash or over-match. | `impl/query-and-search-alignment` |
| `MC-001` | `manual_curation` | Manual tags appear in session detail and export. | Tag rows and assignments exist with manual origin. | Session detail and export payloads agree. | Test fails if export and detail diverge. | `docs/test-matrix` |
| `MC-002` | `manual_curation` | Manual labels remain session-level only. | Label assignments target sessions and preserve origin. | Export-by-label matches session detail state. | Test fails if label scope drifts silently. | `docs/test-matrix` |
| `EC-001` | `export_contract` | Export uses current session projection, not raw history. | Export bookkeeping row exists; payload matches current projection. | Exported messages equal current session detail transcript. | Test fails if superseded rows appear in output. | `docs/test-matrix` |
| `EC-002` | `export_contract` | Export includes manual curation metadata. | Export row and output include tags and labels. | Consumers can trust export metadata without re-querying Distill. | Test fails if tags/labels are missing or inconsistent. | `docs/test-matrix` |
| `SL-001` | `sync_jobs_and_logs` | Sync job summaries remain operational, not canonical audit. | Job rows contain sync status and metrics. | Logs show sync state while audit remains the source of truth. | Test fails if log behavior depends on missing audit guarantees. | `docs/test-matrix` |
| `SL-002` | `sync_jobs_and_logs` | Export summaries remain visible in logs. | Export bookkeeping is preserved. | Logs show operational export summaries. | Test fails if export operations disappear from ops surfaces. | `docs/test-matrix` |
| `DT-001` | `doc_truthfulness` | Canonical docs package exists and is linked from root docs. | Required markdown files exist. | Contributors can navigate from root docs to canonical docs. | Test fails if a required canonical doc is removed or unlinked. | `docs/spec-foundation` |
| `DT-002` | `doc_truthfulness` | Root docs remain non-authoritative summaries. | Root docs contain the required links and disclaimers. | Readers are directed to `docs/` for canonical truth. | Test fails if root docs re-assume canonical authority. | `docs/spec-foundation` |

## Expected DB State Guidance

For every executable scenario, the test implementation should explicitly assert:

- capture row count and status changes
- capture content ref presence where required
- session row stability or replacement
- message and artifact row membership in the current projection
- activity event coverage
- job/log summaries when relevant

## Expected UI / Query Outcome Guidance

For every executable scenario, the test implementation should explicitly assert:

- session list title and preview behavior where relevant
- session detail transcript correctness
- artifact visibility and linkage
- search result freshness after re-imports
- export payload correctness

## Branch Mapping Rule

Scenarios become executable in the first branch that claims their acceptance criteria. A future implementation branch is not complete until its mapped scenarios are executable and passing.
