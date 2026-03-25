# Discovery Pass

Date: 2026-03-25

This discovery pass was run on the current machine to verify whether Distill can start by ingesting local chat history from Codex CLI and Claude Code.

## Outcome

Both target tools are installed on this machine and both already store usable local conversation history on disk.

- `codex` binary found at `/opt/homebrew/bin/codex`
- `claude` binary found at `/Users/plebdev/.local/bin/claude`

That means the Distill MVP can begin with direct local ingestion and does not need a browser capture path.

## Source Locations

### Codex CLI

Primary paths observed:

- `~/.codex/archived_sessions/`
- `~/.codex/session_index.jsonl`
- `~/.codex/history.jsonl`

Secondary paths worth preserving as optional metadata:

- `~/.codex/logs_1.sqlite`
- `~/.codex/state_5.sqlite`
- `~/.codex/shell_snapshots/`

Observed on this machine:

- `90` archived session files in `~/.codex/archived_sessions/`

Example files:

- `~/.codex/archived_sessions/rollout-2026-03-18T16-39-04-019d02e3-4d05-7c22-ba18-df8c93bfbc55.jsonl`
- `~/.codex/session_index.jsonl`
- `~/.codex/history.jsonl`

### Claude Code

Primary paths observed:

- `~/.claude/projects/`
- `~/.claude/history.jsonl`

Secondary paths worth preserving as optional metadata:

- `~/.claude/file-history/`
- `~/.claude/paste-cache/`
- `~/.claude/plans/`
- `~/.claude/shell-snapshots/`
- `~/.claude/settings.json`
- `~/.claude.json`

Observed on this machine:

- `71` project session files in `~/.claude/projects/`

Example files:

- `~/.claude/projects/-Users-plebdev-Desktop-code-austin-ai-meetup-list/690bab39-97ff-4313-99b3-b707a5b9d57b.jsonl`
- `~/.claude/history.jsonl`

## Sample File Shapes

These are compact structural samples based on real local files, with message bodies shortened.

### Codex CLI

#### `~/.codex/session_index.jsonl`

One line per session summary:

```json
{
  "id": "019d2063-4f77-79d1-a6f4-715fe589ad91",
  "thread_name": "Add MCP server settings page",
  "updated_at": "2026-03-24T15:07:57.470166Z"
}
```

#### `~/.codex/history.jsonl`

One line per user prompt history entry:

```json
{
  "session_id": "019d02e3-4d05-7c22-ba18-df8c93bfbc55",
  "ts": 1773869955,
  "text": "do a round of improvements on the mobile view specifically for slideshow"
}
```

#### `~/.codex/archived_sessions/*.jsonl`

JSONL event stream per session.

Observed record types in sampled files:

- `session_meta`
- `event_msg`
- `response_item`
- `turn_context`
- `compacted`

Representative shapes:

```json
{
  "timestamp": "2026-03-18T21:39:16.037Z",
  "type": "session_meta",
  "payload": {
    "id": "019d02e3-4d05-7c22-ba18-df8c93bfbc55",
    "timestamp": "2026-03-18T21:39:04.072Z",
    "cwd": "/Users/plebdev/Desktop/code/austin-ai-meetup-list",
    "originator": "codex-tui",
    "cli_version": "0.115.0",
    "source": "cli",
    "model_provider": "openai",
    "git": {}
  }
}
```

```json
{
  "timestamp": "2026-03-18T21:39:16.038Z",
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "user",
    "content": [
      {
        "type": "input_text",
        "text": "do a round of improvements on the mobile view specifically for slideshow"
      }
    ]
  }
}
```

```json
{
  "timestamp": "2026-03-18T21:39:18.174Z",
  "type": "response_item",
  "payload": {
    "type": "reasoning",
    "summary": [],
    "content": null,
    "encrypted_content": "..."
  }
}
```

### Claude Code

#### `~/.claude/history.jsonl`

One line per prompt-history entry:

```json
{
  "display": "Do a round of analysis on open-claw-ui here and the data and primary views that we are dealing with.",
  "pastedContents": {},
  "timestamp": 1773964690513,
  "project": "/Users/plebdev/Desktop/code/open-claw-ui",
  "sessionId": "05503986-5627-4b18-b498-e801cb53e98f"
}
```

#### `~/.claude/projects/**/*.jsonl`

JSONL event stream per project session.

Observed record types in sampled files:

- `queue-operation`
- `user`
- `assistant`
- `progress`

Representative shapes:

```json
{
  "type": "user",
  "uuid": "5b1f9527-11d4-49a5-91fd-fd4bfdce4630",
  "parentUuid": "ec8b191e-4d2c-473d-8498-1777825d81e6",
  "timestamp": "2026-03-25T20:10:11.311Z",
  "cwd": "/Users/plebdev/Desktop/code/austin-ai-meetup-list",
  "sessionId": "690bab39-97ff-4313-99b3-b707a5b9d57b",
  "gitBranch": "feature/calendar-and-email",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "..."
      },
      {
        "type": "image",
        "source": {
          "type": "base64",
          "media_type": "image/png",
          "data": "..."
        }
      }
    ]
  }
}
```

```json
{
  "type": "assistant",
  "uuid": "ab9ffb87-c031-4957-b4fe-966a4d11b272",
  "parentUuid": "2a875f5c-acc5-4192-8097-689277d5f79f",
  "timestamp": "2026-03-25T20:10:25.000Z",
  "sessionId": "690bab39-97ff-4313-99b3-b707a5b9d57b",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "..."
      }
    ]
  }
}
```

```json
{
  "type": "assistant",
  "uuid": "dbf59e0d-5805-4667-a176-84ce10526dd4",
  "parentUuid": "1035dd9f-9b08-4539-b02e-4aaa0feb1d75",
  "timestamp": "2026-03-25T20:10:17.000Z",
  "sessionId": "690bab39-97ff-4313-99b3-b707a5b9d57b",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "tool_use"
      }
    ]
  }
}
```

## Parser Notes

## Codex CLI Parser Notes

### Session Identity

- primary session ID source: `session_meta.payload.id`
- fallback session ID source: filename suffix in archived session path
- title source: join with `session_index.jsonl` on session ID when available
- updated time source: `session_index.updated_at` when available, otherwise max event timestamp
- started time source: `session_meta.payload.timestamp`
- project path source: `session_meta.payload.cwd`, fallback to `turn_context.payload.cwd`

### Useful User-Facing Content

Likely keep:

- `response_item` where `payload.type = "message"` and `payload.role` is `user` or `assistant`
- `event_msg` where `payload.type = "user_message"` or `payload.type = "agent_message"` as optional activity/event records

Likely exclude from transcript body:

- `response_item` with `payload.type = "reasoning"`
- `response_item` with `payload.type = "function_call"`
- `response_item` with `payload.type = "function_call_output"`
- `event_msg` with `payload.type = "token_count"`
- `response_item` with role `developer`
- `response_item` with role `user` containing only environment/bootstrap context
- `turn_context` and `compacted` from transcript body, but preserve as raw records

### Important Distinction

Codex archived sessions look like execution logs, not clean chat transcripts.

For Distill, the importer should:

1. preserve every raw line in `captures`
2. derive a clean transcript view from a filtered subset
3. keep source-specific metadata in JSON so replay is possible later

### Codex Risks

- raw files contain a lot of system/developer bootstrap material
- assistant reasoning appears encrypted and should not be treated as user-visible text
- the same user prompt can appear in both `history.jsonl` and archived session records, so dedupe must be explicit

## Claude Code Parser Notes

### Session Identity

- primary session ID source: record `sessionId`
- project path source: enclosing project folder and record `cwd`
- started time source: min record timestamp
- updated time source: max record timestamp

### Useful User-Facing Content

Likely keep:

- `user` and `assistant` records where `message.role` exists
- `message.content` blocks with `type = "text"`
- optional artifact extraction from `image`, `tool_use`, `tool_result`, and pasted content references

Likely exclude from transcript body:

- `queue-operation`
- `progress`
- `assistant.message.content[].type = "thinking"`
- `tool_use` and `tool_result` blocks from the main text transcript, while still preserving them as raw structured records
- `user` records marked `isMeta = true` unless they contain useful session metadata only

### Important Distinction

Claude Code session files are much closer to turn-by-turn transcripts than Codex archived sessions, but they still interleave tool traffic and meta records with user-visible chat.

The importer should treat each record as a raw event first, then derive normalized messages only from the user-visible content blocks.

### Claude Risks

- user and assistant content may be arrays with mixed block types, not plain text
- images may be inlined as base64 and should become artifacts instead of message text
- some useful metadata exists outside message text, such as `gitBranch`, `entrypoint`, `permissionMode`, and `cwd`

## Recommended Parsing Strategy

Use the same high-level pipeline for both sources:

1. discover files
2. create one raw `capture` per source file import
3. hash the raw file contents for idempotency
4. parse every line into provider-specific raw records
5. derive one normalized session
6. derive normalized messages from user-visible text blocks only
7. extract artifacts separately
8. retain provider-specific metadata in JSON columns

## Final Schema Direction

The schema should support three layers:

- raw captures
- normalized sessions and messages
- activity and curation

The concrete draft is in [schema.sql](/Users/plebdev/Desktop/code/DISTILL/schema.sql).
