import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const groupRunnerPath = path.join(projectRoot, "dist", "group-runner.js");

function createEnv(stateRoot) {
  return {
    ...process.env,
    OMP_WORKER_STATE_DIR: stateRoot,
    OMP_WORKER_OMP_COMMAND: process.execPath,
    OMP_WORKER_OMP_PREFIX_ARGS: JSON.stringify([path.join(projectRoot, "tests", "fake-omp.mjs")]),
  };
}

async function readPeakConcurrency(trackerDir) {
  const entries = await readdir(trackerDir);
  const intervals = [];
  for (const entry of entries) {
    if (entry.endsWith(".json")) {
      try {
        const raw = JSON.parse(await readFile(path.join(trackerDir, entry), "utf8"));
        if (typeof raw.start === "number" && typeof raw.end === "number") {
          intervals.push(raw);
        }
      } catch {}
    }
  }

  const events = [];
  for (const interval of intervals) {
    events.push({ time: interval.start, delta: 1 });
    events.push({ time: interval.end, delta: -1 });
  }

  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.delta - b.delta;
  });

  let current = 0;
  let peak = 0;
  for (const ev of events) {
    current += ev.delta;
    if (current > peak) peak = current;
  }
  return { peak, total: intervals.length };
}

async function createTestGroup(stateRoot, overrides = {}) {
  const groupId = `group-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const groupDir = path.join(stateRoot, "groups", groupId);
  await mkdir(groupDir, { recursive: true });

  const now = new Date().toISOString();
  const group = {
    version: 1,
    id: groupId,
    status: "queued",
    cwd: stateRoot,
    maxParallel: 2,
    groupTimeoutMinutes: 5,
    createdAt: now,
    updatedAt: now,
    tasks: [],
    ...overrides,
  };

  const groupFile = path.join(groupDir, "group.json");
  await writeFile(groupFile, JSON.stringify(group, null, 2), "utf8");
  return { groupId, groupDir, groupFile, group };
}

test("1. group-runner runs as standalone Node process and completes 3-step DAG in background", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-group-test-1-"));
  const env = createEnv(stateRoot);

  const { groupId, groupFile } = await createTestGroup(stateRoot, {
    tasks: [
      {
        id: "step-1",
        status: "ready",
        goal: "Step 1 DELAY_TEST_200",
        acceptance: ["step 1 done"],
        dependsOn: [],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
      {
        id: "step-2",
        status: "pending",
        goal: "Step 2 DELAY_TEST_200",
        acceptance: ["step 2 done"],
        dependsOn: ["step-1"],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
      {
        id: "step-3",
        status: "pending",
        goal: "Step 3 DELAY_TEST_200",
        acceptance: ["step 3 done"],
        dependsOn: ["step-2"],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
    ],
  });

  // Launch group-runner detached as a standalone process
  const child = spawn(process.execPath, [groupRunnerPath, groupFile], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env,
  });
  child.unref();

  // Poll until group completes
  const startTime = Date.now();
  let latestGroup;
  while (Date.now() - startTime < 15_000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const content = await readFile(groupFile, "utf8");
      latestGroup = JSON.parse(content);
      if (latestGroup.status === "completed" || latestGroup.status === "failed") {
        break;
      }
    } catch {}
  }

  assert.ok(latestGroup, "group.json should be readable");
  assert.equal(latestGroup.status, "completed", `Group should complete, got: ${latestGroup.status}`);
  assert.ok(latestGroup.coordinatorPid || latestGroup.runnerPid, "Coordinator PID should be recorded");
  assert.ok(latestGroup.startedAt, "startedAt should be set");
  assert.ok(latestGroup.completedAt, "completedAt should be set");

  // Verify all tasks completed in sequence
  assert.equal(latestGroup.tasks.length, 3);
  for (const t of latestGroup.tasks) {
    assert.equal(t.status, "completed", `Task ${t.id} should be completed`);
    assert.ok(t.jobId, `Task ${t.id} should have jobId`);
    assert.ok(t.startedAt, `Task ${t.id} should have startedAt`);
    assert.ok(t.completedAt, `Task ${t.id} should have completedAt`);
  }

  // Verify stable result order is preserved
  assert.deepEqual(
    latestGroup.tasks.map((t) => t.id),
    ["step-1", "step-2", "step-3"],
  );
});

test("2. Concurrency cap (maxParallel) is strictly respected across tasks", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-group-test-2-"));
  const env = createEnv(stateRoot);
  const trackerDir = path.join(stateRoot, "concurrency-track");
  await mkdir(trackerDir, { recursive: true });

  const tasks = Array.from({ length: 4 }, (_, i) => ({
    id: `task-${i + 1}`,
    status: "ready",
    goal: `Task ${i + 1} DELAY_TEST_400 TRACK_CONCURRENCY:${trackerDir}`,
    acceptance: [`task ${i + 1} done`],
    dependsOn: [],
    access: "read_only",
    ownership: [],
    timeoutMinutes: 1,
    maxAttempts: 1,
  }));

  const { groupFile } = await createTestGroup(stateRoot, {
    maxParallel: 2,
    tasks,
  });

  const runResult = spawnSync(process.execPath, [groupRunnerPath, groupFile], {
    encoding: "utf8",
    env,
    timeout: 15_000,
  });
  assert.equal(runResult.status, 0, runResult.stderr);

  const finalGroup = JSON.parse(await readFile(groupFile, "utf8"));
  assert.equal(finalGroup.status, "completed");

  const { peak, total } = await readPeakConcurrency(trackerDir);
  assert.equal(total, 4);
  assert.ok(peak <= 2, `Peak concurrency ${peak} exceeded maxParallel 2`);
  assert.ok(peak >= 1, `Peak concurrency was ${peak}`);
});

test("3. Partial failure marks dependent tasks blocked while independent siblings finish", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-group-test-3-"));
  const env = createEnv(stateRoot);

  const { groupFile } = await createTestGroup(stateRoot, {
    tasks: [
      {
        id: "fail-root",
        status: "ready",
        goal: "Root task that will fail FAIL_TEST",
        acceptance: ["should fail"],
        dependsOn: [],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
      {
        id: "dep-child",
        status: "pending",
        goal: "Child depending on fail-root DELAY_TEST_100",
        acceptance: ["should not run"],
        dependsOn: ["fail-root"],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
      {
        id: "dep-grandchild",
        status: "pending",
        goal: "Grandchild depending on dep-child DELAY_TEST_100",
        acceptance: ["should not run"],
        dependsOn: ["dep-child"],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
      {
        id: "independent-sibling",
        status: "ready",
        goal: "Independent task DELAY_TEST_200",
        acceptance: ["should succeed"],
        dependsOn: [],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
    ],
  });

  const runResult = spawnSync(process.execPath, [groupRunnerPath, groupFile], {
    encoding: "utf8",
    env,
    timeout: 15_000,
  });
  assert.equal(runResult.status, 0, runResult.stderr);

  const finalGroup = JSON.parse(await readFile(groupFile, "utf8"));
  assert.equal(finalGroup.status, "partial");

  const failRoot = finalGroup.tasks.find((t) => t.id === "fail-root");
  const depChild = finalGroup.tasks.find((t) => t.id === "dep-child");
  const depGrandchild = finalGroup.tasks.find((t) => t.id === "dep-grandchild");
  const sibling = finalGroup.tasks.find((t) => t.id === "independent-sibling");

  assert.equal(failRoot.status, "failed");
  assert.equal(depChild.status, "blocked");
  assert.equal(depGrandchild.status, "blocked");
  assert.equal(sibling.status, "completed");
});

test("4. Group cancellation precisely propagates to active subtasks and cancels pending tasks", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-group-test-4-"));
  const env = createEnv(stateRoot);

  const { groupId, groupDir, groupFile } = await createTestGroup(stateRoot, {
    tasks: [
      {
        id: "slow-step-1",
        status: "ready",
        goal: "Slow task DELAY_TEST_3000",
        acceptance: ["slow"],
        dependsOn: [],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
      {
        id: "pending-step-2",
        status: "pending",
        goal: "Pending task DELAY_TEST_500",
        acceptance: ["pending"],
        dependsOn: ["slow-step-1"],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
    ],
  });

  const child = spawn(process.execPath, [groupRunnerPath, groupFile], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env,
  });
  child.unref();

  // Wait until slow-step-1 is running
  let activeJobId = null;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 5_000) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      const content = await readFile(groupFile, "utf8");
      const record = JSON.parse(content);
      const step1 = record.tasks.find((t) => t.id === "slow-step-1");
      if (step1 && step1.jobId && step1.status === "running") {
        activeJobId = step1.jobId;
        break;
      }
    } catch {}
  }
  assert.ok(activeJobId, "slow-step-1 should have started and acquired a jobId");

  // Write group cancellation request
  const cancelFile = path.join(groupDir, "cancel.request.json");
  await writeFile(
    cancelFile,
    JSON.stringify({
      requestedAt: new Date().toISOString(),
      reason: "User cancelled the group",
    }),
    "utf8",
  );

  // Poll until group status becomes cancelled
  let finalGroup;
  const cancelWaitStart = Date.now();
  while (Date.now() - cancelWaitStart < 10_000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const content = await readFile(groupFile, "utf8");
      finalGroup = JSON.parse(content);
      if (finalGroup.status === "cancelled") {
        break;
      }
    } catch {}
  }

  assert.ok(finalGroup, "final group must be readable");
  assert.equal(finalGroup.status, "cancelled");

  // Verify subtask job received cancellation request or ended as cancelled
  const step1 = finalGroup.tasks.find((t) => t.id === "slow-step-1");
  const step2 = finalGroup.tasks.find((t) => t.id === "pending-step-2");
  assert.equal(step1.status, "cancelled");
  assert.equal(step2.status, "cancelled");
});

test("5. Group timeout cancels active subtasks and marks remaining tasks timed_out", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-group-test-5-"));
  const env = createEnv(stateRoot);

  // Group timeout set to 0.05 min (3 seconds)
  const { groupFile } = await createTestGroup(stateRoot, {
    groupTimeoutMinutes: 0.05,
    tasks: [
      {
        id: "timeout-task-1",
        status: "ready",
        goal: "Long task DELAY_TEST_6000",
        acceptance: ["slow"],
        dependsOn: [],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
      {
        id: "timeout-task-2",
        status: "pending",
        goal: "Pending task",
        acceptance: ["pending"],
        dependsOn: ["timeout-task-1"],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
    ],
  });

  const runResult = spawnSync(process.execPath, [groupRunnerPath, groupFile], {
    encoding: "utf8",
    env,
    timeout: 15_000,
  });

  const finalGroup = JSON.parse(await readFile(groupFile, "utf8"));
  assert.equal(finalGroup.status, "timed_out");
  const task1 = finalGroup.tasks.find((t) => t.id === "timeout-task-1");
  const task2 = finalGroup.tasks.find((t) => t.id === "timeout-task-2");
  assert.equal(task1.status, "timed_out");
  assert.equal(task2.status, "timed_out");
});

test("6. Coordinator unexpected exceptions are explicitly persisted as failed group status with error", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-group-test-6-"));
  const env = createEnv(stateRoot);

  // Provide invalid cwd that causes orchestrator to fail immediately
  const { groupFile } = await createTestGroup(stateRoot, {
    cwd: path.join(stateRoot, "non_existent_directory_for_error_test"),
    tasks: [
      {
        id: "task-1",
        status: "ready",
        goal: "Task 1",
        acceptance: ["done"],
        dependsOn: [],
        access: "read_only",
        ownership: [],
        timeoutMinutes: 1,
        maxAttempts: 1,
      },
    ],
  });

  const runResult = spawnSync(process.execPath, [groupRunnerPath, groupFile], {
    encoding: "utf8",
    env,
    timeout: 10_000,
  });

  // runner process should exit with failure (non-zero or handled)
  const finalGroup = JSON.parse(await readFile(groupFile, "utf8"));
  assert.equal(finalGroup.status, "failed");
  assert.ok(finalGroup.error, "Coordinator error should be persisted in group.json");
  assert.match(finalGroup.error, /does not exist|non_existent_directory/i);
});
