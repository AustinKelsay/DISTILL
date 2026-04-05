# Distill Desktop Parity Acceptance Matrix

This document translates the Electron contract intent into the Rust rebuild sequence.

## Purpose

The Electron test matrix remains the canonical behavior baseline.

This matrix answers:

- what the Rust app already covers
- what suites are still missing
- what phase should introduce each suite

## Current Rust Test Coverage

Current executable Rust coverage is limited to scaffold behavior:

- read-only shell boot
- session read-model rendering against fixture data
- log filtering reads
- DB browse and read-only SQL guard
- stale-selection controller regressions
- read-only safety for compatibility-mode access

This is necessary scaffolding coverage, not product parity coverage.

## Phase Mapping

| Suite | Electron Intent | Rust Current Status | Target Phase |
| --- | --- | --- | --- |
| `connector_contract` | Source connectors stay within the canonical boundary. | Missing. | Phase 2 |
| `raw_capture_persistence` | Raw captures are Distill-owned and replayable. | Missing. | Phase 3 |
| `projection_replacement` | Replace-on-success, rollback-on-failure projection semantics. | Missing. | Phase 3 |
| `search_indexing` | Search reflects the current projection with canonical token normalization. | Missing. | Phase 4 |
| `session_read_model` | Session detail exposes projection metadata and provenance safely. | Partial read-only coverage only. | Phase 4 |
| `manual_curation` | Tags and labels are the normative session-level curation layer. | Missing write-path coverage. | Phase 5 |
| `export_contract` | Export uses the current projection and manual curation state. | Missing. | Phase 6 |
| `sync_jobs_and_logs` | Jobs and logs remain operational, not canonical audit. | Read-only log display only. | Phase 6 |
| `activity_audit` | Canonical audit events cover import, curation, export, and sync. | Missing writes entirely. | Phase 5 and Phase 6 |
| `doc_truthfulness` | Desktop docs stay coherent and linked. | Minimal. | Phase 0 and ongoing |

## New Rust-Native Suites

The Rust app should add its own executable suites in roughly this order:

1. `desktop_scaffold`
2. `connector_contract`
3. `raw_capture_persistence`
4. `projection_replacement`
5. `search_indexing`
6. `session_read_model`
7. `manual_curation`
8. `activity_audit`
9. `export_contract`
10. `sync_jobs_and_logs`
11. `compatibility_migration`
12. `desktop_ui_smoke`

## Minimum Scenarios Per Phase

## Phase 1

- initialize a fresh Rust Distill home
- open an Electron-era home in compatibility mode
- prove no destructive mutation occurs in compatibility mode

## Phase 2

- detect each supported source independently
- discover captures per source
- parse fixtures into canonical shared shapes
- isolate connector failures without aborting healthy sources

## Phase 3

- persist a recoverable raw capture
- skip an exact duplicate capture
- append a changed capture and replace the projection
- preserve the prior projection after parse failure
- synthesize a deterministic session id when the source lacks one

## Phase 4

- search only the current projection
- normalize punctuation-heavy FTS input correctly
- expose session detail metadata and provenance safely
- preserve artifact linkage from projected messages

## Phase 5

- add and remove a tag with manual origin
- toggle labels with audit events
- enforce dataset-label exclusivity transactionally
- derive workflow states correctly after curation changes

## Phase 6

- export `train` sessions only when eligible
- export `holdout` sessions only when eligible
- block `exclude`, `sensitive`, and conflicting dataset labels from standard exports
- emit export bookkeeping and sync lifecycle records
- keep jobs/logs operational and activity canonical

## Phase 7

- complete the product loop from the native desktop shell
- perform end-to-end smoke tests on macOS and Linux
- preserve behavior under repeated imports and repeated exports

## Fixture Strategy

Rust should reuse or mirror the Electron fixture corpus wherever possible:

- Codex live session
- Codex archived duplicate
- Claude mixed-block session
- OpenCode virtual export-backed session
- parse-failure-after-snapshot case
- snapshot-failure case
- large blob-backed capture

The goal is not two separate product contracts. The goal is one product contract exercised from two implementations.
