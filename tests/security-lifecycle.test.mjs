import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  cleanState,
  calculateDirectorySize,
  createGroupId,
  createJobId,
  ensureJobDirectory,
  groupDirectory,
  jobDirectory,
  validateGroupId,
  validateJobId,
  writeJob,
} from "../dist/job-store.js";
import { terminateOwnedProcessTree } from "../dist/runner.js";

test("Path traversal and invalid ID validation strictly blocks illegal inputs", async () => {
  const illegalJobIds = [
    "../",
    "..\\",
    "../../etc/passwd",
    "..\\..\\Windows\\System32",
    "job-123",
    "job-1000000000000-invalidhex",
    "job-1000000000000-abcdef123", // 9 hex chars
    "job-1000000000000-abcdef1", // 7 hex chars
    "/jobs/job-1000000000000-abcdef12",
    "C:\\jobs\\job-1000000000000-abcdef12",
    "",
    " ",
    "job-1000-abc",
  ];

  for (const id of illegalJobIds) {
    assert.throws(() => validateJobId(id), /Invalid job_id/, `Should reject job_id: ${id}`);
    assert.throws(() => jobDirectory(id), /Invalid job_id/, `Should reject jobDirectory: ${id}`);
  }

  const illegalGroupIds = [
    "../",
    "..\\",
    "../../etc/passwd",
    "group-123",
    "group-1000000000000-invalidhex",
    "",
    "group-abc",
  ];

  for (const id of illegalGroupIds) {
    assert.throws(() => validateGroupId(id), /Invalid group_id/, `Should reject group_id: ${id}`);
    assert.throws(() => groupDirectory(id), /Invalid group_id/, `Should reject groupDirectory: ${id}`);
  }

  // Valid ID works as expected
  const validJobId = createJobId();
  assert.doesNotThrow(() => validateJobId(validJobId));
  const dir = jobDirectory(validJobId);
  assert.ok(dir.endsWith(path.join("jobs", validJobId)));
});

test("Symlinks inside state directory are rejected, not followed, and external targets remain untouched", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-security-test-"));
  process.env.OMP_WORKER_STATE_DIR = root;

  // Create external target directory with important file
  const externalDir = await mkdtemp(path.join(tmpdir(), "omp-worker-external-target-"));
  const importantFile = path.join(externalDir, "critical-data.txt");
  await writeFile(importantFile, "TOP SECRET - DO NOT DELETE", "utf8");

  const jobsDir = path.join(root, "jobs");
  await mkdir(jobsDir, { recursive: true });

  const symlinkJobId = createJobId();
  const symlinkPath = path.join(jobsDir, symlinkJobId);

  let symlinkCreated = false;
  try {
    const symlinkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(externalDir, symlinkPath, symlinkType);
    symlinkCreated = true;
  } catch {
    // On some restricted Windows environments without symlink privilege
    symlinkCreated = false;
  }

  if (symlinkCreated) {
    // 1. calculateDirectorySize should ignore symlinks
    const size = await calculateDirectorySize(symlinkPath);
    assert.equal(size, 0, "calculateDirectorySize must not traverse symlinks");

    // 2. cleanState should detect and reject symlink without deleting external files
    const res = await cleanState({ ttlSeconds: 1, maxBytes: 1 });
    assert.ok(res.errors.some((e) => e.error.includes("Symbolic links") || e.error.includes("symlink")));

    // 3. Verify external target file is completely untouched and still exists
    const content = await readFile(importantFile, "utf8");
    assert.equal(content, "TOP SECRET - DO NOT DELETE");
  }
});

test("Cleanup is strictly confined to stateRoot/jobs and stateRoot/groups, preserving other directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-security-test-"));
  process.env.OMP_WORKER_STATE_DIR = root;

  // Create sibling directory in stateRoot
  const siblingDir = path.join(root, "sibling_custom_folder");
  await mkdir(siblingDir, { recursive: true });
  const siblingFile = path.join(siblingDir, "custom.json");
  await writeFile(siblingFile, '{"preserved": true}', "utf8");

  // Create illegal-named directory in jobs
  const jobsDir = path.join(root, "jobs");
  const illegalDir = path.join(jobsDir, "illegal-named-subfolder");
  await mkdir(illegalDir, { recursive: true });
  const illegalFile = path.join(illegalDir, "data.txt");
  await writeFile(illegalFile, "illegal data", "utf8");

  // Create valid completed job
  const validJobId = createJobId();
  const oldDate = new Date(Date.now() - 3600 * 1000).toISOString();
  await ensureJobDirectory(validJobId);
  await writeJob({
    version: 1,
    id: validJobId,
    status: "completed",
    goal: "Valid job",
    cwd: root,
    acceptance: [],
    maxAttempts: 1,
    currentAttempt: 1,
    createdAt: oldDate,
    updatedAt: oldDate,
    artifacts: [],
    verification: [],
    remaining: [],
    attempts: [],
  });

  const res = await cleanState({ ttlSeconds: 1 });
  assert.equal(res.cleanedJobs, 1);
  // Illegal directory in jobs is flagged in errors and not deleted
  assert.ok(res.errors.some((e) => e.error.includes("Invalid job directory name")));

  // Sibling custom directory must remain intact
  const siblingContent = await readFile(siblingFile, "utf8");
  assert.equal(siblingContent, '{"preserved": true}');

  // Illegal directory in jobs must not be deleted
  const illegalStat = await lstat(illegalDir);
  assert.ok(illegalStat.isDirectory());
});

test("terminateOwnedProcessTree deterministically terminates active child process tree", async () => {
  // Spawn a background node process that keeps running
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000); process.stdin.resume();"],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );

  assert.ok(child.pid);
  assert.equal(child.exitCode, null);

  const exitPromise = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });

  await terminateOwnedProcessTree(child);
  const result = await exitPromise;
  assert.ok(result !== undefined);
  assert.ok(child.killed || child.exitCode !== null);
});
