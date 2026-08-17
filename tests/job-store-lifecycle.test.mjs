import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanState,
  createGroupId,
  createJobId,
  ensureGroupDirectory,
  ensureJobDirectory,
  getRetentionOptionsFromEnv,
  jobDirectory,
  groupDirectory,
  writeJob,
  writeGroup,
  readJob,
  readGroup,
} from "../dist/job-store.js";

test("Default retention configuration does not delete any state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-lifecycle-test-"));
  process.env.OMP_WORKER_STATE_DIR = root;

  // 1. Create a completed job and a running job
  const completedJobId = createJobId();
  await ensureJobDirectory(completedJobId);
  const oldDate = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  await writeJob({
    version: 1,
    id: completedJobId,
    status: "completed",
    goal: "Old completed job",
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

  const runningJobId = createJobId();
  await ensureJobDirectory(runningJobId);
  await writeJob({
    version: 1,
    id: runningJobId,
    status: "running",
    goal: "Running job",
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

  // 2. Create a completed group
  const completedGroupId = createGroupId();
  await ensureGroupDirectory(completedGroupId);
  await writeGroup({
    version: 1,
    id: completedGroupId,
    status: "completed",
    cwd: root,
    maxParallel: 2,
    groupTimeoutMinutes: 10,
    createdAt: oldDate,
    updatedAt: oldDate,
    tasks: [],
  });

  // Run cleanup with default/empty options
  const res = await cleanState({});
  assert.equal(res.cleanedJobs, 0);
  assert.equal(res.cleanedGroups, 0);
  assert.equal(res.freedBytes, 0);
  assert.equal(res.retainedJobs, 2);
  assert.equal(res.retainedGroups, 1);
  assert.equal(res.errors.length, 0);

  // Verify all records still exist on disk
  const job1 = await readJob(completedJobId);
  assert.equal(job1.id, completedJobId);
  const job2 = await readJob(runningJobId);
  assert.equal(job2.id, runningJobId);
  const group1 = await readGroup(completedGroupId);
  assert.equal(group1.id, completedGroupId);
});

test("TTL cleanup removes only expired terminal jobs and groups, preserving recent and running items", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-lifecycle-test-"));
  process.env.OMP_WORKER_STATE_DIR = root;

  const now = Date.now();
  const twoHoursAgo = new Date(now - 2 * 3600 * 1000).toISOString();
  const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();

  // 1. Expired completed job (2h ago)
  const expiredJobId = createJobId();
  await ensureJobDirectory(expiredJobId);
  await writeJob({
    version: 1,
    id: expiredJobId,
    status: "completed",
    goal: "Expired job",
    cwd: root,
    acceptance: [],
    maxAttempts: 1,
    currentAttempt: 1,
    createdAt: twoHoursAgo,
    updatedAt: twoHoursAgo,
    artifacts: [],
    verification: [],
    remaining: [],
    attempts: [],
  });

  // 2. Recent completed job (10m ago)
  const recentJobId = createJobId();
  await ensureJobDirectory(recentJobId);
  await writeJob({
    version: 1,
    id: recentJobId,
    status: "completed",
    goal: "Recent job",
    cwd: root,
    acceptance: [],
    maxAttempts: 1,
    currentAttempt: 1,
    createdAt: tenMinutesAgo,
    updatedAt: tenMinutesAgo,
    artifacts: [],
    verification: [],
    remaining: [],
    attempts: [],
  });

  // 3. Expired timestamp but RUNNING status job (must NEVER be deleted)
  const runningJobId = createJobId();
  await ensureJobDirectory(runningJobId);
  await writeJob({
    version: 1,
    id: runningJobId,
    status: "running",
    goal: "Active running job",
    cwd: root,
    acceptance: [],
    maxAttempts: 1,
    currentAttempt: 1,
    createdAt: twoHoursAgo,
    updatedAt: twoHoursAgo,
    artifacts: [],
    verification: [],
    remaining: [],
    attempts: [],
  });

  // 4. Expired failed group (2h ago)
  const expiredGroupId = createGroupId();
  await ensureGroupDirectory(expiredGroupId);
  await writeGroup({
    version: 1,
    id: expiredGroupId,
    status: "failed",
    cwd: root,
    maxParallel: 2,
    groupTimeoutMinutes: 10,
    createdAt: twoHoursAgo,
    updatedAt: twoHoursAgo,
    tasks: [],
  });

  // 5. Recent completed group (10m ago)
  const recentGroupId = createGroupId();
  await ensureGroupDirectory(recentGroupId);
  await writeGroup({
    version: 1,
    id: recentGroupId,
    status: "completed",
    cwd: root,
    maxParallel: 2,
    groupTimeoutMinutes: 10,
    createdAt: tenMinutesAgo,
    updatedAt: tenMinutesAgo,
    tasks: [],
  });

  // Execute TTL cleanup with 1 hour TTL (3600 seconds)
  const res = await cleanState({ ttlSeconds: 3600 });
  assert.equal(res.cleanedJobs, 1);
  assert.equal(res.cleanedGroups, 1);
  assert.ok(res.freedBytes > 0);
  assert.equal(res.retainedJobs, 2); // recentJob + runningJob
  assert.equal(res.retainedGroups, 1); // recentGroup
  assert.equal(res.errors.length, 0);

  // Verify expired items are removed
  await assert.rejects(async () => readJob(expiredJobId));
  await assert.rejects(async () => readGroup(expiredGroupId));

  // Verify non-expired and running items are retained
  const recentJob = await readJob(recentJobId);
  assert.equal(recentJob.id, recentJobId);
  const runningJob = await readJob(runningJobId);
  assert.equal(runningJob.id, runningJobId);
  const recentGroup = await readGroup(recentGroupId);
  assert.equal(recentGroup.id, recentGroupId);
});

test("Max bytes cleanup removes oldest terminal items first (LRU) until within budget", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-lifecycle-test-"));
  process.env.OMP_WORKER_STATE_DIR = root;

  const t1 = new Date(Date.now() - 3000 * 1000).toISOString();
  const t2 = new Date(Date.now() - 2000 * 1000).toISOString();
  const t3 = new Date(Date.now() - 1000 * 1000).toISOString();

  // Create 3 terminal jobs with payload files
  const job1Id = createJobId();
  const dir1 = await ensureJobDirectory(job1Id);
  await writeFile(path.join(dir1, "large.log"), "X".repeat(5000));
  await writeJob({
    version: 1,
    id: job1Id,
    status: "completed",
    goal: "Oldest job",
    cwd: root,
    acceptance: [],
    maxAttempts: 1,
    currentAttempt: 1,
    createdAt: t1,
    updatedAt: t1,
    artifacts: [],
    verification: [],
    remaining: [],
    attempts: [],
  });

  const job2Id = createJobId();
  const dir2 = await ensureJobDirectory(job2Id);
  await writeFile(path.join(dir2, "large.log"), "Y".repeat(5000));
  await writeJob({
    version: 1,
    id: job2Id,
    status: "failed",
    goal: "Middle job",
    cwd: root,
    acceptance: [],
    maxAttempts: 1,
    currentAttempt: 1,
    createdAt: t2,
    updatedAt: t2,
    artifacts: [],
    verification: [],
    remaining: [],
    attempts: [],
  });

  const job3Id = createJobId();
  const dir3 = await ensureJobDirectory(job3Id);
  await writeFile(path.join(dir3, "large.log"), "Z".repeat(5000));
  await writeJob({
    version: 1,
    id: job3Id,
    status: "completed",
    goal: "Newest job",
    cwd: root,
    acceptance: [],
    maxAttempts: 1,
    currentAttempt: 1,
    createdAt: t3,
    updatedAt: t3,
    artifacts: [],
    verification: [],
    remaining: [],
    attempts: [],
  });

  // Also add an active running job with payload
  const runningId = createJobId();
  const dirRunning = await ensureJobDirectory(runningId);
  await writeFile(path.join(dirRunning, "large.log"), "R".repeat(5000));
  await writeJob({
    version: 1,
    id: runningId,
    status: "running",
    goal: "Active running job",
    cwd: root,
    acceptance: [],
    maxAttempts: 1,
    currentAttempt: 1,
    createdAt: t1,
    updatedAt: t1,
    artifacts: [],
    verification: [],
    remaining: [],
    attempts: [],
  });

  // Total size is ~22KB. Set maxBytes to 12KB.
  // Expect job1 (oldest) and job2 (next oldest) to be removed, while job3 (newest) and runningId are preserved.
  const res = await cleanState({ maxBytes: 12000 });
  assert.ok(res.cleanedJobs >= 1);
  assert.equal(res.errors.length, 0);

  // job1 must be deleted
  await assert.rejects(async () => readJob(job1Id));
  // running job must always remain
  const preservedRunning = await readJob(runningId);
  assert.equal(preservedRunning.id, runningId);
  // job3 (newest) must remain
  const preservedJob3 = await readJob(job3Id);
  assert.equal(preservedJob3.id, job3Id);
});

test("Corrupted state files are safely preserved and reported in errors instead of being silently deleted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-lifecycle-test-"));
  process.env.OMP_WORKER_STATE_DIR = root;

  // Create a corrupt job directory with malformed JSON
  const corruptJobId = createJobId();
  const corruptDir = await ensureJobDirectory(corruptJobId);
  await writeFile(path.join(corruptDir, "job.json"), "{ malformed json content !!! ");

  // Create a valid completed job
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

  // Clean with TTL 1 second
  const res = await cleanState({ ttlSeconds: 1 });
  // The corrupt directory should not be deleted, and should appear in res.errors
  assert.equal(res.cleanedJobs, 1); // Only validJobId deleted
  assert.ok(res.errors.length > 0);
  const corruptError = res.errors.find((e) => e.id === corruptJobId);
  assert.ok(corruptError, "Corrupt error must be recorded");
  assert.match(corruptError.error, /Corrupted or unreadable job\.json/);

  // Verify corrupt directory still exists
  const corruptStat = await lstat(corruptDir);
  assert.ok(corruptStat.isDirectory());
});

test("dry_run flag simulates cleanup without removing directories from filesystem", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-lifecycle-test-"));
  process.env.OMP_WORKER_STATE_DIR = root;

  const oldDate = new Date(Date.now() - 7200 * 1000).toISOString();
  const jobId = createJobId();
  await ensureJobDirectory(jobId);
  await writeJob({
    version: 1,
    id: jobId,
    status: "completed",
    goal: "Job for dry run",
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

  const res = await cleanState({ ttlSeconds: 3600, dryRun: true });
  assert.equal(res.dryRun, true);
  assert.equal(res.cleanedJobs, 1);
  assert.ok(res.freedBytes > 0);
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].deleted, false);

  // Verify directory still exists on disk
  const job = await readJob(jobId);
  assert.equal(job.id, jobId);
});

test("getRetentionOptionsFromEnv correctly parses environment variables", () => {
  const prevTTL = process.env.OMP_WORKER_RETENTION_TTL_SECONDS;
  const prevMaxBytes = process.env.OMP_WORKER_RETENTION_MAX_BYTES;

  try {
    delete process.env.OMP_WORKER_RETENTION_TTL_SECONDS;
    delete process.env.OMP_WORKER_RETENTION_MAX_BYTES;
    const emptyOpts = getRetentionOptionsFromEnv();
    assert.equal(emptyOpts.ttlSeconds, undefined);
    assert.equal(emptyOpts.maxBytes, undefined);

    process.env.OMP_WORKER_RETENTION_TTL_SECONDS = "86400";
    process.env.OMP_WORKER_RETENTION_MAX_BYTES = "10485760";
    const parsed = getRetentionOptionsFromEnv();
    assert.equal(parsed.ttlSeconds, 86400);
    assert.equal(parsed.maxBytes, 10485760);

    process.env.OMP_WORKER_RETENTION_TTL_SECONDS = "invalid";
    const invalidParsed = getRetentionOptionsFromEnv();
    assert.equal(invalidParsed.ttlSeconds, undefined);
  } finally {
    if (prevTTL !== undefined) process.env.OMP_WORKER_RETENTION_TTL_SECONDS = prevTTL;
    else delete process.env.OMP_WORKER_RETENTION_TTL_SECONDS;
    if (prevMaxBytes !== undefined) process.env.OMP_WORKER_RETENTION_MAX_BYTES = prevMaxBytes;
    else delete process.env.OMP_WORKER_RETENTION_MAX_BYTES;
  }
});
