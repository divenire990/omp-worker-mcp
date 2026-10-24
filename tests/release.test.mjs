import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EXPECTED_MCP_NAME,
  EXPECTED_PACKAGE_NAME,
  MCP_PUBLISHER_LINUX_X64,
  MCP_PUBLISHER_VERSION,
  ReleaseError,
  TRUSTED_BRANCH,
  TRUSTED_REF,
  TRUSTED_REPOSITORY,
   createReleaseArtifactManifest,
  decideReleaseAction,
  evaluateTriggerGate,
  executeOrderedRelease,
  fetchNpmRegistryState,
  publishToNpm,
  runSafeCommand,
  sha1Hex,
  sha256Hex,
  validateReleaseMetadata,
  verifyCheckoutAndAncestry,
  verifyCiJobsGate,
  verifyMcpPublisherChecksum,
  verifyNpmVersionAvailable,
  verifyOidcRuntimePrerequisites,
  verifyReleaseArtifact,
} from "../scripts/release.mjs";
import { runPackArtifactMode } from "../scripts/check-release.mjs";

const SAMPLE_SHA = "8f8d66ea70ff23c0e8f05fcd86fe608f2cbdce29";
const OTHER_SHA = "31cdc5e5c7ba6fd70d7d6e81c801443f0ba189b2";

function makeValidCiJobs() {
  return [
    { name: "Node.js 22 Quality Gate (ubuntu-latest)", status: "completed", conclusion: "success" },
    { name: "Node.js 22 Quality Gate (macos-latest)", status: "completed", conclusion: "success" },
    { name: "Node.js 22 Quality Gate (windows-latest)", status: "completed", conclusion: "success" },
  ];
}

function makeValidWorkflowRun(overrides = {}) {
  return {
    id: 39978268729,
    name: "CI",
    path: ".github/workflows/ci.yml",
    event: "push",
    status: "completed",
    conclusion: "success",
    head_branch: TRUSTED_BRANCH,
    head_sha: SAMPLE_SHA,
    pull_requests: [],
    head_repository: { full_name: TRUSTED_REPOSITORY, fork: false },
    ...overrides,
  };
}

function makeReleaseFixtures(version = "0.2.0") {
  const pkg = {
    name: EXPECTED_PACKAGE_NAME,
    version,
    mcpName: EXPECTED_MCP_NAME,
    files: ["dist", "bin", "server.json", "README.md", "LICENSE"],
  };
  const lock = {
    name: EXPECTED_PACKAGE_NAME,
    version,
    lockfileVersion: 3,
    packages: { "": { name: EXPECTED_PACKAGE_NAME, version } },
  };
  // Clean server.json without runtimeArguments per official MCP Registry guidance (#650)
  const serverJson = {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: EXPECTED_MCP_NAME,
    title: "omp-worker-mcp",
    description: "Hand off coding tasks to local OMP workers.",
    version,
    repository: {
      url: "https://github.com/divenire990/omp-worker-mcp",
      source: "github",
    },
    packages: [
      {
        registryType: "npm",
        identifier: EXPECTED_PACKAGE_NAME,
        version,
        transport: { type: "stdio" },
      },
    ],
  };
  const changelogText = `# Changelog\n\n## [Unreleased]\n\n## [${version}] - 2026-10-23\n\n### Added\n\n- Automated release pipeline.\n\n## [0.1.1] - 2026-08-27\n\n- Previous release.\n`;
  return { pkg, lock, serverJson, changelogText };
}

async function createTempTarball(tempDir, version = "0.2.0") {
  const { pkg, serverJson } = makeReleaseFixtures(version);
  const pkgRoot = path.join(tempDir, "package");
  await mkdir(path.join(pkgRoot, "dist"), { recursive: true });
  await mkdir(path.join(pkgRoot, "bin"), { recursive: true });
  await writeFile(path.join(pkgRoot, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
  await writeFile(path.join(pkgRoot, "server.json"), JSON.stringify(serverJson, null, 2), "utf8");
  await writeFile(path.join(pkgRoot, "dist", "index.js"), "export const ok = true;\n", "utf8");
  await writeFile(path.join(pkgRoot, "bin", "omp-worker-mcp.mjs"), "#!/usr/bin/env node\n", "utf8");

  const tarballPath = path.join(tempDir, `${EXPECTED_PACKAGE_NAME}-${version}.tgz`);
  await runSafeCommand("tar", ["-czf", tarballPath, "-C", tempDir, "package"]);
  return tarballPath;
}

test("evaluateTriggerGate accepts trusted master push CI workflow_run with all 3 Node.js 22 OS quality gates passing", () => {
  const result = evaluateTriggerGate({
    eventName: "workflow_run",
    repository: TRUSTED_REPOSITORY,
    workflowRun: makeValidWorkflowRun(),
    ciJobs: makeValidCiJobs(),
  });
  assert.equal(result.triggerType, "workflow_run");
  assert.equal(result.headSha, SAMPLE_SHA);
  assert.equal(result.ciRunId, "39978268729");
  assert.deepEqual(result.verifiedOsGates, ["ubuntu-latest", "macos-latest", "windows-latest"]);
});

test("evaluateTriggerGate rejects pull_request, fork repos, non-master branches, failed CI, and missing OS gates", () => {
  assert.throws(
    () => evaluateTriggerGate({ eventName: "pull_request", repository: TRUSTED_REPOSITORY }),
    (err) => err instanceof ReleaseError && err.code === "PR_OR_FORK_REJECTED",
  );
  assert.throws(
    () =>
      evaluateTriggerGate({
        eventName: "workflow_run",
        repository: TRUSTED_REPOSITORY,
        workflowRun: makeValidWorkflowRun({ event: "pull_request" }),
      }),
    (err) => err instanceof ReleaseError && err.code === "PR_OR_FORK_REJECTED",
  );
  assert.throws(
    () =>
      evaluateTriggerGate({
        eventName: "workflow_run",
        repository: TRUSTED_REPOSITORY,
        workflowRun: makeValidWorkflowRun({
          head_repository: { full_name: "attacker/omp-worker-mcp", fork: true },
        }),
      }),
    (err) => err instanceof ReleaseError && err.code === "PR_OR_FORK_REJECTED",
  );
  assert.throws(
    () =>
      evaluateTriggerGate({
        eventName: "workflow_run",
        repository: TRUSTED_REPOSITORY,
        workflowRun: makeValidWorkflowRun({ pull_requests: [{ id: 1 }] }),
      }),
    (err) => err instanceof ReleaseError && err.code === "PR_OR_FORK_REJECTED",
  );
  assert.throws(
    () =>
      evaluateTriggerGate({
        eventName: "workflow_run",
        repository: TRUSTED_REPOSITORY,
        workflowRun: makeValidWorkflowRun({ head_branch: "feature/test" }),
      }),
    (err) => err instanceof ReleaseError && err.code === "BRANCH_REJECTED",
  );
  assert.throws(
    () =>
      evaluateTriggerGate({
        eventName: "workflow_run",
        repository: TRUSTED_REPOSITORY,
        workflowRun: makeValidWorkflowRun({ conclusion: "failure" }),
      }),
    (err) => err instanceof ReleaseError && err.code === "CI_GATE_FAILED",
  );
  assert.throws(
    () =>
      verifyCiJobsGate([
        { name: "Node.js 22 Quality Gate (ubuntu-latest)", status: "completed", conclusion: "success" },
        { name: "Node.js 22 Quality Gate (macos-latest)", status: "completed", conclusion: "success" },
      ]),
    (err) => err instanceof ReleaseError && err.code === "CI_GATE_FAILED" && /windows-latest/.test(err.message),
  );
});

test("evaluateTriggerGate validates bounded workflow_dispatch recovery and verifyCheckoutAndAncestry blocks SHA drift or stale runs", () => {
  const validDispatch = evaluateTriggerGate({
    eventName: "workflow_dispatch",
    repository: TRUSTED_REPOSITORY,
    ref: TRUSTED_REF,
    dispatchInputs: { head_sha: SAMPLE_SHA },
    matchedCiRun: makeValidWorkflowRun(),
    ciJobs: makeValidCiJobs(),
  });
  assert.equal(validDispatch.headSha, SAMPLE_SHA);

  assert.throws(
    () =>
      verifyCheckoutAndAncestry({
        expectedHeadSha: SAMPLE_SHA,
        checkedOutSha: OTHER_SHA,
      }),
    (err) => err instanceof ReleaseError && err.code === "SHA_MISMATCH",
  );
  assert.throws(
    () =>
      verifyCheckoutAndAncestry({
        expectedHeadSha: SAMPLE_SHA,
        checkedOutSha: SAMPLE_SHA,
        isAncestorOfMaster: true,
        masterTipVersion: "0.3.0",
        targetVersion: "0.2.0",
      }),
    (err) => err instanceof ReleaseError && err.code === "STALE_COMMIT",
  );
});

test("validateReleaseMetadata accepts clean server.json without runtimeArguments and rejects version/identifier mismatches", async () => {
  const valid = makeReleaseFixtures("0.2.0");
  assert.equal(valid.serverJson.packages[0].runtimeArguments, undefined);

  const metadata = await validateReleaseMetadata(valid);
  assert.equal(metadata.version, "0.2.0");
  assert.equal(metadata.tagName, "v0.2.0");

  await assert.rejects(
    () =>
      validateReleaseMetadata({
        ...valid,
        serverJson: {
          ...valid.serverJson,
          packages: [{ ...valid.serverJson.packages[0], identifier: "wrong-pkg" }],
        },
      }),
    (err) => err instanceof ReleaseError && err.code === "MANIFEST_MISMATCH" && /identifier/.test(err.message),
  );

  await assert.rejects(
    () =>
      validateReleaseMetadata({
        ...valid,
        serverJson: {
          ...valid.serverJson,
          packages: [{ ...valid.serverJson.packages[0], version: "0.1.1" }],
        },
      }),
    (err) => err instanceof ReleaseError && err.code === "MANIFEST_MISMATCH" && /npm package version/.test(err.message),
  );

  await assert.rejects(
    () =>
      validateReleaseMetadata({
        ...valid,
        lock: { ...valid.lock, version: "0.1.1" },
      }),
    (err) => err instanceof ReleaseError && err.code === "MANIFEST_MISMATCH",
  );
});

test("createReleaseArtifactManifest and verifyReleaseArtifact enforce exact CI run ID, SHA, and tarball digest via standard tar", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "omp-release-artifact-test-"));
  try {
    const metadata = await validateReleaseMetadata(makeReleaseFixtures("0.2.0"));
    const tarballPath = await createTempTarball(tempDir, "0.2.0");
    const tarballBuffer = await readFile(tarballPath);

    const manifest = await createReleaseArtifactManifest({
      tarballPath,
      headSha: SAMPLE_SHA,
      ciRunId: "39978268729",
      metadata,
    });
    await writeFile(path.join(tempDir, "release-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    const verified = await verifyReleaseArtifact({
      artifactDir: tempDir,
      expectedHeadSha: SAMPLE_SHA,
      expectedCiRunId: "39978268729",
      metadata,
    });
    assert.equal(verified.tarballSha256, sha256Hex(tarballBuffer));
    assert.equal(verified.tarballShasum, sha1Hex(tarballBuffer));

    await assert.rejects(
      () =>
        verifyReleaseArtifact({
          artifactDir: tempDir,
          expectedHeadSha: SAMPLE_SHA,
          expectedCiRunId: "99999999999",
          metadata,
        }),
      (err) => err instanceof ReleaseError && err.code === "ARTIFACT_MISMATCH" && /ciRunId/.test(err.message),
    );

    await writeFile(tarballPath, Buffer.concat([tarballBuffer, Buffer.from("tampered")]));
    await assert.rejects(
      () =>
        verifyReleaseArtifact({
          artifactDir: tempDir,
          expectedHeadSha: SAMPLE_SHA,
          expectedCiRunId: "39978268729",
          metadata,
        }),
      (err) => err instanceof ReleaseError && err.code === "ARTIFACT_MISMATCH" && /SHA-256 mismatch/.test(err.message),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("decideReleaseAction handles new versions, skips docs commits, allows rerun recovery, and blocks downgrades or tag rewrites", () => {
  const npmStateAt011 = {
    exists: true,
    versions: ["0.1.0", "0.1.1"],
    latest: "0.1.1",
    highestPublishedVersion: "0.1.1",
    versionRecords: { "0.1.1": { dist: { shasum: "aaaa" } } },
  };

  assert.equal(
    decideReleaseAction({
      targetVersion: "0.2.0",
      headSha: SAMPLE_SHA,
      parentPackageVersion: "0.1.1",
      npmState: npmStateAt011,
    }).shouldPublish,
    true,
  );

  const docsCommitSkip = decideReleaseAction({
    targetVersion: "0.1.1",
    headSha: SAMPLE_SHA,
    parentPackageVersion: "0.1.1",
    eventName: "workflow_run",
    npmState: npmStateAt011,
    existingTagSha: OTHER_SHA,
    githubReleaseExists: true,
  });
  assert.equal(docsCommitSkip.shouldPublish, false);
  assert.equal(docsCommitSkip.reason, "already_released_at_earlier_commit");

  assert.throws(
    () =>
      decideReleaseAction({
        targetVersion: "0.1.0",
        headSha: SAMPLE_SHA,
        npmState: npmStateAt011,
      }),
    (err) => err instanceof ReleaseError && err.code === "VERSION_DOWNGRADE",
  );

  assert.throws(
    () =>
      decideReleaseAction({
        targetVersion: "0.2.0",
        headSha: SAMPLE_SHA,
        npmState: npmStateAt011,
        existingTagSha: OTHER_SHA,
      }),
    (err) => err instanceof ReleaseError && err.code === "TAG_MISMATCH",
  );

  const rerunRecovery = decideReleaseAction({
    targetVersion: "0.2.0",
    headSha: SAMPLE_SHA,
    parentPackageVersion: "0.1.1",
    eventName: "workflow_run",
    npmState: {
      exists: true,
      versions: ["0.1.0", "0.1.1", "0.2.0"],
      latest: "0.2.0",
      highestPublishedVersion: "0.2.0",
      versionRecords: { "0.2.0": { dist: { shasum: "bbbb" } } },
    },
    existingTagSha: null,
    githubReleaseExists: false,
    expectedTarballShasum: "bbbb",
  });
  assert.equal(rerunRecovery.shouldPublish, true);
  assert.equal(rerunRecovery.npmAlreadyPublished, true);
});

test("fetchNpmRegistryState fails closed on timeouts, DNS failures, HTTP 5xx/429/404, and malformed JSON", async () => {
  await assert.rejects(
    () =>
      fetchNpmRegistryState(EXPECTED_PACKAGE_NAME, {
        fetchImpl: async () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        },
      }),
    (err) => err instanceof ReleaseError && err.code === "NETWORK_ERROR" && err.details.kind === "timeout",
  );

  await assert.rejects(
    () =>
      fetchNpmRegistryState(EXPECTED_PACKAGE_NAME, {
        fetchImpl: async () => new Response("Unavailable", { status: 503 }),
      }),
    (err) => err instanceof ReleaseError && err.code === "NETWORK_ERROR" && err.details.status === 503,
  );

  await assert.rejects(
    () =>
      fetchNpmRegistryState(EXPECTED_PACKAGE_NAME, {
        fetchImpl: async () => new Response("{}", { status: 404 }),
      }),
    (err) => err instanceof ReleaseError && err.code === "NETWORK_ERROR" && err.details.status === 404,
  );
});

test("npm verification tolerates delayed propagation beyond the old six-attempt window", async () => {
  let elapsed = 0;
  let calls = 0;
  const waits = [];
  const shasum = "a".repeat(40);
  const result = await verifyNpmVersionAvailable({
    targetVersion: "0.2.1",
    expectedShasum: shasum,
    nowImpl: () => elapsed,
    sleepImpl: async (ms) => { waits.push(ms); elapsed += ms; },
    fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(options.headers["Cache-Control"], "no-cache");
      return calls < 19 ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({
        version: "0.2.1", mcpName: EXPECTED_MCP_NAME, dist: { shasum },
      }));
    },
  });
  assert.equal(result.verified, true);
  assert.equal(result.attempts, 19);
  assert.equal(elapsed, 90_000);
  assert.deepEqual(waits, Array(18).fill(5_000));
});

test("npm propagation deadline includes request time and caps the final sleep", async () => {
  let elapsed = 0;
  let calls = 0;
  const waits = [];
  await assert.rejects(() => verifyNpmVersionAvailable({
    targetVersion: "0.2.1", maxWaitMs: 12_000, maxAttempts: 100,
    nowImpl: () => elapsed,
    sleepImpl: async (ms) => { waits.push(ms); elapsed += ms; },
    fetchImpl: async () => {
      calls++;
      elapsed += 2_000;
      return new Response("{}", { status: 404 });
    },
  }), (error) => error instanceof ReleaseError && error.code === "NPM_VERIFICATION_TIMEOUT");
  assert.equal(elapsed, 12_000);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [5_000, 3_000]);
});

test("npm verification rejects metadata or checksum mismatches immediately, including missing checksum", async () => {
  const shasum = "a".repeat(40);
  const valid = { version: "0.2.1", mcpName: EXPECTED_MCP_NAME, dist: { shasum } };
  for (const data of [
    { ...valid, version: "0.2.0" },
    { ...valid, mcpName: "io.github.someone/other" },
    { ...valid, dist: { shasum: "b".repeat(40) } },
    { ...valid, dist: {} },
  ]) {
    let calls = 0;
    await assert.rejects(() => verifyNpmVersionAvailable({
      targetVersion: "0.2.1", expectedShasum: shasum,
      fetchImpl: async () => { calls++; return new Response(JSON.stringify(data)); },
      sleepImpl: async () => assert.fail("Permanent mismatch must not be retried"),
    }), (error) => error instanceof ReleaseError && error.code === "NPM_VERIFICATION_FAILED");
    assert.equal(calls, 1);
  }
});

test("npm verification network failures remain bounded and are not mistaken for publication success", async () => {
  let elapsed = 0;
  let calls = 0;
  await assert.rejects(() => verifyNpmVersionAvailable({
    targetVersion: "0.2.1", maxAttempts: 3, retryDelayMs: 1,
    nowImpl: () => elapsed,
    sleepImpl: async (ms) => { elapsed += ms; },
    fetchImpl: async () => { calls++; return new Response("Unavailable", { status: 503 }); },
  }), (error) => error instanceof ReleaseError && error.code === "NETWORK_ERROR" && error.details.status === 503);
  assert.equal(calls, 3);
  assert.equal(elapsed, 2);
});

test("verifyOidcRuntimePrerequisites and publishToNpm enforce Node >= 22.14 / npm >= 11.5.1, prefer OIDC, and fall back to scoped NPM_TOKEN without leaks", async () => {
  assert.deepEqual(
    verifyOidcRuntimePrerequisites({ nodeVersion: "24.10.0", npmVersion: "11.5.2" }),
    { nodeVersion: "24.10.0", npmVersion: "11.5.2" },
  );
  assert.throws(
    () => verifyOidcRuntimePrerequisites({ nodeVersion: "22.13.0", npmVersion: "11.5.2" }),
    (err) => err instanceof ReleaseError && err.code === "OIDC_RUNTIME_UNSUPPORTED",
  );
  assert.throws(
    () => verifyOidcRuntimePrerequisites({ nodeVersion: "24.10.0", npmVersion: "11.5.0" }),
    (err) => err instanceof ReleaseError && err.code === "OIDC_RUNTIME_UNSUPPORTED",
  );

  const fakeSecret = "npm_SecretGranularTokenValue1234567890";
  const fallbackCalls = [];
  let capturedUserConfigContent = "";
  let capturedUserConfigPath = "";

  const fallbackResult = await publishToNpm({
    tarballPath: "/tmp/omp-worker-mcp-0.2.0.tgz",
    targetVersion: "0.2.0",
    nodeVersion: "24.10.0",
    env: {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-req-token",
      NPM_TOKEN: fakeSecret,
    },
    runCommand: async (cmd, args, opts) => {
      if (args[0] === "--version") return { stdout: "11.6.0\n", stderr: "" };
      fallbackCalls.push({ cmd, args, env: opts.env });
      assert.ok(!args.join(" ").includes(fakeSecret));
      if (fallbackCalls.length === 1) {
        throw new Error("npm ERR! code E403 403 Forbidden - trusted publisher not configured");
      }
      capturedUserConfigPath = opts.env.NPM_CONFIG_USERCONFIG;
      capturedUserConfigContent = await readFile(capturedUserConfigPath, "utf8");
      assert.equal(opts.env.NODE_AUTH_TOKEN, fakeSecret);
      return { stdout: "ok", stderr: "" };
    },
  });

  assert.equal(fallbackResult.method, "token");
  assert.equal(capturedUserConfigContent.trim(), "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}");
  await assert.rejects(() => readFile(capturedUserConfigPath, "utf8"), /ENOENT/);

  // Narrow E404 auth-masking fallback during failed OIDC attempt for known existing package
  const e404Calls = [];
  const e404FallbackResult = await publishToNpm({
    tarballPath: "/tmp/omp-worker-mcp-0.2.0.tgz",
    targetVersion: "0.2.0",
    nodeVersion: "24.10.0",
    env: {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-req-token",
      NPM_TOKEN: fakeSecret,
    },
    runCommand: async (cmd, args) => {
      if (args[0] === "--version") return { stdout: "11.6.0\n", stderr: "" };
      e404Calls.push({ cmd, args });
      if (e404Calls.length === 1) {
        throw new Error("npm error code E404 | 404 Not Found - PUT https://registry.npmjs.org/omp-worker-mcp - Not found");
      }
      return { stdout: "ok", stderr: "" };
    },
  });
  assert.equal(e404FallbackResult.method, "token");
  assert.equal(e404Calls.length, 2);

  // 5xx and DNS failures during OIDC attempt must fail closed without falling back to token
  for (const netErr of [
    "npm error code E503 | 503 Service Unavailable - PUT https://registry.npmjs.org/omp-worker-mcp (--provenance)",
    "npm error code ENOTFOUND | request to https://registry.npmjs.org/omp-worker-mcp failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org (oidc)",
  ]) {
    let attempts = 0;
    await assert.rejects(
      () =>
        publishToNpm({
          tarballPath: "/tmp/omp-worker-mcp-0.2.0.tgz",
          targetVersion: "0.2.0",
          nodeVersion: "24.10.0",
          env: {
            ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com",
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-req-token",
            NPM_TOKEN: fakeSecret,
          },
          runCommand: async (_cmd, args) => {
            if (args[0] === "--version") return { stdout: "11.6.0\n", stderr: "" };
            attempts += 1;
            throw new Error(netErr);
          },
        }),
      (err) => err instanceof ReleaseError && err.code === "NPM_PUBLISH_FAILED",
    );
    assert.equal(attempts, 1);
  }

  // E404 for an unknown package must NOT trigger fallback
  let unknownPkgAttempts = 0;
  await assert.rejects(
    () =>
      publishToNpm({
        tarballPath: "/tmp/other-pkg-0.2.0.tgz",
        targetVersion: "0.2.0",
        packageName: "other-uncreated-pkg",
        nodeVersion: "24.10.0",
        env: {
          ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-req-token",
          NPM_TOKEN: fakeSecret,
        },
        runCommand: async (_cmd, args) => {
          if (args[0] === "--version") return { stdout: "11.6.0\n", stderr: "" };
          unknownPkgAttempts += 1;
          throw new Error("npm error code E404 | 404 Not Found - PUT https://registry.npmjs.org/other-uncreated-pkg - Not found");
        },
      }),
    (err) => err instanceof ReleaseError && err.code === "NPM_PUBLISH_FAILED",
  );
  assert.equal(unknownPkgAttempts, 1);
});

test("verifyMcpPublisherChecksum and executeOrderedRelease enforce strict order and never mask Registry failures", async () => {
  assert.throws(
    () => verifyMcpPublisherChecksum(Buffer.from("tampered"), MCP_PUBLISHER_LINUX_X64),
    (err) => err instanceof ReleaseError && err.code === "MCP_PUBLISHER_CHECKSUM_MISMATCH",
  );

  const tempDir = await mkdtemp(path.join(tmpdir(), "omp-ordered-release-test-"));
  try {
    const metadata = await validateReleaseMetadata(makeReleaseFixtures("0.2.0"));
    const tarballPath = await createTempTarball(tempDir, "0.2.0");
    const manifest = await createReleaseArtifactManifest({
      tarballPath,
      headSha: SAMPLE_SHA,
      ciRunId: "39978268729",
      metadata,
    });
    await writeFile(path.join(tempDir, "release-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    const sequence = [];
    const env = {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-token",
      GITHUB_TOKEN: "ghs_TestGithubTokenValue1234567890",
    };

    const result = await executeOrderedRelease({
      artifactDir: tempDir,
      expectedHeadSha: SAMPLE_SHA,
      expectedCiRunId: "39978268729",
      metadata,
      decision: { shouldPublish: true, npmAlreadyPublished: false, reason: "new_version" },
      env,
      verifyNpmAvailable: async () => {
        sequence.push("verify-npm-available");
        return { verified: true, version: "0.2.0", mcpName: EXPECTED_MCP_NAME, shasum: manifest.tarballShasum };
      },
      installMcpPublisher: async ({ installDir }) => {
        sequence.push("install-mcp-publisher-v1.8.2");
        return {
          binaryPath: path.join(installDir, "mcp-publisher"),
          version: MCP_PUBLISHER_VERSION,
          sha256: MCP_PUBLISHER_LINUX_X64.sha256,
        };
      },
      runCommand: async (cmd, args) => {
        if (cmd === "tar") return runSafeCommand(cmd, args);
        if (cmd === "npm" && args[0] === "--version") return { stdout: "11.6.0\n", stderr: "" };
        if (cmd === "npm") sequence.push(`npm:${args[0]}`);
        else if (cmd.endsWith("mcp-publisher")) sequence.push(`mcp-publisher:${args[0]}`);
        else if (cmd === "git") sequence.push(`git:${args[0]}`);
        else if (cmd === "gh") sequence.push(`gh:${args[0]}:${args[1]}`);
        return { stdout: "ok", stderr: "" };
      },
    });

    assert.equal(result.published, true);
    assert.deepEqual(sequence, [
      "npm:publish",
      "verify-npm-available",
      "install-mcp-publisher-v1.8.2",
      "mcp-publisher:validate",
      "mcp-publisher:login",
      "mcp-publisher:publish",
      "git:tag",
      "git:push",
      "gh:release:create",
    ]);

    const failedSequence = [];
    await assert.rejects(
      () =>
        executeOrderedRelease({
          artifactDir: tempDir,
          expectedHeadSha: SAMPLE_SHA,
          expectedCiRunId: "39978268729",
          metadata,
          decision: { shouldPublish: true, npmAlreadyPublished: false, reason: "new_version" },
          env,
          verifyNpmAvailable: async () => {
            failedSequence.push("verify-npm-available");
            return { verified: true, version: "0.2.0", mcpName: EXPECTED_MCP_NAME };
          },
          installMcpPublisher: async ({ installDir }) => {
            failedSequence.push("install-mcp-publisher-v1.8.2");
            return { binaryPath: path.join(installDir, "mcp-publisher") };
          },
          runCommand: async (cmd, args) => {
            if (cmd === "tar") return runSafeCommand(cmd, args);
            if (cmd === "npm" && args[0] === "--version") return { stdout: "11.6.0\n", stderr: "" };
            if (cmd === "npm") {
              failedSequence.push("npm:publish");
              return { stdout: "ok", stderr: "" };
            }
            if (cmd.endsWith("mcp-publisher")) {
              failedSequence.push(`mcp-publisher:${args[0]}`);
              if (args[0] === "publish") {
                throw new Error("POST https://registry.modelcontextprotocol.io/v0.1/publish: 504 Gateway Timeout");
              }
              return { stdout: "ok", stderr: "" };
            }
            failedSequence.push(`${cmd}:${args[0]}`);
            return { stdout: "ok", stderr: "" };
          },
        }),
      (err) => err instanceof ReleaseError && err.code === "MCP_REGISTRY_UNAVAILABLE" && err.retryable === true,
    );

    assert.deepEqual(failedSequence, [
      "npm:publish",
      "verify-npm-available",
      "install-mcp-publisher-v1.8.2",
      "mcp-publisher:validate",
      "mcp-publisher:login",
      "mcp-publisher:publish",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("runPackArtifactMode packs into default .release-artifact and rejects root, outside, symlink, and non-empty directories without touching sentinel files", async () => {
  const tempBase = await mkdtemp(path.join(tmpdir(), "omp-pack-mode-test-"));
  const workspaceDir = path.join(tempBase, "workspace");
  const outsideDir = path.join(tempBase, "outside");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });

  try {
    const { pkg, lock, serverJson, changelogText } = makeReleaseFixtures("0.2.0");
    await writeFile(path.join(workspaceDir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
    await writeFile(path.join(workspaceDir, "package-lock.json"), JSON.stringify(lock, null, 2), "utf8");
    await writeFile(path.join(workspaceDir, "server.json"), JSON.stringify(serverJson, null, 2), "utf8");
    await writeFile(path.join(workspaceDir, "CHANGELOG.md"), changelogText, "utf8");

    const rootSentinel = path.join(workspaceDir, "root-sentinel.txt");
    const outsideSentinel = path.join(outsideDir, "outside-sentinel.txt");
    const nonEmptyDir = path.join(workspaceDir, "non-empty-child");
    const nonEmptySentinel = path.join(nonEmptyDir, "keep-me.txt");
    await mkdir(nonEmptyDir, { recursive: true });
    await writeFile(rootSentinel, "root-untouched", "utf8");
    await writeFile(outsideSentinel, "outside-untouched", "utf8");
    await writeFile(nonEmptySentinel, "child-untouched", "utf8");

    const fakePackRunner = async (_cmd, args) => {
      const destIdx = args.indexOf("--pack-destination");
      const destDir = args[destIdx + 1];
      await createTempTarball(destDir, "0.2.0");
      return { stdout: `${EXPECTED_PACKAGE_NAME}-0.2.0.tgz\n`, stderr: "" };
    };

    // 1. Reject workspace root ("." and workspaceDir)
    for (const badRoot of [".", "./", workspaceDir, ""]) {
      await assert.rejects(
        () =>
          runPackArtifactMode(workspaceDir, {
            outputDir: badRoot,
            headSha: SAMPLE_SHA,
            ciRunId: "39978268729",
            runCommand: fakePackRunner,
          }),
        (err) => err instanceof ReleaseError && err.code === "INVALID_OUTPUT_DIR",
      );
    }
    assert.equal(await readFile(rootSentinel, "utf8"), "root-untouched");

    // 2. Reject outside paths ("..", "../outside", absolute outsideDir)
    for (const badOutside of ["..", "../outside", outsideDir]) {
      await assert.rejects(
        () =>
          runPackArtifactMode(workspaceDir, {
            outputDir: badOutside,
            headSha: SAMPLE_SHA,
            ciRunId: "39978268729",
            runCommand: fakePackRunner,
          }),
        (err) => err instanceof ReleaseError && err.code === "INVALID_OUTPUT_DIR",
      );
    }
    assert.equal(await readFile(outsideSentinel, "utf8"), "outside-untouched");

    // 3. Reject symlink escape pointing to outsideDir
    const symlinkDir = path.join(workspaceDir, "symlink-out");
    await symlink(outsideDir, symlinkDir, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      () =>
        runPackArtifactMode(workspaceDir, {
          outputDir: "symlink-out",
          headSha: SAMPLE_SHA,
          ciRunId: "39978268729",
          runCommand: fakePackRunner,
        }),
      (err) => err instanceof ReleaseError && err.code === "INVALID_OUTPUT_DIR",
    );
    assert.equal(await readFile(outsideSentinel, "utf8"), "outside-untouched");

    // 4. Reject non-empty child directory and preserve its sentinel file
    await assert.rejects(
      () =>
        runPackArtifactMode(workspaceDir, {
          outputDir: "non-empty-child",
          headSha: SAMPLE_SHA,
          ciRunId: "39978268729",
          runCommand: fakePackRunner,
        }),
      (err) => err instanceof ReleaseError && err.code === "INVALID_OUTPUT_DIR" && /non-empty/.test(err.message),
    );
    assert.equal(await readFile(nonEmptySentinel, "utf8"), "child-untouched");

    // 5. Succeed with default .release-artifact directory and verify produced bundle
    await runPackArtifactMode(workspaceDir, {
      headSha: SAMPLE_SHA,
      ciRunId: "39978268729",
      runCommand: fakePackRunner,
    });

    const defaultArtifactDir = path.join(workspaceDir, ".release-artifact");
    const metadata = await validateReleaseMetadata({ rootDir: workspaceDir });
    const verified = await verifyReleaseArtifact({
      artifactDir: defaultArtifactDir,
      expectedHeadSha: SAMPLE_SHA,
      expectedCiRunId: "39978268729",
      metadata,
    });
    assert.equal(verified.manifest.version, "0.2.0");
    assert.equal(verified.manifest.headSha, SAMPLE_SHA);
    assert.equal(await readFile(rootSentinel, "utf8"), "root-untouched");
    assert.equal(await readFile(outsideSentinel, "utf8"), "outside-untouched");
    assert.equal(await readFile(nonEmptySentinel, "utf8"), "child-untouched");
  } finally {
    await rm(tempBase, { recursive: true, force: true }).catch(() => {});
  }
});
