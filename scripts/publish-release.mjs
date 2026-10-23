#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ReleaseError,
  TRUSTED_REPOSITORY,
  checkGithubReleaseExists,
  decideReleaseAction,
  executeOrderedRelease,
  fetchNpmRegistryState,
  isValidGitSha,
  parseReleaseCliArgs,
  redactSecrets,
  resolveGitState,
  runSafeCommand,
  validateReleaseMetadata,
  verifyCheckoutAndAncestry,
  verifyReleaseArtifact,
} from "./release.mjs";

export async function main(argv = process.argv.slice(2)) {
  const options = parseReleaseCliArgs(argv);
  const rootDir = process.cwd();
  const repository = process.env.GITHUB_REPOSITORY || TRUSTED_REPOSITORY;
  const eventName = process.env.GITHUB_EVENT_NAME || "workflow_run";
  const expectedHeadSha = (options.headSha || process.env.GITHUB_SHA || "").trim().toLowerCase();
  const expectedCiRunId = (options.ciRunId || "").trim();

  if (!isValidGitSha(expectedHeadSha)) {
    throw new ReleaseError("SHA_MISMATCH", `publish-release requires a valid 40-char --head-sha (got "${expectedHeadSha}")`);
  }
  if (!options.artifactDir) {
    throw new ReleaseError("ARTIFACT_MISMATCH", "publish-release requires --artifact-dir");
  }

  const metadata = await validateReleaseMetadata({ rootDir });
  const gitState = await resolveGitState(rootDir, metadata.tagName, expectedHeadSha);
  verifyCheckoutAndAncestry({
    expectedHeadSha,
    checkedOutSha: gitState.checkedOutSha,
    isAncestorOfMaster: gitState.isAncestorOfMaster,
    masterTipVersion: gitState.masterTipVersion,
    targetVersion: metadata.version,
  });

  const artifactDir = path.resolve(rootDir, options.artifactDir);
  const verifiedArtifact = await verifyReleaseArtifact({
    artifactDir,
    expectedHeadSha,
    expectedCiRunId,
    expectedRepository: repository,
    metadata,
  });

  const npmState = await fetchNpmRegistryState(metadata.packageName);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const githubReleaseExists = await checkGithubReleaseExists(repository, metadata.tagName, token);

  const decision = decideReleaseAction({
    targetVersion: metadata.version,
    headSha: expectedHeadSha,
    parentPackageVersion: gitState.parentPackageVersion,
    eventName,
    npmState,
    existingTagSha: gitState.existingTagSha,
    githubReleaseExists,
    expectedTarballShasum: verifiedArtifact.tarballShasum,
  });

  if (options.dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, version: metadata.version, decision }));
    return;
  }

  const result = await executeOrderedRelease({
    artifactDir,
    expectedHeadSha,
    expectedCiRunId,
    metadata,
    decision,
    env: process.env,
    runCommand: (cmd, args, opts) => {
      const resolvedCmd = process.platform === "win32" && (cmd === "npm" || cmd === "npx") ? `${cmd}.cmd` : cmd;
      return runSafeCommand(resolvedCmd, args, { cwd: rootDir, ...opts });
    },
    existingTagSha: gitState.existingTagSha,
    githubReleaseExists,
  });

  console.log(JSON.stringify({ ok: true, ...result }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    const secrets = [process.env.NPM_TOKEN, process.env.NODE_AUTH_TOKEN, process.env.GITHUB_TOKEN, process.env.GH_TOKEN].filter(Boolean);
    const code = error instanceof ReleaseError ? error.code : "UNEXPECTED_ERROR";
    const hint = error instanceof ReleaseError && error.recoveryHint ? ` Recovery: ${error.recoveryHint}` : "";
    console.error(`[publish-release:${code}] ${redactSecrets(error?.message || String(error), secrets)}${hint}`);
    process.exitCode = 1;
  });
}
