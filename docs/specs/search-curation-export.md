# Distill Search, Curation, And Export Spec

This document is normative.

## Search

### Search Scope

Current canonical search is SQLite FTS over the current materialized session projection.

Indexed inputs:

- projected message text
- session title
- session project path
- message role for every projected message

### Search Semantics

- search results reflect the current projection only
- superseded projection rows must not appear in search results
- exact capture history is not searched directly
- punctuation-heavy user input must be normalized into a safe FTS query form

Current canonical normalization algorithm:

1. extract tokens using the Unicode pattern `[\p{L}\p{N}_-]+`
2. discard every character that is not part of a matched token, including quotes, slashes, commas, colons, and control characters
3. no additional quote-escaping step is required because the token matcher strips quotes before tokenization
4. wrap every token in double quotes
5. join wrapped tokens with ` AND `
6. if zero tokens are extracted, do not issue an FTS query and return no search results

Examples:

- input: `analytics-regression: "beta" env`
- normalized query: `"analytics-regression" AND "beta" AND "env"`

- input: `foo/bar baz?`
- normalized query: `"foo" AND "bar" AND "baz"`

- input: `("quoted") AND weird`
- normalized query: `"quoted" AND "AND" AND "weird"`

- input: `!!! /// ???`
- normalized query: no tokens extracted, so no FTS query is issued and no results are returned

### Session List And Detail Read Model

The query layer may expose list and detail read models, but those read models must derive from the current projection and manual curation state.

Session detail must support:

- title
- external session id
- project path
- source kind
- timestamps available from the current projection, including `started_at` and `updated_at` when present
- source URL when present in the current projection
- session summary when present in the current projection
- raw capture count from the current projection
- parsed session metadata from the current projection
- ordered messages
- manual labels
- manual tags
- artifacts

## Manual Tags

Current normative behavior:

- manual, session-level only
- stored with origin as a `CurationOrigin` value plus the assignment timestamp
- cheap and reversible

Current normative manual assignments use `origin = "manual"`.

Starter tag categories remain guidance, not a closed taxonomy:

- source tags
- model tags
- structural tags
- topic tags
- project tags

## Manual Labels

Current normative behavior:

- manual, session-level only
- stronger than tags because labels decide export inclusion and review-routing behavior, while tags remain descriptive only
- intended to drive export and review flows
- labels take precedence over tags in conflict resolution
- UI surfaces should show labels before tags
- export metadata should list labels before tags

Starter label set:

- `train`
- `holdout`
- `exclude`
- `sensitive`
- `favorite`

The label catalog may expand, but every label remains explicit and local.

## Export Contract

Current canonical export behavior is labeled session export from the current materialized projection.

Required export content:

- source kind
- external session id
- session metadata from the current projection, including `source_url`, `summary`, and parsed session metadata when present
- ordered projected messages with ordinal, role, text, created timestamp, `message_kind`, and parsed message metadata
- manual labels
- manual tags
- turn-pair representation when derivable

Current canonical turn-pair representation is:

```ts
type TurnPair = {
  user: string;
  assistant: string;
};
```

Derivation algorithm:

1. iterate projected messages in ordinal order
2. when a `user` message is encountered, store it as the pending user value
3. if another `user` message appears before an `assistant`, replace the pending user value with the newer one
4. when an `assistant` message appears while a pending user value exists, emit one `{ user, assistant }` pair and clear the pending user value
5. `assistant` messages without a pending user value do not create a pair
6. a trailing `user` message without a following `assistant` does not create a pair

This intentionally mirrors the current implementation rather than a richer future pairing model.

Export source truth is the current session projection, not raw capture history.

For compatibility, additive export fields may be introduced without renaming existing top-level fields, but any exported session or message metadata must still come from the current projection only.

## Explicit Out-Of-Scope Items

The following are not normative in the current spec:

- auto-tagging
- auto-labeling
- embeddings or semantic search
- multi-label review workflows beyond manual toggles
- message-level labels
- dataset versioning
