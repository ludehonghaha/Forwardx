import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const trackedFiles = new Set([
  ".github/workflows/release-agent.yml",
  "scripts/build-agent-release.sh",
  "scripts/detect-agent-release-input-changes.mjs",
  "THIRD_PARTY_NOTICES.md",
]);

function runGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function readAgentVersion(ref, cwd) {
  const versions = runGit(["show", `${ref}:shared/versions.ts`], cwd);
  const match = versions.match(/AGENT_VERSION\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error(`AGENT_VERSION is missing at ${ref}`);
  return match[1];
}

function isTrackedAgentInput(file) {
  return file.startsWith("agent/")
    || file.startsWith("forwardx-fxp/")
    || trackedFiles.has(file);
}

export function detectAgentReleaseInputChanges({ baseRef, headRef, cwd = process.cwd() }) {
  const changedOutput = runGit(["diff", "--name-only", baseRef, headRef], cwd);
  const changedPaths = changedOutput ? changedOutput.split("\n") : [];
  const trackedChanges = changedPaths.filter(isTrackedAgentInput);
  const baseAgentVersion = readAgentVersion(baseRef, cwd);
  const headAgentVersion = readAgentVersion(headRef, cwd);
  const agentVersionChanged = baseAgentVersion !== headAgentVersion;

  return {
    required: trackedChanges.length > 0 || agentVersionChanged,
    trackedChanges,
    baseAgentVersion,
    headAgentVersion,
    agentVersionChanged,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [, , baseRef, headRef] = process.argv;
  if (!baseRef || !headRef) {
    console.error("usage: node scripts/detect-agent-release-input-changes.mjs <base-ref> <head-ref>");
    process.exit(2);
  }

  const result = detectAgentReleaseInputChanges({ baseRef, headRef });
  console.error(`Agent release input base: ${baseRef} (Agent ${result.baseAgentVersion})`);
  console.error(`Agent release input head: ${headRef} (Agent ${result.headAgentVersion})`);
  if (result.trackedChanges.length > 0) {
    console.error(result.trackedChanges.join("\n"));
  }
  if (result.agentVersionChanged) {
    console.error("shared/versions.ts AGENT_VERSION changed");
  }
  process.stdout.write(result.required ? "true" : "false");
}
