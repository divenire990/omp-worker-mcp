#!/usr/bin/env node
import { copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CI_WORKFLOW_FILE,
  ReleaseError,
  TRUSTED_BRANCH,
  TRUSTED_REF,
  TRUSTED_REPOSITORY,
  checkGithubReleaseExists,
  createReleaseArtifactManifest,
  decideReleaseAction,
  evaluateTriggerGate,
  fetchGithubApiJson,
  fetchNpmRegistryState,
  isValidGitSha,
  parseReleaseCliArgs,
  redactSecrets,
  resolveGitState,
  runSafeCommand,
  validateReleaseMetadata,
  verifyCheckoutAndAncestry,
  verifyReleaseArtifact,
  writeGithubOutputs,
} from "./release.mjs";

async function preparePackOutputDir(rootDir, rawOutputDir) {
  const trimmed = typeof rawOutputDir === "string" ? rawOutputDir.trim() : "";
  if (!trimmed) {
    throw new ReleaseError("INVALID_OUTPUT_DIR", "pack-artifact requires a non-empty workspace child --output-dir");
  }
  const canonicalRoot = await realpath(rootDir);
  const candidatePath = path.resolve(canonicalRoot, trimmed);
  const rel = path.relative(canonicalRoot, candidatePath);
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ReleaseError(
      "INVALID_OUTPUT_DIR",
      `Refusing to pack into workspace root or path outside workspace: "${rawOutputDir}"`,
    );
  }
  const segments = rel.split(path.sep);
  if (segments.some((seg) => !seg || seg === "." || seg === "..")) {
    throw new ReleaseError("INVALID_OUTPUT_DIR", `Invalid output directory path "${rawOutputDir}"`);
  }

  let currentPath = canonicalRoot;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    if (existsSync(currentPath)) {
      const st = await lstat(currentPath);
      if (st.isSymbolicLink()) {
        throw new ReleaseError("INVALID_OUTPUT_DIR", `Refusing to pack into symlinked path "${currentPath}"`);
      }
      if (!st.isDirectory()) {
        throw new ReleaseError("INVALID_OUTPUT_DIR", `Output path "${currentPath}" exists and is not a directory`);
      }
      const realCurrent = await realpath(currentPath);
      const realRel = path.relative(canonicalRoot, realCurrent);
      if (!realRel || realRel === "." || realRel.startsWith("..") || path.isAbsolute(realRel)) {
        throw new ReleaseError("INVALID_OUTPUT_DIR", `Output path "${currentPath}" escapes workspace root`);
      }
    }
  }

  if (existsSync(candidatePath)) {
    const existingEntries = await readdir(candidatePath);
    if (existingEntries.length > 0) {
      throw new ReleaseError(
        "INVALID_OUTPUT_DIR",
        `Refusing to pack into non-empty directory "${candidatePath}"; provide an empty workspace child directory`,
      );
    }
  } else {
    await mkdir(candidatePath, { recursive: true });
  }

  const finalStat = await lstat(candidatePath);
  if (finalStat.isSymbolicLink() || !finalStat.isDirectory()) {
    throw new ReleaseError("INVALID_OUTPUT_DIR", `Output path "${candidatePath}" is not a regular directory`);
  }
  const canonicalOutput = await realpath(candidatePath);
  const finalRel = path.relative(canonicalRoot, canonicalOutput);
  if (!finalRel || finalRel === "." || finalRel.startsWith("..") || path.isAbsolute(finalRel)) {
    throw new ReleaseError("INVALID_OUTPUT_DIR", `Output directory "${candidatePath}" escapes workspace root`);
  }
  return { canonicalRoot, outputDir: canonicalOutput };
}

export async function runPackArtifactMode(rootDir, options = {}) {
  const headSha = (options.headSha || process.env.GITHUB_SHA || "").trim().toLowerCase();
  const ciRunId = (options.ciRunId || process.env.GITHUB_RUN_ID || "").trim();
  const repository = process.env.GITHUB_REPOSITORY || TRUSTED_REPOSITORY;

  if (!isValidGitSha(headSha) || !/^\d+$/.test(ciRunId)) {
    throw new ReleaseError("SHA_MISMATCH", `pack-artifact requires valid GITHUB_SHA and numeric GITHUB_RUN_ID`);
  }

  const rawOutputDir = options.outputDir === undefined ? ".release-artifact" : options.outputDir;
  const { canonicalRoot, outputDir } = await preparePackOutputDir(rootDir, rawOutputDir);
  const metadata = await validateReleaseMetadata({ rootDir: canonicalRoot });

  const runCommand = options.runCommand || runSafeCommand;
  if (!options.runCommand && process.platform === "win32" && process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    await runSafeCommand(process.execPath, [process.env.npm_execpath, "pack", "--pack-destination", outputDir], {
      cwd: canonicalRoot,
    });
  } else {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    await runCommand(npmCmd, ["pack", "--pack-destination", outputDir], { cwd: canonicalRoot });
  }
  const tarballName = `${metadata.packageName}-${metadata.version}.tgz`;
  const tarballPath = path.join(outputDir, tarballName);
  await copyFile(path.join(rootDir, "server.json"), path.join(outputDir, "server.json"));

  const manifest = await createReleaseArtifactManifest({
    tarballPath,
    headSha,
    ciRunId,
    repository,
    metadata,
  });
  await writeFile(path.join(outputDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeGithubOutputs({
    version: metadata.version,
    tag_name: metadata.tagName,
    head_sha: headSha,
    ci_run_id: ciRunId,
    tarball_name: tarballName,
    tarball_sha256: manifest.tarballSha256,
  });
  console.log(JSON.stringify({ ok: true, mode: "pack-artifact", version: metadata.version, headSha, ciRunId, tarballSha256: manifest.tarballSha256 }));
}

async function runResolveContextMode(options) {
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  const repository = process.env.GITHUB_REPOSITORY || TRUSTED_REPOSITORY;
  const ref = process.env.GITHUB_REF || "";
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");

  if (!process.env.GITHUB_EVENT_PATH || !existsSync(process.env.GITHUB_EVENT_PATH)) {
    throw new ReleaseError("UNTRUSTED_EVENT", "GITHUB_EVENT_PATH is missing");
  }
  const eventPayload = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  let matchedCiRun = null;
  let targetRunId = String(eventPayload.workflow_run?.id ?? "").trim();

  if (eventName === "workflow_dispatch") {
    const requestedSha = String(options.headSha || eventPayload.inputs?.head_sha || "").trim().toLowerCase();
    const requestedRunId = String(options.ciRunId || eventPayload.inputs?.ci_run_id || "").trim();
    if (!isValidGitSha(requestedSha)) {
      throw new ReleaseError("SHA_MISMATCH", `Invalid workflow_dispatch head_sha "${requestedSha}"`);
    }
    if (requestedRunId) {
      matchedCiRun = await fetchGithubApiJson(`${apiBase}/repos/${repository}/actions/runs/${encodeURIComponent(requestedRunId)}`, token);
    } else {
      const runsData = await fetchGithubApiJson(
        `${apiBase}/repos/${repository}/actions/workflows/${CI_WORKFLOW_FILE}/runs?head_sha=${encodeURIComponent(requestedSha)}&event=push&branch=${encodeURIComponent(TRUSTED_BRANCH)}&status=completed&per_page=10`,
        token,
      );
      matchedCiRun = (runsData?.workflow_runs || []).find(
        (r) => r && String(r.head_sha ?? "").toLowerCase() === requestedSha && r.conclusion === "success" && r.event === "push" && r.head_branch === TRUSTED_BRANCH,
      ) || null;
    }
    targetRunId = String(matchedCiRun?.id ?? "").trim();
  }

  const jobsData = /^\d+$/.test(targetRunId)
    ? await fetchGithubApiJson(`${apiBase}/repos/${repository}/actions/runs/${encodeURIComponent(targetRunId)}/jobs?per_page=100`, token)
    : null;

  const gateResult = evaluateTriggerGate({
    eventName,
    repository,
    expectedRepository: TRUSTED_REPOSITORY,
    expectedBranch: TRUSTED_BRANCH,
    expectedRef: TRUSTED_REF,
    ref,
    workflowRun: eventPayload.workflow_run ?? null,
    dispatchInputs: {
      head_sha: options.headSha || eventPayload.inputs?.head_sha || "",
      ci_run_id: options.ciRunId || eventPayload.inputs?.ci_run_id || "",
    },
    matchedCiRun,
    ciJobs: jobsData?.jobs ?? [],
  });

  await writeGithubOutputs({
    head_sha: gateResult.headSha,
    ci_run_id: gateResult.ciRunId,
    trigger_type: gateResult.triggerType,
    artifact_name: `release-bundle-${gateResult.headSha}`,
  });
  console.log(JSON.stringify({ ok: true, mode: "resolve-context", ...gateResult }));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseReleaseCliArgs(argv);
  const rootDir = process.cwd();

  if (options.mode === "pack-artifact") return runPackArtifactMode(rootDir, options);
  if (options.mode === "resolve-context") return runResolveContextMode(options);

  const metadata = await validateReleaseMetadata({ rootDir });
  if (options.offline || options.mode === "ci-validate") {
    console.log(JSON.stringify({
      ok: true,
      mode: options.offline ? "offline" : options.mode,
      packageName: metadata.packageName,
      version: metadata.version,
      mcpName: metadata.mcpName,
      tagName: metadata.tagName,
      changelogHeading: metadata.changelogSection?.header ?? null,
    }));
    return;
  }

  const expectedHeadSha = (options.headSha || process.env.GITHUB_SHA || "").trim().toLowerCase();
  const expectedCiRunId = (options.ciRunId || "").trim();
  const repository = process.env.GITHUB_REPOSITORY || TRUSTED_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

  const gitState = await resolveGitState(rootDir, metadata.tagName, expectedHeadSha);
  verifyCheckoutAndAncestry({
    expectedHeadSha,
    checkedOutSha: gitState.checkedOutSha,
    isAncestorOfMaster: gitState.isAncestorOfMaster,
    masterTipVersion: gitState.masterTipVersion,
    targetVersion: metadata.version,
  });

  const verifiedArtifact = await verifyReleaseArtifact({
    artifactDir: options.artifactDir ? path.resolve(rootDir, options.artifactDir) : "",
    expectedHeadSha,
    expectedCiRunId,
    expectedRepository: repository,
    metadata,
  });
  const npmState = await fetchNpmRegistryState(metadata.packageName);
  const githubReleaseExists = await checkGithubReleaseExists(repository, metadata.tagName, token);

  const decision = decideReleaseAction({
    targetVersion: metadata.version,
    headSha: expectedHeadSha,
    parentPackageVersion: gitState.parentPackageVersion,
    eventName: process.env.GITHUB_EVENT_NAME || "workflow_run",
    npmState,
    existingTagSha: gitState.existingTagSha,
    githubReleaseExists,
    expectedTarballShasum: verifiedArtifact.tarballShasum,
  });

  await writeGithubOutputs({
    should_publish: String(decision.shouldPublish),
    npm_already_published: String(decision.npmAlreadyPublished),
    decision_reason: decision.reason,
    version: metadata.version,
    tag_name: metadata.tagName,
    head_sha: expectedHeadSha,
    ci_run_id: expectedCiRunId,
    tarball_sha256: verifiedArtifact.tarballSha256,
  });
  console.log(JSON.stringify({ ok: true, mode: "gate", ...decision, npmLatest: npmState.latest }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    const secrets = [process.env.NPM_TOKEN, process.env.NODE_AUTH_TOKEN, process.env.GITHUB_TOKEN].filter(Boolean);
    const code = error instanceof ReleaseError ? error.code : "UNEXPECTED_ERROR";
    console.error(`[check-release:${code}] ${redactSecrets(error?.message || String(error), secrets)}`);
    process.exitCode = 1;
  });
}
