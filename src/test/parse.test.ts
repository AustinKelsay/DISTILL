import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureDirectory } from "../distill/fs";
import { parseClaudeCodeCapture } from "../connectors/claude_code/parse";
import { snapshotClaudeCodeCapture } from "../connectors/claude_code/snapshot";
import { parseCodexCapture } from "../connectors/codex/parse";
import { snapshotCodexCapture } from "../connectors/codex/snapshot";
import { openCodeTimestampToIso } from "../connectors/opencode/common";
import { parseOpenCodeCapture } from "../connectors/opencode/parse";
import { DiscoveredCapture } from "../shared/types";

function withTempHomes<T>(fn: (root: string) => T): T {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "distill-parse-"));
  const previous = {
    CODEX_HOME: process.env.CODEX_HOME,
    CLAUDE_HOME: process.env.CLAUDE_HOME
  };

  process.env.CODEX_HOME = path.join(tempRoot, ".codex");
  process.env.CLAUDE_HOME = path.join(tempRoot, ".claude");

  try {
    return fn(tempRoot);
  } finally {
    process.env.CODEX_HOME = previous.CODEX_HOME;
    process.env.CLAUDE_HOME = previous.CLAUDE_HOME;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("parseCodexCapture filters bootstrap noise and keeps real chat messages", () => {
  withTempHomes((root) => {
    const codexHome = path.join(root, ".codex");
    ensureDirectory(path.join(codexHome, "archived_sessions"));
    fs.writeFileSync(
      path.join(codexHome, "session_index.jsonl"),
      `${JSON.stringify({ id: "session-1", thread_name: "Real session", updated_at: "2026-03-25T10:03:00Z" })}\n`
    );

    const capturePath = path.join(codexHome, "archived_sessions", "rollout-2026-03-25-session-1.jsonl");
    fs.writeFileSync(
      capturePath,
      [
        JSON.stringify({
          timestamp: "2026-03-25T10:00:00Z",
          type: "session_meta",
          payload: { id: "session-1", cwd: "/tmp/proj", cli_version: "1.0.0", model_provider: "openai" }
        }),
        JSON.stringify({
          timestamp: "2026-03-25T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/tmp/proj</cwd>" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-25T10:00:02Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Ship the real feature" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-25T10:00:03Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "I will update the code." }]
          }
        })
      ].join("\n")
    );

    const capture: DiscoveredCapture = {
      sourceKind: "codex",
      captureKind: "archived_session",
      sourcePath: capturePath,
      externalSessionId: "session-1",
      metadata: {}
    };

    const parsed = parseCodexCapture(capture, snapshotCodexCapture(capture));
    assert.equal(parsed.session.title, "Real session");
    assert.equal(parsed.messages.length, 2);
    assert.equal(parsed.messages[0]?.text, "Ship the real feature");
    assert.equal(parsed.messages[1]?.text, "I will update the code.");
  });
});

test("parseCodexCapture skips AGENTS instruction blobs before the real task", () => {
  withTempHomes((root) => {
    const codexHome = path.join(root, ".codex");
    ensureDirectory(path.join(codexHome, "archived_sessions"));

    const capturePath = path.join(codexHome, "archived_sessions", "rollout-2026-03-25-session-2.jsonl");
    fs.writeFileSync(
      capturePath,
      [
        JSON.stringify({
          timestamp: "2026-03-25T10:00:00Z",
          type: "session_meta",
          payload: { id: "session-2", cwd: "/tmp/proj" }
        }),
        JSON.stringify({
          timestamp: "2026-03-25T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "# AGENTS.md instructions for /tmp/proj\n\n<INSTRUCTIONS>\n# Repository Guidelines\nUse tests.\n</INSTRUCTIONS>"
              }
            ]
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-25T10:00:02Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Implement the MCP settings page." }]
          }
        })
      ].join("\n")
    );

    const capture: DiscoveredCapture = {
      sourceKind: "codex",
      captureKind: "archived_session",
      sourcePath: capturePath,
      externalSessionId: "session-2",
      metadata: {}
    };

    const parsed = parseCodexCapture(capture, snapshotCodexCapture(capture));

    assert.equal(parsed.messages.length, 1);
    assert.equal(parsed.messages[0]?.text, "Implement the MCP settings page.");
  });
});

test("parseCodexCapture falls back to the first user message for title and captures model metadata", () => {
  withTempHomes((root) => {
    const codexHome = path.join(root, ".codex");
    ensureDirectory(path.join(codexHome, "archived_sessions"));

    const capturePath = path.join(codexHome, "archived_sessions", "rollout-2026-03-25-session-2.jsonl");
    fs.writeFileSync(
      capturePath,
      [
        JSON.stringify({
          timestamp: "2026-03-25T12:00:00Z",
          type: "session_meta",
          payload: { id: "session-2", cwd: "/tmp/fallback", cli_version: "1.2.3", model_provider: "openai" }
        }),
        JSON.stringify({
          timestamp: "2026-03-25T12:00:01Z",
          type: "turn_context",
          payload: { model: "gpt-5.4" }
        }),
        JSON.stringify({
          timestamp: "2026-03-25T12:00:02Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Investigate the cache invalidation regression\nwith more detail." }]
          }
        })
      ].join("\n")
    );

    const capture: DiscoveredCapture = {
      sourceKind: "codex",
      captureKind: "archived_session",
      sourcePath: capturePath,
      externalSessionId: "session-2",
      metadata: {}
    };

    const parsed = parseCodexCapture(capture, snapshotCodexCapture(capture));

    assert.equal(parsed.session.title, "Investigate the cache invalidation regression");
    assert.equal(parsed.session.model, "gpt-5.4");
    assert.equal(parsed.session.modelProvider, "openai");
    assert.equal(parsed.session.cliVersion, "1.2.3");
    assert.equal(parsed.session.projectPath, "/tmp/fallback");
    assert.equal(parsed.messages.length, 1);
  });
});

test("parseCodexCapture records synthetic external session id provenance when the source id is missing", () => {
  withTempHomes((root) => {
    const codexHome = path.join(root, ".codex");
    ensureDirectory(path.join(codexHome, "archived_sessions"));

    const capturePath = path.join(codexHome, "archived_sessions", "notes.jsonl");
    fs.writeFileSync(
      capturePath,
      [
        JSON.stringify({
          timestamp: "2026-03-25T12:10:00Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Fallback to a synthetic id" }]
          }
        })
      ].join("\n")
    );

    const capture: DiscoveredCapture = {
      sourceKind: "codex",
      captureKind: "archived_session",
      sourcePath: capturePath,
      metadata: {}
    };

    const parsed = parseCodexCapture(capture, snapshotCodexCapture(capture));

    assert.equal(parsed.session.externalSessionId, "notes.jsonl");
    assert.deepEqual(parsed.session.metadata.externalSessionIdProvenance, {
      kind: "synthetic",
      strategy: "capture_path_basename"
    });
  });
});

test("parseClaudeCodeCapture filters command noise and derives a useful title", () => {
  withTempHomes((root) => {
    const claudeHome = path.join(root, ".claude");
    ensureDirectory(path.join(claudeHome, "projects", "demo"));
    fs.writeFileSync(
      path.join(claudeHome, "history.jsonl"),
      `${JSON.stringify({
        display: "<command-name>/model</command-name>",
        timestamp: 1,
        project: "/tmp/demo",
        sessionId: "claude-session-1"
      })}\n`
    );

    const capturePath = path.join(claudeHome, "projects", "demo", "claude-session-1.jsonl");
    fs.writeFileSync(
      capturePath,
      [
        JSON.stringify({
          type: "user",
          uuid: "u1",
          sessionId: "claude-session-1",
          timestamp: "2026-03-25T11:00:00Z",
          cwd: "/tmp/demo",
          message: {
            role: "user",
            content: [{ type: "text", text: "<command-name>/model</command-name>" }]
          }
        }),
        JSON.stringify({
          type: "user",
          uuid: "u2",
          sessionId: "claude-session-1",
          timestamp: "2026-03-25T11:00:01Z",
          cwd: "/tmp/demo",
          message: {
            role: "user",
            content: [{ type: "text", text: "Please fix the layout and spacing." }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "a1",
          parentUuid: "u2",
          sessionId: "claude-session-1",
          timestamp: "2026-03-25T11:00:02Z",
          cwd: "/tmp/demo",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "hidden" },
              { type: "text", text: "I will tighten the layout." },
              { type: "tool_use", name: "Read" }
            ]
          }
        })
      ].join("\n")
    );

    const capture: DiscoveredCapture = {
      sourceKind: "claude_code",
      captureKind: "project_session",
      sourcePath: capturePath,
      externalSessionId: "claude-session-1",
      metadata: { projectFolder: "/tmp/demo" }
    };

    const parsed = parseClaudeCodeCapture(capture, snapshotClaudeCodeCapture(capture));
    assert.equal(parsed.session.title, "Please fix the layout and spacing.");
    assert.equal(parsed.messages.length, 2);
    assert.equal(parsed.messages[0]?.text, "Please fix the layout and spacing.");
    assert.equal(parsed.messages[1]?.text, "I will tighten the layout.");
    assert.equal(parsed.artifacts.length, 1);
    assert.equal(parsed.artifacts[0]?.kind, "tool_call");
  });
});

test("parseOpenCodeCapture preserves visible trace parts and falls back from generated titles", () => {
  const capture: DiscoveredCapture = {
    sourceKind: "opencode",
    captureKind: "session_export",
    sourcePath: "opencode://session/ses_1",
    externalSessionId: "ses_1",
    sourceModifiedAt: "2026-03-26T19:24:35.213Z",
    metadata: {
      shareUrl: "https://opencode.ai/share/ses_1",
      timeUpdated: 1774543475213,
      timeArchived: null
    }
  };

  const parsed = parseOpenCodeCapture(capture, {
    rawText: JSON.stringify({
      info: {
        id: "ses_1",
        slug: "tidy-wizard",
        projectID: "global",
        directory: "/tmp/demo",
        title: "New session - 2026-03-26T19:15:49.354Z",
        version: "1.3.3",
        time: {
          created: 1774543194067,
          updated: 1774543475213
        }
      },
      messages: [
        {
          info: {
            id: "msg_user",
            role: "user",
            time: { created: 1774543194080 },
            model: { providerID: "ollama", modelID: "nemotron-cascade-2:30b" }
          },
          parts: [
            { id: "part_user_text", type: "text", text: "Do I have a project for VisiBible in GTDspace?" }
          ]
        },
        {
          info: {
            id: "msg_assistant",
            role: "assistant",
            parentID: "msg_user",
            time: { created: 1774543194090 },
            providerID: "ollama",
            modelID: "nemotron-cascade-2:30b"
          },
          parts: [
            { id: "part_step_start", type: "step-start" },
            { id: "part_reasoning", type: "reasoning", text: "We should search GTDspace first." },
            {
              id: "part_tool",
              type: "tool",
              tool: "gtdspace_workspace_search",
              callID: "call_1",
              state: {
                status: "completed",
                title: "Search workspace",
                output: "{\"matches\":[]}",
                attachments: [
                  {
                    type: "file",
                    mime: "text/plain",
                    filename: "report.txt",
                    url: "file:///tmp/demo/report.txt"
                  }
                ]
              }
            },
            {
              id: "part_file",
              type: "file",
              mime: "text/plain",
              filename: "input.txt",
              url: "file:///tmp/demo/input.txt",
              source: {
                type: "file",
                path: "/tmp/demo/input.txt"
              }
            },
            {
              id: "part_text",
              type: "text",
              text: "Yes. Your GTDSpace includes a project named Visibible."
            },
            {
              id: "part_step_finish",
              type: "step-finish",
              reason: "stop",
              tokens: { input: 12, output: 34, reasoning: 0, cache: { read: 0, write: 0 } }
            }
          ]
        }
      ]
    }),
    rawSha256: "sha",
    sourceModifiedAt: "2026-03-26T19:24:35.213Z",
    sourceSizeBytes: 100
  });

  assert.equal(parsed.session.title, "Do I have a project for VisiBible in GTDspace?");
  assert.equal(parsed.session.sourceUrl, "https://opencode.ai/share/ses_1");
  assert.equal(parsed.session.model, "nemotron-cascade-2:30b");
  assert.equal(parsed.session.modelProvider, "ollama");
  assert.deepEqual(parsed.messages.map((message) => ({ role: message.role, kind: message.messageKind })), [
    { role: "user", kind: "text" },
    { role: "assistant", kind: "meta" },
    { role: "assistant", kind: "meta" },
    { role: "tool", kind: "meta" },
    { role: "assistant", kind: "meta" },
    { role: "assistant", kind: "text" },
    { role: "assistant", kind: "meta" }
  ]);
  assert.equal(parsed.messages[2]?.text, "We should search GTDspace first.");
  assert.match(parsed.messages[3]?.text ?? "", /\[tool:completed\]/);
  assert.deepEqual(parsed.artifacts.map((artifact) => artifact.kind), ["tool_call", "tool_result", "file", "file"]);
});

test("parseOpenCodeCapture keeps the last populated assistant model when later messages omit model metadata", () => {
  const capture: DiscoveredCapture = {
    sourceKind: "opencode",
    captureKind: "session_export",
    sourcePath: "opencode://session/ses_2",
    externalSessionId: "ses_2",
    metadata: {}
  };

  const parsed = parseOpenCodeCapture(capture, {
    rawText: JSON.stringify({
      info: {
        id: "ses_2",
        title: "Model retention"
      },
      messages: [
        {
          info: {
            id: "msg_user",
            role: "user",
            time: { created: 1774543194080 },
            model: { providerID: "ollama", modelID: "draft-model" }
          },
          parts: [{ id: "part_user", type: "text", text: "Keep the detected assistant model" }]
        },
        {
          info: {
            id: "msg_assistant_1",
            role: "assistant",
            parentID: "msg_user",
            time: { created: 1774543194090 },
            providerID: "openai",
            modelID: "final-model"
          },
          parts: [{ id: "part_assistant_1", type: "text", text: "Using the final model." }]
        },
        {
          info: {
            id: "msg_assistant_2",
            role: "assistant",
            parentID: "msg_assistant_1",
            time: { created: 1774543195000 }
          },
          parts: [{ id: "part_assistant_2", type: "text", text: "Continuing without model metadata." }]
        }
      ]
    }),
    rawSha256: "sha-2",
    sourceModifiedAt: "2026-03-26T19:24:35.213Z",
    sourceSizeBytes: 120
  });

  assert.equal(parsed.session.model, "final-model");
  assert.equal(parsed.session.modelProvider, "openai");
});

test("parseOpenCodeCapture preserves system roles from OpenCode exports", () => {
  const capture: DiscoveredCapture = {
    sourceKind: "opencode",
    captureKind: "session_export",
    sourcePath: "opencode://session/ses_system",
    externalSessionId: "ses_system",
    metadata: {}
  };

  const parsed = parseOpenCodeCapture(capture, {
    rawText: JSON.stringify({
      info: {
        id: "ses_system",
        title: "System role retention"
      },
      messages: [
        {
          info: {
            id: "msg_system",
            role: "system",
            time: { created: 1774543194000 }
          },
          parts: [{ id: "part_system", type: "text", text: "You are a focused coding assistant." }]
        }
      ]
    }),
    rawSha256: "sha-system",
    sourceModifiedAt: "2026-03-26T19:24:35.213Z",
    sourceSizeBytes: 64
  });

  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0]?.role, "system");
  assert.equal(parsed.messages[0]?.text, "You are a focused coding assistant.");
});

test("openCodeTimestampToIso returns undefined for out-of-range timestamps", () => {
  assert.equal(openCodeTimestampToIso(Number.MAX_VALUE), undefined);
  assert.equal(openCodeTimestampToIso(String(Number.MAX_VALUE)), undefined);
});
