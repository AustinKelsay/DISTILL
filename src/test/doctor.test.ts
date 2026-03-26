import assert from "node:assert/strict";
import test from "node:test";
import { buildDoctorReport } from "../distill/doctor";
import { expandHome } from "../distill/fs";

test("expandHome expands a home-relative path", () => {
  const home = process.env.HOME;
  assert.ok(home);
  assert.equal(expandHome("~/distill"), `${home}/distill`);
});

test("doctor report returns the expected source kinds", () => {
  const report = buildDoctorReport();

  assert.equal(typeof report.scannedAt, "string");
  assert.equal(report.sources.length, 3);

  const kinds = report.sources.map((source) => source.kind).sort();
  assert.deepEqual(kinds, ["claude_code", "codex", "opencode"]);

  for (const source of report.sources) {
    assert.ok(source.displayName.length > 0);
    assert.ok(["installed", "partial", "not_found"].includes(source.installStatus));
    assert.ok(Array.isArray(source.checks));
    assert.ok(source.checks.length > 0);
  }
});
