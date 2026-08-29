import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { detectAgentReleaseInputChanges } from "./detect-agent-release-input-changes.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(cwd, path, contents) {
  const target = join(cwd, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents);
}

function commitAll(cwd, message) {
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

test("a release-only bump still rebuilds Agent when source changed after the previous formal release", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "forwardx-agent-release-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init");
  git(cwd, "config", "user.name", "ForwardX Test");
  git(cwd, "config", "user.email", "forwardx-test@example.invalid");

  write(cwd, "agent/main.go", "package main\nconst Version = \"2.2.195\"\n");
  write(cwd, "package.json", '{"version":"2.3.284"}\n');
  write(cwd, "shared/versions.ts", 'export const APP_VERSION = "2.3.284";\nexport const AGENT_VERSION = "2.2.195";\n');
  commitAll(cwd, "release 2.3.284");
  git(cwd, "tag", "v2.3.284");

  write(cwd, "agent/main.go", "package main\nconst Version = \"2.2.196\"\n");
  write(cwd, "shared/versions.ts", 'export const APP_VERSION = "2.3.284";\nexport const AGENT_VERSION = "2.2.196";\n');
  const agentSourceHead = commitAll(cwd, "add Agent runtime changes");

  write(cwd, "package.json", '{"version":"2.3.285"}\n');
  write(cwd, "shared/versions.ts", 'export const APP_VERSION = "2.3.285";\nexport const AGENT_VERSION = "2.2.196";\n');
  const releaseHead = commitAll(cwd, "prepare release 2.3.285");

  const immediateCommitComparison = detectAgentReleaseInputChanges({
    baseRef: agentSourceHead,
    headRef: releaseHead,
    cwd,
  });
  assert.equal(immediateCommitComparison.required, false);

  const formalReleaseComparison = detectAgentReleaseInputChanges({
    baseRef: "v2.3.284",
    headRef: releaseHead,
    cwd,
  });
  assert.equal(formalReleaseComparison.required, true);
  assert.deepEqual(formalReleaseComparison.trackedChanges, ["agent/main.go"]);
  assert.equal(formalReleaseComparison.agentVersionChanged, true);
});

test("release metadata changes alone keep reusable Agent assets eligible", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "forwardx-agent-release-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init");
  git(cwd, "config", "user.name", "ForwardX Test");
  git(cwd, "config", "user.email", "forwardx-test@example.invalid");

  write(cwd, "agent/main.go", "package main\nconst Version = \"2.2.196\"\n");
  write(cwd, "package.json", '{"version":"2.3.285"}\n');
  write(cwd, "shared/versions.ts", 'export const APP_VERSION = "2.3.285";\nexport const AGENT_VERSION = "2.2.196";\n');
  commitAll(cwd, "release 2.3.285");
  git(cwd, "tag", "v2.3.285");

  write(cwd, "package.json", '{"version":"2.3.286"}\n');
  write(cwd, "shared/versions.ts", 'export const APP_VERSION = "2.3.286";\nexport const AGENT_VERSION = "2.2.196";\n');
  const releaseHead = commitAll(cwd, "prepare release 2.3.286");

  const result = detectAgentReleaseInputChanges({
    baseRef: "v2.3.285",
    headRef: releaseHead,
    cwd,
  });
  assert.equal(result.required, false);
  assert.deepEqual(result.trackedChanges, []);
  assert.equal(result.agentVersionChanged, false);
});
