import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clearGroupCancellationRequest,
  createGroupId,
  ensureGroupDirectory,
  groupCancellationFilePath,
  groupDirectory,
  groupFilePath,
  hasGroupCancellationRequest,
  readGroup,
  readGroupCancellationRequest,
  validateGroupId,
  writeGroup,
  writeGroupCancellationRequest,
} from "../dist/job-store.js";
import { GROUP_TERMINAL_STATUSES } from "../dist/types.js";

test("Group ID validation and path generation", async () => {
  const validId = createGroupId();
  assert.match(validId, /^group-[0-9]+-[a-f0-9]{8}$/);
  assert.doesNotThrow(() => validateGroupId(validId));

  assert.throws(() => validateGroupId("invalid-id"), /Invalid group_id/);
  assert.throws(() => validateGroupId("group-123"), /Invalid group_id/);
  assert.throws(() => validateGroupId(""), /Invalid group_id/);

  const dir = groupDirectory(validId);
  assert.ok(dir.endsWith(path.join("groups", validId)));

  const file = groupFilePath(validId);
  assert.ok(file.endsWith(path.join("groups", validId, "group.json")));

  const cancelFile = groupCancellationFilePath(validId);
  assert.ok(cancelFile.endsWith(path.join("groups", validId, "cancel.request.json")));

  assert.throws(() => groupDirectory("invalid"), /Invalid group_id/);
  assert.throws(() => groupFilePath("invalid"), /Invalid group_id/);
  assert.throws(() => groupCancellationFilePath("invalid"), /Invalid group_id/);
});

test("GROUP_TERMINAL_STATUSES includes correct lifecycle terminal states", () => {
  assert.ok(GROUP_TERMINAL_STATUSES.has("completed"));
  assert.ok(GROUP_TERMINAL_STATUSES.has("partial"));
  assert.ok(GROUP_TERMINAL_STATUSES.has("failed"));
  assert.ok(GROUP_TERMINAL_STATUSES.has("timed_out"));
  assert.ok(GROUP_TERMINAL_STATUSES.has("cancelled"));

  assert.ok(!GROUP_TERMINAL_STATUSES.has("queued"));
  assert.ok(!GROUP_TERMINAL_STATUSES.has("running"));
  assert.ok(!GROUP_TERMINAL_STATUSES.has("cancelling"));
});

test("readGroup throws unknown group error for non-existent group", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-group-test-"));
  process.env.OMP_WORKER_STATE_DIR = stateRoot;
  const groupId = createGroupId();

  await assert.rejects(
    async () => readGroup(groupId),
    (err) => {
      assert.match(err.message, new RegExp(`Unknown group_id: ${groupId}`));
      return true;
    }
  );
});

test("writeGroup and readGroup support full lifecycle with coordinator/runner PID and lifecycle fields", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-group-test-"));
  process.env.OMP_WORKER_STATE_DIR = stateRoot;
  const groupId = createGroupId();
  await ensureGroupDirectory(groupId);

  const now = new Date().toISOString();
  /** @type {import("../dist/types.js").GroupRecord} */
  const record = {
    version: 1,
    id: groupId,
    status: "queued",
    cwd: stateRoot,
    maxParallel: 2,
    groupTimeoutMinutes: 10,
    supervisorBrief: "brief summary",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    coordinatorPid: 12345,
    runnerPid: 12345,
    tasks: [
      {
        id: "task-1",
        status: "pending",
        goal: "Task 1 goal",
        acceptance: ["Task 1 acceptance"],
        dependsOn: [],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 5,
        maxAttempts: 2,
      },
    ],
  };

  // 1. Initial queued state write and read
  await writeGroup(record);
  let stored = await readGroup(groupId);
  assert.equal(stored.id, groupId);
  assert.equal(stored.status, "queued");
  assert.equal(stored.coordinatorPid, 12345);
  assert.equal(stored.runnerPid, 12345);
  assert.equal(stored.startedAt, now);
  assert.equal(stored.tasks.length, 1);

  // 2. Transition to running
  record.status = "running";
  record.tasks[0].status = "running";
  record.tasks[0].jobId = "job-1000000000000-abcdef12";
  await writeGroup(record);
  stored = await readGroup(groupId);
  assert.equal(stored.status, "running");
  assert.equal(stored.tasks[0].status, "running");
  assert.equal(stored.tasks[0].jobId, "job-1000000000000-abcdef12");

  // 3. Transition to cancelling with cancel metadata
  const cancelTime = new Date().toISOString();
  record.status = "cancelling";
  record.cancelRequestedAt = cancelTime;
  record.cancelReason = "User requested cancellation";
  await writeGroup(record);
  stored = await readGroup(groupId);
  assert.equal(stored.status, "cancelling");
  assert.equal(stored.cancelRequestedAt, cancelTime);
  assert.equal(stored.cancelReason, "User requested cancellation");

  // 4. Transition to terminal cancelled / completed
  const completedTime = new Date().toISOString();
  record.status = "cancelled";
  record.completedAt = completedTime;
  record.summary = "Group cancelled by request";
  await writeGroup(record);
  stored = await readGroup(groupId);
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.completedAt, completedTime);
  assert.equal(stored.summary, "Group cancelled by request");
});

test("Group cancellation request read, write, check and clear lifecycle", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-group-test-"));
  process.env.OMP_WORKER_STATE_DIR = stateRoot;
  const groupId = createGroupId();
  await ensureGroupDirectory(groupId);

  // Before writing request
  assert.equal(await hasGroupCancellationRequest(groupId), false);
  assert.equal(await readGroupCancellationRequest(groupId), null);

  // Write cancellation request
  await writeGroupCancellationRequest(groupId, "Emergency stop requested");
  assert.equal(await hasGroupCancellationRequest(groupId), true);

  const req = await readGroupCancellationRequest(groupId);
  assert.ok(req);
  assert.equal(req.reason, "Emergency stop requested");
  assert.ok(req.requestedAt);

  // Clear cancellation request
  await clearGroupCancellationRequest(groupId);
  assert.equal(await hasGroupCancellationRequest(groupId), false);
  assert.equal(await readGroupCancellationRequest(groupId), null);

  // Clearing again should not throw (idempotent)
  await assert.doesNotReject(async () => clearGroupCancellationRequest(groupId));
});

test("writeGroup atomic write handles concurrent writes safely", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-group-test-"));
  process.env.OMP_WORKER_STATE_DIR = stateRoot;
  const groupId = createGroupId();
  await ensureGroupDirectory(groupId);

  const now = new Date().toISOString();
  /** @type {import("../dist/types.js").GroupRecord} */
  const record = {
    version: 1,
    id: groupId,
    status: "running",
    cwd: stateRoot,
    maxParallel: 4,
    groupTimeoutMinutes: 5,
    createdAt: now,
    updatedAt: now,
    tasks: [],
  };

  await writeGroup(record);

  // Concurrently update record multiple times
  await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const cloned = { ...record, summary: `Update ${i}` };
      await writeGroup(cloned);
    })
  );

  const finalRecord = await readGroup(groupId);
  assert.equal(finalRecord.id, groupId);
  assert.match(finalRecord.summary || "", /^Update \d+$/);
});
