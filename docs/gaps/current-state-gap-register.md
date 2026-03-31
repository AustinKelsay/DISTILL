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

- Canonical rule: `activity_events` must cover capture, failure, projection, manual curation, export, and sync lifecycle.
- Current behavior: activity rows are written for capture insertion and export only.
- Impacted files: `src/distill/import.ts`, `src/distill/export.ts`, `src/distill/curation.ts`, `src/distill/jobs.ts`
- Severity: high
- Target branch: `impl/activity-and-curation-audit`
- Acceptance criteria:
- projection success emits an audit event
- capture failures emit audit events
- tag add/remove emits audit events
- label toggle emits audit events
- sync lifecycle emits audit events

## GAP-005: Jobs And Logs Overlap With Audit Semantics

- Canonical rule: jobs and logs are operational views; `activity_events` are the canonical audit trail.
- Current behavior: logs are driven mainly by `jobs` and `exports`, while `activity_events` are not the authoritative product surface.
- Impacted files: `src/distill/jobs.ts`, `src/distill/logs.ts`, `src/renderer/app.ts`
- Severity: medium
- Target branch: `impl/activity-and-curation-audit`
- Acceptance criteria:
- audit and operational responsibilities are cleanly separated
- logs remain useful without becoming the source of truth for domain events
- discrepancies between jobs/logs/activity are test-covered

## GAP-006: Manual Curation Is Not Audited

- Canonical rule: manual tags and labels are canonical curation actions and must be auditable.
- Current behavior: manual tags and labels mutate curation tables without writing activity records.
- Impacted files: `src/distill/curation.ts`, `src/distill/query.ts`, `src/test/query.test.ts`
- Severity: high
- Target branch: `impl/activity-and-curation-audit`
- Acceptance criteria:
- every manual tag add/remove is audited
- every manual label toggle is audited
- session detail and export behavior stays unchanged except for added auditability

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
