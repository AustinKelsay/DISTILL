# Distill Current-State Gap Register

This document is normative for acknowledged drift between the canonical specs and the current implementation.

## GAP-001: Raw Capture Recoverability

- Canonical rule: every successfully snapshotted capture must store recoverable raw content owned by Distill.
- Current behavior: the importer stores checksums and metadata, but does not persist `snapshot.rawText` into Distill-owned storage.
- Impacted files: `src/distill/import.ts`, `src/distill/db.ts`, `schema.sql`
- Severity: high
- Target branch: `impl/raw-capture-persistence`
- Acceptance criteria:
- file-backed captures persist recoverable raw content
- virtual captures such as OpenCode exports persist recoverable raw content
- replay and re-normalization can operate from Distill-owned data alone

## GAP-002: Snapshot Failure Modeling

- Canonical rule: snapshot failures are audit and operational events, not canonical captures.
- Current behavior: failed snapshot attempts are inserted into `captures` with a synthetic hash and failure status.
- Impacted files: `src/distill/import.ts`, `src/distill/db.ts`, `src/test/import.test.ts`
- Severity: medium
- Target branch: `impl/raw-capture-persistence`
- Acceptance criteria:
- snapshot failures do not create canonical capture rows
- snapshot failures still appear in audit and sync summaries
- projection state remains unchanged

## GAP-003: Projection Semantics Are Implicit

- Canonical rule: `sessions`, `messages`, and `artifacts` are the latest successful materialized projection and replace atomically on success.
- Current behavior: the code behaves this way, but the rule is implicit in storage helpers and not represented as a first-class model or contract.
- Impacted files: `src/distill/import.ts`, `src/distill/db.ts`, `schema.sql`
- Severity: medium
- Target branch: `impl/projection-cleanup`
- Acceptance criteria:
- projection replacement semantics are explicit in code and tests
- message and artifact linkage follow canonical projection rules
- no merge-on-failure behavior is possible

## GAP-004: Activity Audit Coverage Is Incomplete

- Status: resolved in the current implementation.
- Historical rule: `activity_events` must cover capture, failure, projection, manual curation, export, and sync lifecycle.
- Resolution notes:
- projection success emits `projection_replaced`
- capture failures emit `capture_failed`
- tag add/remove emits `tag_added` and `tag_removed`
- label enable/disable emits `label_toggled`
- sync jobs emit `sync_queued`, `sync_started`, `sync_completed`, and `sync_failed`
- Implemented in: `src/distill/import.ts`, `src/distill/export.ts`, `src/distill/curation.ts`, `src/distill/jobs.ts`

## GAP-005: Jobs And Logs Overlap With Audit Semantics

- Status: resolved in the current implementation.
- Historical rule: jobs and logs are operational views; `activity_events` are the canonical audit trail.
- Resolution notes:
- sync lifecycle domain events are written to `activity_events`
- jobs remain the operational execution record
- logs remain an operational surface derived from jobs and exports
- warning-only sync outcomes are stored and surfaced as first-class `warning` job/log state without being treated as fatal errors
- legacy `completed` job rows with failure details are read back as warning state for backward compatibility
- Implemented in: `src/distill/jobs.ts`, `src/distill/logs.ts`, `src/renderer/app.ts`, `src/shared/types.ts`

## GAP-006: Manual Curation Is Not Audited

- Status: resolved in the current implementation.
- Historical rule: manual tags and labels are canonical curation actions and must be auditable.
- Resolution notes:
- every manual tag add/remove is audited
- every manual label enable/disable is audited
- session detail and export behavior remain unchanged apart from added auditability
- invalid session ids now remain true no-ops and do not create partial curation side effects
- Implemented in: `src/distill/curation.ts`, `src/test/activity_audit.test.ts`, `src/test/export.test.ts`, `src/test/query.test.ts`

## GAP-007: Artifact Linkage Is Partial

- Canonical rule: artifacts should use `message_id` when tied to a user-visible message and `capture_record_id` whenever provenance exists.
- Current behavior: artifacts are linked by `capture_record_id`; `message_id` is present in schema but not populated.
- Impacted files: `src/distill/db.ts`, `src/distill/query.ts`, `schema.sql`
- Severity: medium
- Target branch: `impl/projection-cleanup`
- Acceptance criteria:
- materialized artifacts link to projected messages where appropriate
- provenance remains available through capture records
- query surfaces expose consistent artifact/message relationships

## GAP-008: Root Docs Still Drifted From The Intended Spec Shape

- Canonical rule: root docs are concise summaries and entrypoints; authoritative architecture lives under `docs/`.
- Current behavior: root docs historically mixed roadmap, research, current behavior, and aspirational architecture in the same files.
- Impacted files: `README.md`, `PLAN.md`, `IMPLEMENTATION.md`, `DISCOVERY.md`
- Severity: medium
- Target branch: `docs/spec-foundation`
- Acceptance criteria:
- root docs stop acting as the canonical source of truth
- root docs point to `docs/`
- discovery is explicitly non-normative
