import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { parseAllowedRoots, validateAllowedWorkingDirectory } from "../dist/security.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("allowed roots are optional and preserve backward-compatible behavior", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-allowed-root-"));
  const nested = path.join(root, "nested");
  await mkdir(nested);

  assert.equal(parseAllowedRoots(undefined), undefined);
  const resolved = await validateAllowedWorkingDirectory(nested, undefined);
  assert.equal(resolved, await import("node:fs/promises").then(({ realpath }) => realpath(nested)));
});

test("allowed roots accept descendants and reject sibling prefix tricks", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "omp-worker-allowed-root-"));
  const allowed = path.join(parent, "project");
  const nested = path.join(allowed, "src");
  const sibling = path.join(parent, "project-evil");
  await mkdir(nested, { recursive: true });
  await mkdir(sibling, { recursive: true });

  const config = JSON.stringify([allowed]);
  await assert.doesNotReject(() => validateAllowedWorkingDirectory(nested, config));
  await assert.rejects(
    () => validateAllowedWorkingDirectory(sibling, config),
    /outside OMP_WORKER_ALLOWED_ROOTS/,
  );
});

test("allowed roots reject symlink or junction escapes", async (t) => {
  const allowed = await mkdtemp(path.join(tmpdir(), "omp-worker-allowed-root-"));
  const outside = await mkdtemp(path.join(tmpdir(), "omp-worker-outside-root-"));
  const escape = path.join(allowed, "escape");

  try {
    await symlink(outside, escape, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`symlink/junction creation unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  await assert.rejects(
    () => validateAllowedWorkingDirectory(escape, JSON.stringify([allowed])),
    /outside OMP_WORKER_ALLOWED_ROOTS/,
  );
});

test("invalid allowed-root configuration fails closed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-allowed-root-"));
  await assert.rejects(
    () => validateAllowedWorkingDirectory(root, ""),
    /non-empty JSON array/,
  );
  await assert.rejects(
    () => validateAllowedWorkingDirectory(root, "not-json"),
    /must be a JSON array/,
  );
  await assert.rejects(
    () => validateAllowedWorkingDirectory(root, JSON.stringify([])),
    /non-empty JSON array/,
  );
  await assert.rejects(
    () => validateAllowedWorkingDirectory(root, JSON.stringify(["relative/path"])),
    /must be an absolute path/,
  );
});

test("runner refuses to launch OMP when job cwd is outside allowed roots", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-state-"));
  const allowed = await mkdtemp(path.join(tmpdir(), "omp-worker-allowed-root-"));
  const forbidden = await mkdtemp(path.join(tmpdir(), "omp-worker-forbidden-root-"));
  const id = "job-1000000000000-abcdef12";
  const directory = path.join(stateRoot, "jobs", id);
  await mkdir(directory, { recursive: true });
  const promptPath = path.join(directory, "attempt-01.prompt.md");
  await writeFile(promptPath, "fake prompt", "utf8");
  const now = new Date().toISOString();
  const job = {
    version: 1,
    id,
    status: "queued",
    goal: "must not execute",
    cwd: forbidden,
    acceptance: [],
    maxAttempts: 1,
    currentAttempt: 1,
    createdAt: now,
    updatedAt: now,
    artifacts: [],
    verification: [],
    remaining: [],
    attempts: [
      {
        number: 1,
        kind: "delegate",
        status: "queued",
        promptPath,
        stdoutPath: path.join(directory, "attempt-01.stdout.jsonl"),
        stderrPath: path.join(directory, "attempt-01.stderr.log"),
        timeoutMinutes: 1,
      },
    ],
  };
  const jobFile = path.join(directory, "job.json");
  await writeFile(jobFile, `${JSON.stringify(job, null, 2)}\n`, "utf8");

  const result = spawnSync(process.execPath, [path.join(projectRoot, "dist", "runner.js"), jobFile], {
    encoding: "utf8",
    env: {
      ...process.env,
      OMP_WORKER_STATE_DIR: stateRoot,
      OMP_WORKER_ALLOWED_ROOTS: JSON.stringify([allowed]),
      OMP_WORKER_OMP_COMMAND: process.execPath,
      OMP_WORKER_OMP_PREFIX_ARGS: JSON.stringify([path.join(projectRoot, "tests", "fake-omp.mjs")]),
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside OMP_WORKER_ALLOWED_ROOTS/);
  const failed = JSON.parse(await readFile(jobFile, "utf8"));
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /outside OMP_WORKER_ALLOWED_ROOTS/);
  assert.equal(failed.attempts[0].status, "failed");
});
