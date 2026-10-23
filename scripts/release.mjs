import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const TRUSTED_REPOSITORY = "divenire990/omp-worker-mcp";
export const TRUSTED_BRANCH = "master";
export const TRUSTED_REF = "refs/heads/master";
export const CI_WORKFLOW_NAME = "CI";
export const CI_WORKFLOW_FILE = "ci.yml";
export const REQUIRED_CI_OS_GATES = Object.freeze(["ubuntu-latest", "macos-latest", "windows-latest"]);
export const EXPECTED_PACKAGE_NAME = "omp-worker-mcp";
export const EXPECTED_MCP_NAME = "io.github.divenire990/omp-worker-mcp";
export const EXPECTED_REPO_URL = "https://github.com/divenire990/omp-worker-mcp";
export const DEFAULT_NPM_REGISTRY_URL = "https://registry.npmjs.org";
export const MCP_PUBLISHER_VERSION = "1.8.2";
export const MCP_PUBLISHER_TAG = "v1.8.2";
export const MCP_PUBLISHER_LINUX_X64 = Object.freeze({
  archiveName: "mcp-publisher_linux_amd64.tar.gz",
  binaryName: "mcp-publisher",
  url: "https://github.com/modelcontextprotocol/registry/releases/download/v1.8.2/mcp-publisher_linux_amd64.tar.gz",
  sha256: "d0554112d8f7affad9a10041776d63129a60b163c05036ae26caf73ecbbd89c8",
});

const GIT_SHA_REGEX = /^[0-9a-f]{40}$/i;
const STABLE_SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class ReleaseError extends Error {
  constructor(code, message, { category = "gate", retryable = false, recoveryHint = "", details = {}, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ReleaseError";
    this.code = code;
    this.category = category;
    this.retryable = Boolean(retryable);
    this.recoveryHint = recoveryHint;
    this.details = details;
  }
}

export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");
export const sha1Hex = (buf) => createHash("sha1").update(buf).digest("hex");
export const isValidGitSha = (val) => typeof val === "string" && GIT_SHA_REGEX.test(val.trim());

export function redactSecrets(input, explicitSecrets = []) {
  if (typeof input !== "string" || !input) return "";
  let out = input;
  for (const secret of explicitSecrets) {
    if (typeof secret === "string" && secret.trim().length >= 4) {
      out = out.split(secret).join("[REDACTED]").split(secret.trim()).join("[REDACTED]");
    }
  }
  return out
    .replace(/\b(?:npm_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g, "[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]")
    .replace(/(_authToken\s*=\s*)\S+/gi, "$1[REDACTED]")
    .replace(/(--token(?:=|\s+))\S+/gi, "$1[REDACTED]")
    .replace(/((?:NODE_AUTH_TOKEN|NPM_TOKEN)\s*=\s*)\S+/gi, "$1[REDACTED]");
}

export function parseSemver(version) {
  if (typeof version !== "string") return null;
  const match = STABLE_SEMVER_REGEX.exec(version.trim());
  return match ? { raw: match[0], major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new ReleaseError("INVALID_SEMVER", `Invalid stable semantic versions: "${a}" vs "${b}"`);
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return 0;
}

export function verifyOidcRuntimePrerequisites({ nodeVersion = process.versions.node, npmVersion } = {}) {
  const nodeParsed = parseSemver(String(nodeVersion || "").replace(/^v/, "").split("-")[0]);
  const npmParsed = parseSemver(String(npmVersion || "").trim().replace(/^v/, "").split("-")[0]);
  if (!nodeParsed || compareSemver(nodeParsed.raw, "22.14.0") < 0) {
    throw new ReleaseError("OIDC_RUNTIME_UNSUPPORTED", `npm OIDC requires Node.js >= 22.14.0 (got "${nodeVersion}")`);
  }
  if (!npmParsed || compareSemver(npmParsed.raw, "11.5.1") < 0) {
    throw new ReleaseError("OIDC_RUNTIME_UNSUPPORTED", `npm OIDC requires npm >= 11.5.1 (got "${npmVersion}")`);
  }
  return { nodeVersion: nodeParsed.raw, npmVersion: npmParsed.raw };
}

export function extractChangelogSection(changelogText, version) {
  if (typeof changelogText !== "string" || typeof version !== "string" || !version.trim()) return null;
  const normalized = changelogText.replace(/\r\n/g, "\n");
  const escaped = version.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## \\[\\s*v?${escaped}\\s*\\](?:\\s*-\\s*([^\\n]+))?\\s*$`, "m").exec(normalized);
  if (!match) return null;
  const rest = normalized.slice(match.index + match[0].length);
  const nextHeading = /^## \[/m.exec(rest);
  const body = (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
  return body ? { header: match[0].trim(), date: match[1]?.trim() || null, body, fullSection: `${match[0].trim()}\n\n${body}` } : null;
}

export async function validateReleaseMetadata({
  rootDir = process.cwd(),
  pkg = null,
  lock = null,
  serverJson = null,
  changelogText = null,
  requireChangelogSection = true,
  expectedPackageName = EXPECTED_PACKAGE_NAME,
  expectedMcpName = EXPECTED_MCP_NAME,
} = {}) {
  const resolvedPkg = pkg ?? JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  const resolvedLock = lock ?? JSON.parse(await readFile(path.join(rootDir, "package-lock.json"), "utf8"));
  const rawServerText = serverJson !== null ? JSON.stringify(serverJson) : await readFile(path.join(rootDir, "server.json"), "utf8");
  const resolvedServer = serverJson ?? JSON.parse(rawServerText);
  const resolvedChangelog = changelogText !== null ? changelogText : await readFile(path.join(rootDir, "CHANGELOG.md"), "utf8");

  if (!resolvedPkg || resolvedPkg.name !== expectedPackageName) {
    throw new ReleaseError("MANIFEST_MISMATCH", `package.json name "${resolvedPkg?.name}" !== "${expectedPackageName}"`);
  }
  const parsedVersion = parseSemver(resolvedPkg.version);
  if (!parsedVersion) {
    throw new ReleaseError("MANIFEST_MISMATCH", `package.json version "${resolvedPkg.version}" is not a valid stable semver`);
  }
  const version = parsedVersion.raw;
  if (resolvedPkg.mcpName !== expectedMcpName) {
    throw new ReleaseError("MANIFEST_MISMATCH", `package.json mcpName "${resolvedPkg.mcpName}" !== "${expectedMcpName}"`);
  }
  const pkgFiles = Array.isArray(resolvedPkg.files) ? resolvedPkg.files : [];
  for (const reqFile of ["dist", "bin", "server.json", "README.md", "LICENSE"]) {
    if (!pkgFiles.includes(reqFile)) throw new ReleaseError("MANIFEST_MISMATCH", `package.json files missing "${reqFile}"`);
  }
  if (!resolvedLock || resolvedLock.name !== expectedPackageName || resolvedLock.version !== version || resolvedLock.packages?.[""]?.version !== version) {
    throw new ReleaseError("MANIFEST_MISMATCH", `package-lock.json version does not match package.json version "${version}"`);
  }
  if (!resolvedServer || typeof resolvedServer.$schema !== "string" || !resolvedServer.$schema.includes("server.schema.json")) {
    throw new ReleaseError("MANIFEST_MISMATCH", "server.json $schema is missing or invalid");
  }
  if (resolvedServer.name !== expectedMcpName) {
    throw new ReleaseError("MANIFEST_MISMATCH", `server.json name "${resolvedServer.name}" !== "${expectedMcpName}"`);
  }
  if (resolvedServer.version !== version) {
    throw new ReleaseError("MANIFEST_MISMATCH", `server.json version "${resolvedServer.version}" !== "${version}"`);
  }
  if (resolvedServer.repository?.url !== EXPECTED_REPO_URL || resolvedServer.repository?.source !== "github") {
    throw new ReleaseError("MANIFEST_MISMATCH", `server.json repository must point to "${EXPECTED_REPO_URL}"`);
  }
  const npmEntry = Array.isArray(resolvedServer.packages) ? resolvedServer.packages.find((e) => e && e.registryType === "npm") : null;
  if (!npmEntry) throw new ReleaseError("MANIFEST_MISMATCH", 'server.json packages[] is missing registryType "npm"');
  if (npmEntry.identifier !== expectedPackageName) {
    throw new ReleaseError("MANIFEST_MISMATCH", `server.json npm package identifier "${npmEntry.identifier}" !== "${expectedPackageName}"`);
  }
  if (npmEntry.version !== version) {
    throw new ReleaseError("MANIFEST_MISMATCH", `server.json npm package version "${npmEntry.version}" !== "${version}"`);
  }
  if (npmEntry.transport?.type !== "stdio") {
    throw new ReleaseError("MANIFEST_MISMATCH", `server.json npm package transport.type "${npmEntry.transport?.type}" !== "stdio"`);
  }
  const changelogSection = extractChangelogSection(resolvedChangelog, version);
  if (requireChangelogSection && !changelogSection) {
    throw new ReleaseError("MANIFEST_MISMATCH", `CHANGELOG.md is missing a non-empty "## [${version}]" section`);
  }
  return {
    packageName: expectedPackageName,
    mcpName: expectedMcpName,
    version,
    tagName: `v${version}`,
    serverJsonSha256: sha256Hex(Buffer.from(rawServerText, "utf8")),
    changelogSection,
  };
}

export function verifyCiJobsGate(jobs, { requiredOsList = REQUIRED_CI_OS_GATES } = {}) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new ReleaseError("CI_GATE_FAILED", "CI workflow run reported no jobs");
  }
  const matchedJobsByOs = {};
  for (const osName of requiredOsList) {
    const matching = jobs.filter(
      (job) => job && typeof job.name === "string" && job.name.includes("Quality Gate") && job.name.toLowerCase().includes(osName.toLowerCase()),
    );
    if (matching.length === 0) {
      throw new ReleaseError("CI_GATE_FAILED", `Missing required Node.js 22 Quality Gate job for OS "${osName}"`, { details: { missingOs: osName } });
    }
    const failedJob = matching.find((job) => job.status !== "completed" || job.conclusion !== "success");
    if (failedJob) {
      throw new ReleaseError("CI_GATE_FAILED", `CI quality gate "${failedJob.name}" did not succeed (${failedJob.conclusion})`, { details: { os: osName } });
    }
    matchedJobsByOs[osName] = matching[0];
  }
  return { verifiedOsGates: requiredOsList.slice(), matchedJobsByOs };
}

export function evaluateTriggerGate({
  eventName,
  repository = TRUSTED_REPOSITORY,
  expectedRepository = TRUSTED_REPOSITORY,
  expectedBranch = TRUSTED_BRANCH,
  expectedRef = TRUSTED_REF,
  ref = "",
  workflowRun = null,
  dispatchInputs = null,
  matchedCiRun = null,
  ciJobs = null,
} = {}) {
  if (repository !== expectedRepository) {
    throw new ReleaseError("UNTRUSTED_REPOSITORY", `Untrusted repository "${repository}"`);
  }
  if (eventName === "pull_request" || eventName === "pull_request_target" || eventName === "pull_request_review") {
    throw new ReleaseError("PR_OR_FORK_REJECTED", `Release workflow cannot run on pull request event "${eventName}"`);
  }

  if (eventName === "workflow_run") {
    if (!workflowRun || typeof workflowRun !== "object") throw new ReleaseError("UNTRUSTED_EVENT", "workflow_run payload is missing");
    const wfName = workflowRun.name || "";
    const wfPath = workflowRun.path || "";
    if (wfName !== CI_WORKFLOW_NAME && !wfPath.endsWith(`/${CI_WORKFLOW_FILE}`) && wfPath !== `.github/workflows/${CI_WORKFLOW_FILE}`) {
      throw new ReleaseError("UNTRUSTED_EVENT", `Untrusted triggering workflow "${wfName}"`);
    }
    if (workflowRun.event !== "push") throw new ReleaseError("PR_OR_FORK_REJECTED", `Rejected workflow_run event "${workflowRun.event}"`);
    if (workflowRun.head_repository?.fork || workflowRun.head_repository?.full_name !== expectedRepository) {
      throw new ReleaseError("PR_OR_FORK_REJECTED", `Rejected untrusted/fork head_repository "${workflowRun.head_repository?.full_name}"`);
    }
    if (Array.isArray(workflowRun.pull_requests) && workflowRun.pull_requests.length > 0) {
      throw new ReleaseError("PR_OR_FORK_REJECTED", "Rejected workflow_run with associated pull_requests");
    }
    if (workflowRun.head_branch !== expectedBranch) {
      throw new ReleaseError("BRANCH_REJECTED", `Rejected workflow_run branch "${workflowRun.head_branch}"`);
    }
    if ((workflowRun.status && workflowRun.status !== "completed") || workflowRun.conclusion !== "success") {
      throw new ReleaseError("CI_GATE_FAILED", `CI workflow_run ${workflowRun.id} did not succeed (${workflowRun.conclusion})`);
    }
    if (!isValidGitSha(workflowRun.head_sha)) throw new ReleaseError("SHA_MISMATCH", `Invalid workflow_run.head_sha "${workflowRun.head_sha}"`);
    const ciRunId = String(workflowRun.id ?? "").trim();
    if (!/^\d+$/.test(ciRunId)) throw new ReleaseError("UNTRUSTED_EVENT", `Invalid workflow_run.id "${workflowRun.id}"`);
    const gateJobs = ciJobs ? verifyCiJobsGate(ciJobs) : null;
    return { triggerType: "workflow_run", headSha: workflowRun.head_sha.toLowerCase(), ciRunId, repository: expectedRepository, branch: expectedBranch, verifiedOsGates: gateJobs?.verifiedOsGates ?? [] };
  }

  if (eventName === "workflow_dispatch") {
    if (ref !== expectedRef) throw new ReleaseError("BRANCH_REJECTED", `Manual workflow_dispatch must run on "${expectedRef}"`);
    const requestedSha = String(dispatchInputs?.head_sha ?? "").trim().toLowerCase();
    if (!isValidGitSha(requestedSha)) throw new ReleaseError("SHA_MISMATCH", `Invalid workflow_dispatch head_sha "${requestedSha}"`);
    if (!matchedCiRun || typeof matchedCiRun !== "object") throw new ReleaseError("CI_GATE_FAILED", `No completed CI run found for ${requestedSha}`);
    if (matchedCiRun.event !== "push" || matchedCiRun.head_repository?.fork || matchedCiRun.head_repository?.full_name !== expectedRepository) {
      throw new ReleaseError("PR_OR_FORK_REJECTED", "Matched CI run is not a trusted push run");
    }
    if (matchedCiRun.head_branch !== expectedBranch) throw new ReleaseError("BRANCH_REJECTED", `Matched CI run branch "${matchedCiRun.head_branch}" !== "${expectedBranch}"`);
    if (String(matchedCiRun.head_sha ?? "").toLowerCase() !== requestedSha) throw new ReleaseError("SHA_MISMATCH", "Matched CI run head_sha mismatch");
    if (matchedCiRun.status !== "completed" || matchedCiRun.conclusion !== "success") throw new ReleaseError("CI_GATE_FAILED", `Matched CI run ${matchedCiRun.id} did not succeed`);
    const ciRunId = String(matchedCiRun.id ?? "").trim();
    if (!/^\d+$/.test(ciRunId)) throw new ReleaseError("CI_GATE_FAILED", `Invalid matched CI run ID "${matchedCiRun.id}"`);
    const gateJobs = ciJobs ? verifyCiJobsGate(ciJobs) : null;
    return { triggerType: "workflow_dispatch", headSha: requestedSha, ciRunId, repository: expectedRepository, branch: expectedBranch, verifiedOsGates: gateJobs?.verifiedOsGates ?? [] };
  }

  throw new ReleaseError("UNTRUSTED_EVENT", `Unsupported GitHub event "${eventName}"`);
}

export function verifyCheckoutAndAncestry({ expectedHeadSha, checkedOutSha, isAncestorOfMaster = true, masterTipVersion = null, targetVersion = null } = {}) {
  if (!isValidGitSha(expectedHeadSha) || !isValidGitSha(checkedOutSha) || expectedHeadSha.toLowerCase() !== checkedOutSha.toLowerCase()) {
    throw new ReleaseError("SHA_MISMATCH", `Checked-out HEAD "${checkedOutSha}" does not match verified CI head_sha "${expectedHeadSha}"`);
  }
  if (!isAncestorOfMaster) throw new ReleaseError("STALE_COMMIT", `Commit ${expectedHeadSha} is not an ancestor of ${TRUSTED_BRANCH}`);
  if (masterTipVersion && targetVersion && compareSemver(targetVersion, masterTipVersion) < 0) {
    throw new ReleaseError("STALE_COMMIT", `Stale run rejected: ${targetVersion} < ${TRUSTED_BRANCH} ${masterTipVersion}`);
  }
  return true;
}

export async function runSafeCommand(command, args = [], { cwd = process.cwd(), env = process.env, secretsToRedact = [], timeoutMs = 120_000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd, env, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    return { stdout: redactSecrets(stdout, secretsToRedact), stderr: redactSecrets(stderr, secretsToRedact) };
  } catch (error) {
    const detail = [redactSecrets(error.stderr || "", secretsToRedact).trim(), redactSecrets(error.stdout || "", secretsToRedact).trim(), redactSecrets(error.message || "", secretsToRedact).trim()].filter(Boolean).join(" | ");
    const wrapped = new Error(detail || `Command "${command}" failed`);
    wrapped.code = error.code;
    throw wrapped;
  }
}

export async function inspectReleaseTarball(tarballPath, expectedMetadata, { runCommand = runSafeCommand } = {}) {
  const tgzBuffer = await readFile(tarballPath);
  const { stdout: listOut } = await runCommand("tar", ["-tzf", tarballPath]);
  const fileSet = new Set(listOut.split(/\r?\n/).map((l) => l.trim().replace(/^\.\//, "")).filter(Boolean));
  for (const req of ["package/package.json", "package/server.json", "package/dist/index.js", "package/bin/omp-worker-mcp.mjs"]) {
    if (!fileSet.has(req)) throw new ReleaseError("ARTIFACT_MISMATCH", `Release tarball is missing "${req}"`);
  }
  const { stdout: pkgRaw } = await runCommand("tar", ["-xOzf", tarballPath, "package/package.json"]);
  const { stdout: serverRaw } = await runCommand("tar", ["-xOzf", tarballPath, "package/server.json"]);
  const packedPkg = JSON.parse(pkgRaw);
  const packedServer = JSON.parse(serverRaw);
  const npmPkgEntry = Array.isArray(packedServer.packages) ? packedServer.packages.find((item) => item && item.registryType === "npm") : null;
  if (packedPkg.name !== expectedMetadata.packageName || packedPkg.version !== expectedMetadata.version || packedPkg.mcpName !== expectedMetadata.mcpName) {
    throw new ReleaseError("ARTIFACT_MISMATCH", "Tarball package/package.json does not match expected metadata");
  }
  if (packedServer.name !== expectedMetadata.mcpName || packedServer.version !== expectedMetadata.version || !npmPkgEntry || npmPkgEntry.identifier !== expectedMetadata.packageName || npmPkgEntry.version !== expectedMetadata.version) {
    throw new ReleaseError("ARTIFACT_MISMATCH", "Tarball package/server.json does not match expected metadata");
  }
  return { tarballSha256: sha256Hex(tgzBuffer), tarballShasum: sha1Hex(tgzBuffer), packedServerSha256: sha256Hex(Buffer.from(serverRaw, "utf8")), fileCount: fileSet.size };
}

export async function createReleaseArtifactManifest({ tarballPath, headSha, ciRunId, repository = TRUSTED_REPOSITORY, metadata, runCommand = runSafeCommand }) {
  if (!isValidGitSha(headSha)) throw new ReleaseError("SHA_MISMATCH", `Invalid headSha "${headSha}"`);
  const inspected = await inspectReleaseTarball(tarballPath, metadata, { runCommand });
  return {
    schemaVersion: 1,
    repository,
    headSha: headSha.toLowerCase(),
    ciRunId: String(ciRunId).trim(),
    packageName: metadata.packageName,
    version: metadata.version,
    mcpName: metadata.mcpName,
    tarballName: path.basename(tarballPath),
    tarballSha256: inspected.tarballSha256,
    tarballShasum: inspected.tarballShasum,
    serverJsonSha256: inspected.packedServerSha256,
    fileCount: inspected.fileCount,
  };
}

export async function verifyReleaseArtifact({ artifactDir, expectedHeadSha, expectedCiRunId, expectedRepository = TRUSTED_REPOSITORY, metadata, runCommand = runSafeCommand }) {
  const manifestPath = artifactDir ? path.join(artifactDir, "release-manifest.json") : "";
  if (!manifestPath || !existsSync(manifestPath)) throw new ReleaseError("ARTIFACT_MISMATCH", `Missing release-manifest.json in "${artifactDir}"`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.repository !== expectedRepository) throw new ReleaseError("ARTIFACT_MISMATCH", `Artifact repository "${manifest.repository}" !== "${expectedRepository}"`);
  if (String(manifest.headSha ?? "").toLowerCase() !== expectedHeadSha.toLowerCase()) throw new ReleaseError("ARTIFACT_MISMATCH", "Artifact headSha mismatch");
  if (expectedCiRunId && String(manifest.ciRunId ?? "").trim() !== String(expectedCiRunId).trim()) throw new ReleaseError("ARTIFACT_MISMATCH", "Artifact ciRunId mismatch");
  if (manifest.packageName !== metadata.packageName || manifest.version !== metadata.version || manifest.mcpName !== metadata.mcpName) {
    throw new ReleaseError("ARTIFACT_MISMATCH", "Artifact package metadata mismatch");
  }
  const expectedTarballName = `${metadata.packageName}-${metadata.version}.tgz`;
  const tarballName = path.basename(String(manifest.tarballName ?? ""));
  if (tarballName !== expectedTarballName) throw new ReleaseError("ARTIFACT_MISMATCH", `Artifact tarballName "${tarballName}" !== "${expectedTarballName}"`);
  const tarballPath = path.join(artifactDir, tarballName);
  if (!existsSync(tarballPath)) throw new ReleaseError("ARTIFACT_MISMATCH", `Missing tarball file "${tarballPath}"`);
  const actualSha256 = sha256Hex(await readFile(tarballPath));
  if (actualSha256 !== String(manifest.tarballSha256 ?? "").toLowerCase()) {
    throw new ReleaseError("ARTIFACT_MISMATCH", `Artifact tarball SHA-256 mismatch: expected "${manifest.tarballSha256}", got "${actualSha256}"`);
  }
  const inspected = await inspectReleaseTarball(tarballPath, metadata, { runCommand });
  if (manifest.serverJsonSha256 && inspected.packedServerSha256 !== String(manifest.serverJsonSha256).toLowerCase()) {
    throw new ReleaseError("ARTIFACT_MISMATCH", "Packed server.json SHA-256 mismatch");
  }
  return { manifest, tarballPath, tarballSha256: actualSha256, tarballShasum: inspected.tarballShasum };
}

export function classifyNetworkError(errorOrContext, serviceName = "remote service") {
  if (errorOrContext instanceof ReleaseError) return errorOrContext;
  if (errorOrContext && typeof errorOrContext === "object" && "status" in errorOrContext) {
    const status = Number(errorOrContext.status);
    const kind = status === 429 ? "rate_limit" : status === 408 || status >= 500 ? "server_unavailable" : "unexpected_http_status";
    return new ReleaseError("NETWORK_ERROR", `${serviceName} HTTP ${status} (${kind})`, {
      category: "network",
      retryable: status === 429 || status === 408 || status >= 500,
      details: { status, kind, serviceName },
    });
  }
  const rawCode = String(errorOrContext?.cause?.code || errorOrContext?.code || errorOrContext?.name || "");
  const message = String(errorOrContext?.message || errorOrContext || "Network failure");
  const kind = /ETIMEDOUT|TIMEOUT|AbortError|ABORT_ERR/i.test(rawCode) || /timed?\s*out|abort/i.test(message)
    ? "timeout"
    : /ENOTFOUND|EAI_AGAIN/i.test(rawCode) || /getaddrinfo|enotfound|dns/i.test(message)
      ? "dns_failure"
      : "connection_failure";
  return new ReleaseError("NETWORK_ERROR", `${serviceName} network error (${kind}): ${message}`, {
    category: "network",
    retryable: true,
    details: { kind, rawCode, serviceName },
    cause: errorOrContext instanceof Error ? errorOrContext : undefined,
  });
}

export async function fetchNpmRegistryState(packageName = EXPECTED_PACKAGE_NAME, { fetchImpl = globalThis.fetch, registryUrl = DEFAULT_NPM_REGISTRY_URL, timeoutMs = 15_000 } = {}) {
  const url = `${registryUrl.replace(/\/+$/, "")}/${encodeURIComponent(packageName)}`;
  let response;
  try {
    response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw classifyNetworkError(error, "npm registry");
  }
  if (response.status === 404) {
    throw new ReleaseError("NETWORK_ERROR", `npm registry returned HTTP 404 for existing package "${packageName}"`, { category: "network", retryable: true, details: { status: 404, url } });
  }
  if (!response.ok) throw classifyNetworkError({ status: response.status, url }, "npm registry");
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new ReleaseError("NETWORK_ERROR", `npm registry returned malformed JSON for ${url}`, { category: "network", retryable: true, details: { kind: "malformed_json", url }, cause: error });
  }
  const versions = Object.keys(body?.versions || {}).filter((v) => Boolean(parseSemver(v))).sort(compareSemver);
  if (versions.length === 0) {
    throw new ReleaseError("NETWORK_ERROR", `npm registry returned zero valid versions for "${packageName}"`, { category: "network", retryable: true, details: { kind: "empty_versions", url } });
  }
  const highestPublishedVersion = versions[versions.length - 1];
  const latest = typeof body["dist-tags"]?.latest === "string" ? body["dist-tags"].latest : highestPublishedVersion;
  return { exists: true, versions, latest, highestPublishedVersion, versionRecords: body.versions };
}

export function decideReleaseAction({ targetVersion, headSha, parentPackageVersion = null, eventName = "workflow_run", npmState, existingTagSha = null, githubReleaseExists = false, expectedTarballShasum = null }) {
  if (!parseSemver(targetVersion)) throw new ReleaseError("MANIFEST_MISMATCH", `Invalid target version "${targetVersion}"`);
  if (!isValidGitSha(headSha)) throw new ReleaseError("SHA_MISMATCH", `Invalid headSha "${headSha}"`);
  if (!npmState || !Array.isArray(npmState.versions)) throw new ReleaseError("NETWORK_ERROR", "Missing verified npm registry state");

  const normalizedHeadSha = headSha.toLowerCase();
  const normalizedTagSha = existingTagSha ? existingTagSha.toLowerCase() : null;
  const tagName = `v${targetVersion}`;
  const referenceVersion = npmState.highestPublishedVersion || npmState.latest;

  if (referenceVersion && compareSemver(targetVersion, referenceVersion) < 0) {
    throw new ReleaseError("VERSION_DOWNGRADE", `Version downgrade rejected: ${targetVersion} < published ${referenceVersion}`);
  }
  if (!npmState.versions.includes(targetVersion)) {
    if (normalizedTagSha && normalizedTagSha !== normalizedHeadSha) {
      throw new ReleaseError("TAG_MISMATCH", `Tag ${tagName} already exists on commit ${normalizedTagSha}`);
    }
    return { shouldPublish: true, npmAlreadyPublished: false, reason: "new_version", targetVersion, tagName, headSha: normalizedHeadSha };
  }
  if (normalizedTagSha && normalizedTagSha !== normalizedHeadSha) {
    const bumpedHere = typeof parentPackageVersion === "string" && parentPackageVersion.trim() !== "" && parentPackageVersion.trim() !== targetVersion;
    if (eventName === "workflow_dispatch" || bumpedHere) {
      throw new ReleaseError("TAG_MISMATCH", `Version ${targetVersion} is already tagged at ${normalizedTagSha}`);
    }
    return { shouldPublish: false, npmAlreadyPublished: true, reason: "already_released_at_earlier_commit", targetVersion, tagName, headSha: normalizedHeadSha, existingTagSha: normalizedTagSha };
  }
  const publishedShasum = npmState.versionRecords?.[targetVersion]?.dist?.shasum;
  if (expectedTarballShasum && publishedShasum && publishedShasum.toLowerCase() !== expectedTarballShasum.toLowerCase()) {
    throw new ReleaseError("ARTIFACT_MISMATCH", `Published npm shasum ${publishedShasum} differs from local artifact shasum ${expectedTarballShasum}`);
  }
  if (eventName === "workflow_run" && normalizedTagSha === normalizedHeadSha && githubReleaseExists && parentPackageVersion === targetVersion) {
    return { shouldPublish: false, npmAlreadyPublished: true, reason: "already_released", targetVersion, tagName, headSha: normalizedHeadSha, existingTagSha: normalizedTagSha };
  }
  return { shouldPublish: true, npmAlreadyPublished: true, reason: "idempotent_rerun_recovery", targetVersion, tagName, headSha: normalizedHeadSha, existingTagSha: normalizedTagSha };
}

export function verifyMcpPublisherChecksum(archiveBuffer, expectedAsset = MCP_PUBLISHER_LINUX_X64) {
  const actualSha256 = sha256Hex(archiveBuffer);
  const expectedSha256 = String(expectedAsset.sha256 ?? "").toLowerCase();
  if (actualSha256 !== expectedSha256) {
    throw new ReleaseError("MCP_PUBLISHER_CHECKSUM_MISMATCH", `mcp-publisher ${MCP_PUBLISHER_TAG} SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`, { category: "security" });
  }
  return actualSha256;
}

export async function downloadAndInstallMcpPublisher({ installDir, asset = MCP_PUBLISHER_LINUX_X64, fetchImpl = globalThis.fetch, runCommand = runSafeCommand, timeoutMs = 30_000 } = {}) {
  let response;
  try {
    response = await fetchImpl(asset.url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw classifyNetworkError(error, "GitHub Releases (mcp-publisher)");
  }
  if (!response.ok) throw classifyNetworkError({ status: response.status, url: asset.url }, "GitHub Releases (mcp-publisher)");
  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  const sha256 = verifyMcpPublisherChecksum(archiveBuffer, asset);
  await mkdir(installDir, { recursive: true });
  const archivePath = path.join(installDir, asset.archiveName);
  await writeFile(archivePath, archiveBuffer);
  await runCommand("tar", ["-xzf", archivePath, "-C", installDir, asset.binaryName]);
  await rm(archivePath, { force: true });
  const binaryPath = path.join(installDir, asset.binaryName);
  await chmod(binaryPath, 0o755);
  return { binaryPath, version: MCP_PUBLISHER_VERSION, sha256 };
}

export function selectNpmAuthPlan(env = process.env) {
  const hasOidc = Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  const hasToken = Boolean(typeof env.NPM_TOKEN === "string" && env.NPM_TOKEN.trim());
  if (hasOidc && hasToken) return { primary: "oidc", fallback: "token", hasOidc: true, hasToken: true };
  if (hasOidc) return { primary: "oidc", fallback: null, hasOidc: true, hasToken: false };
  if (hasToken) return { primary: "token", fallback: null, hasOidc: false, hasToken: true };
  throw new ReleaseError("NPM_AUTH_MISSING", "Neither GitHub Actions OIDC nor NPM_TOKEN secret is available", { category: "auth" });
}

export async function publishToNpm({ tarballPath, targetVersion, packageName = EXPECTED_PACKAGE_NAME, expectedShasum = null, npmAlreadyPublished = false, env = process.env, nodeVersion = process.versions.node, runCommand = runSafeCommand, fetchNpmState = null }) {
  if (npmAlreadyPublished) return { status: "skipped_already_published", method: "none", version: targetVersion };
  const authPlan = selectNpmAuthPlan(env);
  const secretsToRedact = [env.NPM_TOKEN, env.NODE_AUTH_TOKEN, env.GITHUB_TOKEN].filter(Boolean);

  if (authPlan.hasOidc) {
    const { stdout: npmVerOut } = await runCommand("npm", ["--version"], { env, secretsToRedact });
    verifyOidcRuntimePrerequisites({ nodeVersion, npmVersion: npmVerOut.trim() });
  }

  const attemptMode = async (mode) => {
    if (mode === "oidc") {
      const cleanEnv = { ...env };
      delete cleanEnv.NPM_TOKEN;
      delete cleanEnv.NODE_AUTH_TOKEN;
      await runCommand("npm", ["publish", tarballPath, "--provenance", "--access", "public"], { env: cleanEnv, secretsToRedact });
      return { status: "published", method: "oidc", version: targetVersion };
    }
    const tempConfigDir = await mkdtemp(path.join(tmpdir(), "omp-npm-auth-"));
    const userConfigPath = path.join(tempConfigDir, ".npmrc");
    try {
      await writeFile(userConfigPath, "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n", { encoding: "utf8", mode: 0o600 });
      const tokenEnv = { ...env, NODE_AUTH_TOKEN: env.NPM_TOKEN.trim(), NPM_CONFIG_USERCONFIG: userConfigPath };
      delete tokenEnv.NPM_TOKEN;
      const args = ["publish", tarballPath, "--access", "public"];
      if (authPlan.hasOidc) args.splice(2, 0, "--provenance");
      await runCommand("npm", args, { env: tokenEnv, secretsToRedact });
      return { status: "published", method: "token", version: targetVersion };
    } finally {
      await rm(tempConfigDir, { recursive: true, force: true }).catch(() => {});
    }
  };

  try {
    return await attemptMode(authPlan.primary);
  } catch (primaryError) {
    const msg = redactSecrets(primaryError.message || String(primaryError), secretsToRedact);
    if (/EPUBLISHCONFLICT|cannot publish over the previously published versions|already exists/i.test(msg) && fetchNpmState) {
      const latestState = await fetchNpmState();
      const remoteShasum = latestState.versionRecords?.[targetVersion]?.dist?.shasum;
      if (latestState.versions.includes(targetVersion) && (!expectedShasum || !remoteShasum || remoteShasum === expectedShasum)) {
        return { status: "skipped_already_published", method: "conflict_verified", version: targetVersion };
      }
    }
    const isTransientOrNetworkFailure = /\bE5\d\d\b|\b50[0-9]\b|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|dns|timed?\s*out|socket hang up|service unavailable|bad gateway|gateway timeout/i.test(msg);
    const isOidcAuthOrMasked404 =
      /E401|E403|ENEEDAUTH|EOTP|\b(?:401|403)\b|Unable to authenticate|Access token expired|trusted publisher|provenance|oidc/i.test(msg) ||
      (packageName === EXPECTED_PACKAGE_NAME && (/E404|\b404\b|not found/i.test(msg)));
    if (authPlan.primary === "oidc" && authPlan.fallback === "token" && !isTransientOrNetworkFailure && isOidcAuthOrMasked404) {
      try {
        return await attemptMode("token");
      } catch (fallbackError) {
        const fbMsg = redactSecrets(fallbackError.message || String(fallbackError), secretsToRedact);
        throw new ReleaseError("NPM_PUBLISH_FAILED", `npm publish failed via OIDC and NPM_TOKEN fallback: ${fbMsg}`, { category: "npm", retryable: true, cause: fallbackError });
      }
    }
    throw new ReleaseError("NPM_PUBLISH_FAILED", `npm publish (${authPlan.primary}) failed: ${msg}`, { category: "npm", retryable: true, cause: primaryError });
  }
}

export async function verifyNpmVersionAvailable({ packageName = EXPECTED_PACKAGE_NAME, targetVersion, expectedMcpName = EXPECTED_MCP_NAME, expectedShasum = null, fetchImpl = globalThis.fetch, registryUrl = DEFAULT_NPM_REGISTRY_URL, maxAttempts = 6, retryDelayMs = 2_000, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const url = `${registryUrl.replace(/\/+$/, "")}/${encodeURIComponent(packageName)}/${encodeURIComponent(targetVersion)}`;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (response.status === 200) {
        const data = await response.json();
        if (data.version !== targetVersion || data.mcpName !== expectedMcpName) {
          throw new ReleaseError("NPM_VERIFICATION_FAILED", `Published npm metadata mismatch (${data.version}, ${data.mcpName})`);
        }
        if (expectedShasum && data.dist?.shasum && data.dist.shasum.toLowerCase() !== expectedShasum.toLowerCase()) {
          throw new ReleaseError("NPM_VERIFICATION_FAILED", "Published npm tarball shasum mismatch");
        }
        return { verified: true, version: data.version, mcpName: data.mcpName, shasum: data.dist?.shasum ?? null, attempts: attempt };
      }
      lastError = response.status === 404
        ? new ReleaseError("NPM_VERIFICATION_TIMEOUT", `${packageName}@${targetVersion} not yet visible on npm (404)`, { category: "npm", retryable: true })
        : classifyNetworkError({ status: response.status, url }, "npm version verification");
    } catch (error) {
      if (error instanceof ReleaseError && error.code === "NPM_VERIFICATION_FAILED") throw error;
      lastError = classifyNetworkError(error, "npm version verification");
    }
    if (attempt < maxAttempts) await sleepImpl(retryDelayMs);
  }
  throw lastError;
}

export async function publishToMcpRegistry({ mcpPublisherBinaryPath, serverJsonPath = "server.json", targetVersion, env = process.env, runCommand = runSafeCommand }) {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new ReleaseError("MCP_REGISTRY_AUTH_FAILED", "GitHub OIDC (id-token: write) is required for mcp-publisher login github-oidc");
  }
  const secretsToRedact = [env.NPM_TOKEN, env.NODE_AUTH_TOKEN, env.GITHUB_TOKEN].filter(Boolean);
  const cleanEnv = { ...env };
  delete cleanEnv.NPM_TOKEN;
  delete cleanEnv.NODE_AUTH_TOKEN;

  try {
    await runCommand(mcpPublisherBinaryPath, ["validate", serverJsonPath], { env: cleanEnv, secretsToRedact });
  } catch (error) {
    throw new ReleaseError("MCP_REGISTRY_VALIDATION_FAILED", `mcp-publisher validate failed: ${redactSecrets(error.message, secretsToRedact)}`, { category: "mcp-registry", cause: error });
  }
  try {
    await runCommand(mcpPublisherBinaryPath, ["login", "github-oidc"], { env: cleanEnv, secretsToRedact });
  } catch (error) {
    const msg = redactSecrets(error.message, secretsToRedact);
    const isNet = /timed?\s*out|500|502|503|504|connection|lookup|eof|unavailable/i.test(msg);
    throw new ReleaseError(isNet ? "MCP_REGISTRY_UNAVAILABLE" : "MCP_REGISTRY_AUTH_FAILED", `mcp-publisher login github-oidc failed: ${msg}`, {
      category: isNet ? "network" : "mcp-registry",
      retryable: true,
      recoveryHint: "Rerun publish.yml once MCP Registry is reachable; npm publish will be skipped idempotently.",
      cause: error,
    });
  }
  try {
    await runCommand(mcpPublisherBinaryPath, ["publish", serverJsonPath], { env: cleanEnv, secretsToRedact });
    return { status: "published", version: targetVersion };
  } catch (error) {
    const msg = redactSecrets(error.message, secretsToRedact);
    if (/already exists|already published|duplicate version/i.test(msg)) return { status: "skipped_already_published", version: targetVersion };
    const isNet = /timed?\s*out|500|502|503|504|connection|lookup|eof|unavailable/i.test(msg);
    throw new ReleaseError(isNet ? "MCP_REGISTRY_UNAVAILABLE" : "MCP_REGISTRY_PUBLISH_FAILED", `mcp-publisher publish failed for ${targetVersion}: ${msg}`, {
      category: isNet ? "network" : "mcp-registry",
      retryable: true,
      recoveryHint: "Do NOT bump version. Rerun publish.yml once MCP Registry recovers; npm publish will be skipped idempotently.",
      cause: error,
    });
  }
}

export async function ensureGitTagAndRelease({ tagName, targetVersion, headSha, releaseNotes, tarballPath = null, existingTagSha = null, githubReleaseExists = false, runCommand = runSafeCommand, env = process.env }) {
  const normalizedHead = headSha.toLowerCase();
  const normalizedTag = existingTagSha ? existingTagSha.toLowerCase() : null;
  if (normalizedTag && normalizedTag !== normalizedHead) {
    throw new ReleaseError("TAG_MISMATCH", `Refusing to rewrite existing tag ${tagName} (${normalizedTag} !== ${normalizedHead})`);
  }
  const secretsToRedact = [env.GITHUB_TOKEN, env.GH_TOKEN, env.NPM_TOKEN].filter(Boolean);
  if (!normalizedTag) {
    await runCommand("git", ["tag", "-a", tagName, normalizedHead, "-m", `Release ${tagName}`], { env, secretsToRedact });
    await runCommand("git", ["push", "origin", `refs/tags/${tagName}`], { env, secretsToRedact });
  }
  const tempDir = await mkdtemp(path.join(tmpdir(), "omp-release-notes-"));
  const notesPath = path.join(tempDir, "RELEASE_NOTES.md");
  try {
    await writeFile(notesPath, `${(releaseNotes || `Release ${tagName}`).trim()}\n`, "utf8");
    if (githubReleaseExists) {
      await runCommand("gh", ["release", "edit", tagName, "--title", tagName, "--notes-file", notesPath], { env, secretsToRedact });
      if (tarballPath && existsSync(tarballPath)) await runCommand("gh", ["release", "upload", tagName, tarballPath, "--clobber"], { env, secretsToRedact });
      return { status: "updated", tagName, version: targetVersion, headSha: normalizedHead };
    }
    const args = ["release", "create", tagName, "--verify-tag", "--title", tagName, "--notes-file", notesPath];
    if (tarballPath && existsSync(tarballPath)) args.push(tarballPath);
    await runCommand("gh", args, { env, secretsToRedact });
    return { status: "created", tagName, version: targetVersion, headSha: normalizedHead };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function executeOrderedRelease({ artifactDir, expectedHeadSha, expectedCiRunId, metadata, decision, env = process.env, runCommand = runSafeCommand, fetchImpl = globalThis.fetch, registryUrl = DEFAULT_NPM_REGISTRY_URL, installMcpPublisher = downloadAndInstallMcpPublisher, verifyNpmAvailable = verifyNpmVersionAvailable, existingTagSha = null, githubReleaseExists = false }) {
  if (!decision?.shouldPublish) return { published: false, reason: decision?.reason ?? "skipped", version: metadata.version };
  const verifiedArtifact = await verifyReleaseArtifact({ artifactDir, expectedHeadSha, expectedCiRunId, metadata, runCommand });
  const npmResult = await publishToNpm({
    tarballPath: verifiedArtifact.tarballPath,
    targetVersion: metadata.version,
    packageName: metadata.packageName,
    expectedShasum: verifiedArtifact.tarballShasum,
    npmAlreadyPublished: decision.npmAlreadyPublished,
    env,
    runCommand,
    fetchNpmState: () => fetchNpmRegistryState(metadata.packageName, { fetchImpl, registryUrl }),
  });
  const npmVerified = await verifyNpmAvailable({ packageName: metadata.packageName, targetVersion: metadata.version, expectedMcpName: metadata.mcpName, expectedShasum: verifiedArtifact.tarballShasum, fetchImpl, registryUrl });
  const tempPublisherDir = await mkdtemp(path.join(tmpdir(), "omp-mcp-publisher-"));
  let mcpResult;
  try {
    const installed = await installMcpPublisher({ installDir: tempPublisherDir, fetchImpl, runCommand });
    mcpResult = await publishToMcpRegistry({ mcpPublisherBinaryPath: installed.binaryPath, serverJsonPath: "server.json", targetVersion: metadata.version, env, runCommand });
  } finally {
    await rm(tempPublisherDir, { recursive: true, force: true }).catch(() => {});
  }
  const releaseResult = await ensureGitTagAndRelease({ tagName: metadata.tagName, targetVersion: metadata.version, headSha: expectedHeadSha, releaseNotes: metadata.changelogSection?.body ?? "", tarballPath: verifiedArtifact.tarballPath, existingTagSha, githubReleaseExists, runCommand, env });
  return { published: true, version: metadata.version, tagName: metadata.tagName, headSha: expectedHeadSha.toLowerCase(), npmResult, npmVerified, mcpResult, releaseResult };
}

export function parseReleaseCliArgs(argv = process.argv.slice(2)) {
  const options = { mode: "gate", offline: false, dryRun: false, artifactDir: process.env.RELEASE_ARTIFACT_DIR || "", outputDir: ".release-artifact", headSha: process.env.RELEASE_HEAD_SHA || "", ciRunId: process.env.RELEASE_CI_RUN_ID || "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--offline") options.offline = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--mode=")) options.mode = arg.slice(7);
    else if (arg === "--mode" && argv[i + 1]) options.mode = argv[++i];
    else if (arg.startsWith("--artifact-dir=")) options.artifactDir = arg.slice(15);
    else if (arg === "--artifact-dir" && argv[i + 1]) options.artifactDir = argv[++i];
    else if (arg.startsWith("--output-dir=")) options.outputDir = arg.slice(13);
    else if (arg === "--output-dir" && argv[i + 1]) options.outputDir = argv[++i];
    else if (arg.startsWith("--head-sha=")) options.headSha = arg.slice(11);
    else if (arg === "--head-sha" && argv[i + 1]) options.headSha = argv[++i];
    else if (arg.startsWith("--ci-run-id=")) options.ciRunId = arg.slice(12);
    else if (arg === "--ci-run-id" && argv[i + 1]) options.ciRunId = argv[++i];
  }
  return options;
}

export async function writeGithubOutputs(outputs, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  await appendFile(outputPath, `${Object.entries(outputs).map(([k, v]) => `${k}=${String(v ?? "")}`).join("\n")}\n`, "utf8");
}

export async function fetchGithubApiJson(url, token) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "omp-worker-mcp-release" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw classifyNetworkError(error, "GitHub API");
  }
  if (!response.ok) throw classifyNetworkError({ status: response.status, url }, "GitHub API");
  return response.json();
}

export async function checkGithubReleaseExists(repository, tagName, token) {
  const url = `${(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "")}/repos/${repository}/releases/tags/${encodeURIComponent(tagName)}`;
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "omp-worker-mcp-release" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw classifyNetworkError(error, "GitHub Releases API");
  }
  if (response.status === 404) return false;
  if (!response.ok) throw classifyNetworkError({ status: response.status, url }, "GitHub Releases API");
  return true;
}

export async function resolveGitState(rootDir, tagName, expectedHeadSha) {
  const { stdout: headOut } = await runSafeCommand("git", ["rev-parse", "HEAD"], { cwd: rootDir });
  const checkedOutSha = headOut.trim().toLowerCase();
  let existingTagSha = null;
  try {
    const { stdout: tagOut } = await runSafeCommand("git", ["rev-list", "-n", "1", `refs/tags/${tagName}`], { cwd: rootDir });
    if (isValidGitSha(tagOut.trim())) existingTagSha = tagOut.trim().toLowerCase();
  } catch {}
  let parentPackageVersion = null;
  try {
    const { stdout: parentPkgOut } = await runSafeCommand("git", ["show", `${expectedHeadSha}^:package.json`], { cwd: rootDir });
    parentPackageVersion = JSON.parse(parentPkgOut)?.version?.trim() ?? null;
  } catch {}
  let isAncestorOfMaster = true;
  let masterTipVersion = null;
  try {
    const { stdout: masterRefOut } = await runSafeCommand("git", ["rev-parse", `origin/${TRUSTED_BRANCH}`], { cwd: rootDir });
    const masterTipSha = masterRefOut.trim().toLowerCase();
    if (isValidGitSha(masterTipSha)) {
      try {
        await runSafeCommand("git", ["merge-base", "--is-ancestor", expectedHeadSha, masterTipSha], { cwd: rootDir });
      } catch {
        isAncestorOfMaster = false;
      }
      const { stdout: masterPkgOut } = await runSafeCommand("git", ["show", `${masterTipSha}:package.json`], { cwd: rootDir });
      masterTipVersion = JSON.parse(masterPkgOut)?.version ?? null;
    }
  } catch {}
  return { checkedOutSha, existingTagSha, parentPackageVersion, isAncestorOfMaster, masterTipVersion };
}
