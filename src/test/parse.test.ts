import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureDirectory } from "../distill/fs";
import { parseClaudeCodeCapture } from "../connectors/claude_code/parse";
import { parseCodexCapture } from "../connectors/codex/parse";
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

    const parsed = parseCodexCapture(capture);
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

    const parsed = parseCodexCapture({
      sourceKind: "codex",
      captureKind: "archived_session",
      sourcePath: capturePath,
      externalSessionId: "session-2",
      metadata: {}
    });

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

    const parsed = parseCodexCapture({
      sourceKind: "codex",
      captureKind: "archived_session",
      sourcePath: capturePath,
      externalSessionId: "session-2",
      metadata: {}
    });

    assert.equal(parsed.session.title, "Investigate the cache invalidation regression");
    assert.equal(parsed.session.model, "gpt-5.4");
    assert.equal(parsed.session.modelProvider, "openai");
    assert.equal(parsed.session.cliVersion, "1.2.3");
    assert.equal(parsed.session.projectPath, "/tmp/fallback");
    assert.equal(parsed.messages.length, 1);
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

    const parsed = parseClaudeCodeCapture(capture);
    assert.equal(parsed.session.title, "Please fix the layout and spacing.");
    assert.equal(parsed.messages.length, 2);
    assert.equal(parsed.messages[0]?.text, "Please fix the layout and spacing.");
    assert.equal(parsed.messages[1]?.text, "I will tighten the layout.");
    assert.equal(parsed.artifacts.length, 1);
    assert.equal(parsed.artifacts[0]?.kind, "tool_call");
  });
});
