import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function createTestClient(stateRoot) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, "dist", "index.js")],
    env: {
      ...process.env,
      OMP_WORKER_STATE_DIR: stateRoot,
      OMP_WORKER_OMP_COMMAND: process.execPath,
      OMP_WORKER_OMP_PREFIX_ARGS: JSON.stringify([path.join(projectRoot, "tests", "fake-omp.mjs")]),
    },
  });
  const client = new Client({ name: "omp-worker-e2e-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
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

const GROUP_TERMINAL_SET = new Set(["completed", "partial", "failed", "timed_out", "cancelled"]);
const JOB_TERMINAL_SET = new Set(["completed", "failed", "cancelled", "timed_out", "blocked", "awaiting_review"]);

async function waitForGroupTerminal(client, groupId, { timeoutMs = 90_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStructured = null;
  while (Date.now() < deadline) {
    const waitRes = await client.callTool({
      name: "omp_wait_group",
      arguments: { group_id: groupId, wait_seconds: 2 },
    });
    lastStructured = waitRes.structuredContent;
    if (lastStructured && GROUP_TERMINAL_SET.has(lastStructured.status)) {
      return lastStructured;
    }
    if (lastStructured) {
      assert.equal(lastStructured.tasks, undefined, "Non-terminal group status must omit tasks array");
    }
  }
  throw new Error(`Group ${groupId} did not reach terminal state within ${timeoutMs}ms (last=${lastStructured?.status})`);
}

async function waitForJobTerminal(client, jobId, { timeoutMs = 90_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStructured = null;
  while (Date.now() < deadline) {
    const waitRes = await client.callTool({
      name: "omp_wait",
      arguments: { job_id: jobId, wait_seconds: 2 },
    });
    lastStructured = waitRes.structuredContent;
    if (lastStructured && JOB_TERMINAL_SET.has(lastStructured.status)) {
      return lastStructured;
    }
    if (lastStructured) {
      assert.equal("final_response" in lastStructured, false);
      assert.equal("attempts" in lastStructured, false);
    }
  }
  throw new Error(`Job ${jobId} did not reach terminal state within ${timeoutMs}ms (last=${lastStructured?.status})`);
}


test("E2E 1: Slow DAG exceeding initial wait, cross-client reconnection, compact wait and single final aggregation", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-e2e-slow-dag-"));

  // Client 1 submits a 3-step slow DAG with initial wait_seconds: 1
  const { client: client1, transport: transport1 } = await createTestClient(stateRoot);
  let groupId;
  try {
    const startRes = await client1.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 1,
        max_parallel: 2,
        supervisor_brief: "E2E slow DAG test brief",
        tasks: [
          {
            id: "step-1",
            goal: "Step 1 DELAY_TEST_800",
            access: "write",
            ownership: ["file1.txt"],
          },
          {
            id: "step-2",
            goal: "Step 2 DELAY_TEST_800",
            depends_on: ["step-1"],
            access: "write",
            ownership: ["file2.txt"],
          },
          {
            id: "step-3",
            goal: "Step 3 DELAY_TEST_800",
            depends_on: ["step-2"],
            access: "write",
            ownership: ["file3.txt"],
          },
        ],
      },
    });

    const structured1 = startRes.structuredContent;
    assert.ok(structured1, "Initial call should return structuredContent");
    assert.equal(structured1.status, "running", "Initial call should return running status");
    assert.ok(structured1.group_id, "Should return group_id");
    assert.equal(structured1.tasks, undefined, "Running status must omit tasks array");
    assert.equal(structured1.total_tasks, 3);
    groupId = structured1.group_id;
  } finally {
    // Simulate client 1 closing / disconnecting
    await transport1.close().catch(() => {});
    await client1.close().catch(() => {});
  }

  // Client 2 connects fresh and polls with omp_wait_group
  const { client: client2, transport: transport2 } = await createTestClient(stateRoot);
  try {
    const waitRes = await client2.callTool({
      name: "omp_wait_group",
      arguments: {
        group_id: groupId,
        wait_seconds: 10,
      },
    });

    let structured2 = waitRes.structuredContent;
    assert.ok(structured2, "Wait call should return structuredContent");
    if (!GROUP_TERMINAL_SET.has(structured2.status)) {
      assert.equal(structured2.tasks, undefined, "Running status must omit tasks array");
      structured2 = await waitForGroupTerminal(client2, groupId);
    }
    assert.equal(structured2.status, "completed", "Group should reach completed status");
    assert.equal(structured2.group_id, groupId);
    assert.equal(structured2.total_tasks, 3);
    assert.equal(structured2.completed_tasks, 3);
    assert.equal(structured2.failed_tasks, 0);
    assert.equal(structured2.cancelled_tasks, 0);
    assert.equal(structured2.blocked_tasks, 0);

    // Verify stable input order in aggregated tasks
    assert.ok(Array.isArray(structured2.tasks), "Completed group must return aggregated tasks array");
    assert.equal(structured2.tasks.length, 3);
    assert.equal(structured2.tasks[0].id, "step-1");
    assert.equal(structured2.tasks[1].id, "step-2");
    assert.equal(structured2.tasks[2].id, "step-3");

    for (const taskResult of structured2.tasks) {
      assert.equal(taskResult.status, "completed");
      assert.ok(taskResult.summary);
      assert.ok(Array.isArray(taskResult.artifacts));
      assert.ok(Array.isArray(taskResult.verification));
      assert.equal(taskResult.final_response, undefined, "Must not leak final_response in compact result");
      assert.equal(taskResult.attempts, undefined, "Must not leak attempts array in compact result");
    }
  } finally {
    await transport2.close().catch(() => {});
    await client2.close().catch(() => {});
  }
});

test("E2E 2: Fast batch completes within initial wait_seconds and returns final aggregation directly without needing wait", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-e2e-fast-batch-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const res = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 10,
        tasks: [
          { id: "fast-a", goal: "Fast task A", access: "read_only" },
          { id: "fast-b", goal: "Fast task B", access: "read_only" },
        ],
      },
    });

    let structured = res.structuredContent;
    assert.ok(structured, "Response must include structuredContent");
    assert.ok(structured.group_id, "Response must include group_id");
    assert.equal(structured.total_tasks, 2);

    if (!GROUP_TERMINAL_SET.has(structured.status)) {
      assert.equal(structured.tasks, undefined, "Running status must omit tasks array");
      structured = await waitForGroupTerminal(client, structured.group_id);
    }
    assert.equal(structured.status, "completed", "Batch must reach completed status");
    assert.equal(structured.total_tasks, 2);
    assert.equal(structured.completed_tasks, 2);
    assert.equal(structured.failed_tasks ?? 0, 0);
    assert.equal(structured.cancelled_tasks ?? 0, 0);
    assert.equal(structured.blocked_tasks ?? 0, 0);
    assert.ok(Array.isArray(structured.tasks), "Completed group must return aggregated tasks array");
    assert.equal(structured.tasks.length, 2);
    assert.equal(structured.tasks[0].id, "fast-a");
    assert.equal(structured.tasks[1].id, "fast-b");
    for (const taskResult of structured.tasks) {
      assert.equal(taskResult.status, "completed");
      assert.ok(taskResult.summary);
      assert.ok(Array.isArray(taskResult.artifacts));
      assert.ok(Array.isArray(taskResult.verification));
    }

    // Deterministically verify zero-wait terminal group formatting
    const zeroWaitGroup = await client.callTool({
      name: "omp_wait_group",
      arguments: { group_id: structured.group_id, wait_seconds: 0 },
    });
    assert.equal(zeroWaitGroup.structuredContent?.status, "completed");
    assert.equal(zeroWaitGroup.structuredContent?.tasks?.length, 2);
  } finally {
    await client.close();
  }
});

test("E2E 3: Partial failure blocks dependent tasks while independent siblings finish, yielding partial status", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-e2e-partial-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const res = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 10,
        tasks: [
          { id: "failing-step", goal: "Step that fails FAIL_TEST", access: "read_only" },
          { id: "blocked-step", goal: "Step depending on fail", depends_on: ["failing-step"], access: "read_only" },
          { id: "independent-step", goal: "Independent step", access: "read_only" },
        ],
      },
    });

    let structured = res.structuredContent;
    assert.ok(structured);
    if (!GROUP_TERMINAL_SET.has(structured.status)) {
      assert.equal(structured.tasks, undefined, "Running status must omit tasks array");
      structured = await waitForGroupTerminal(client, structured.group_id);
    }
    assert.equal(structured.status, "partial", "Group with failed dependency should be partial");
    assert.equal(structured.total_tasks, 3);
    assert.equal(structured.completed_tasks, 1);
    assert.equal(structured.failed_tasks, 1);
    assert.equal(structured.blocked_tasks, 1);

    assert.ok(Array.isArray(structured.tasks));
    assert.equal(structured.tasks.length, 3);
    assert.equal(structured.tasks[0].id, "failing-step");
    assert.equal(structured.tasks[0].status, "failed");
    assert.equal(structured.tasks[1].id, "blocked-step");
    assert.equal(structured.tasks[1].status, "blocked");
    assert.equal(structured.tasks[2].id, "independent-step");
    assert.equal(structured.tasks[2].status, "completed");
  } finally {
    await client.close();
  }
});

test("E2E 4: Concurrency cap is strictly enforced across batch execution", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-e2e-concurrency-"));
  const trackerDir = path.join(stateRoot, "concurrency-track");
  await mkdir(trackerDir, { recursive: true });

  const { client } = await createTestClient(stateRoot);
  try {
    const res = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        max_parallel: 2,
        wait_seconds: 15,
        tasks: [
          { id: "t1", goal: `T1 DELAY_TEST_500 TRACK_CONCURRENCY:${trackerDir}`, access: "read_only" },
          { id: "t2", goal: `T2 DELAY_TEST_500 TRACK_CONCURRENCY:${trackerDir}`, access: "read_only" },
          { id: "t3", goal: `T3 DELAY_TEST_500 TRACK_CONCURRENCY:${trackerDir}`, access: "read_only" },
          { id: "t4", goal: `T4 DELAY_TEST_500 TRACK_CONCURRENCY:${trackerDir}`, access: "read_only" },
        ],
      },
    });

    let structured = res.structuredContent;
    assert.ok(structured);
    if (!GROUP_TERMINAL_SET.has(structured.status)) {
      assert.equal(structured.tasks, undefined, "Running status must omit tasks array");
      structured = await waitForGroupTerminal(client, structured.group_id);
    }
    assert.equal(structured?.status, "completed");
    assert.equal(structured?.completed_tasks, 4);

    const { peak, total } = await readPeakConcurrency(trackerDir);
    assert.equal(total, 4);
    assert.ok(peak <= 2, `Peak concurrency should not exceed max_parallel (2), got ${peak}`);
    assert.ok(peak >= 1, `Peak concurrency should be at least 1, got ${peak}`);
  } finally {
    await client.close();
  }
});

test("E2E 5: Group cancellation stops active tasks and marks pending/group cancelled", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-e2e-cancel-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const startRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 1,
        tasks: [
          { id: "cancel-step-1", goal: "Step 1 DELAY_TEST_4000", access: "read_only" },
          { id: "cancel-step-2", goal: "Step 2 DELAY_TEST_4000", depends_on: ["cancel-step-1"], access: "read_only" },
        ],
      },
    });

    const groupId = startRes.structuredContent?.group_id;
    assert.ok(groupId);

    const cancelRes = await client.callTool({
      name: "omp_cancel_group",
      arguments: {
        group_id: groupId,
        reason: "E2E cancel test",
      },
    });
    assert.ok(cancelRes.structuredContent);

    const structured = await waitForGroupTerminal(client, groupId);
    assert.equal(structured.status, "cancelled");
  } finally {
    await client.close();
  }
});

test("E2E 6: Single-task tools regression (run_compact, delegate, wait, continue, result, cancel)", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-e2e-single-regress-"));
  const { client } = await createTestClient(stateRoot);
  try {
    // 1. omp_run_compact fast completion
    const compactFast = await client.callTool({
      name: "omp_run_compact",
      arguments: {
        goal: "Fast single task",
        cwd: stateRoot,
        wait_seconds: 10,
      },
    });
    let fastStructured = compactFast.structuredContent;
    assert.ok(fastStructured?.job_id);
    if (!JOB_TERMINAL_SET.has(fastStructured.status)) {
      assert.equal("final_response" in fastStructured, false);
      fastStructured = await waitForJobTerminal(client, fastStructured.job_id);
    }
    assert.equal(fastStructured.status, "completed");

    const immediateWaitFast = await client.callTool({
      name: "omp_wait",
      arguments: { job_id: fastStructured.job_id, wait_seconds: 1 },
    });
    assert.equal(immediateWaitFast.structuredContent?.status, "completed");
    assert.equal("final_response" in immediateWaitFast.structuredContent, false);

    // 2. omp_run_compact timeout -> running
    const compactSlow = await client.callTool({
      name: "omp_run_compact",
      arguments: {
        goal: "Slow single task DELAY_TEST_2500",
        cwd: stateRoot,
        wait_seconds: 1,
      },
    });
    assert.equal(compactSlow.structuredContent?.status, "running");
    const slowJobId = compactSlow.structuredContent?.job_id;
    assert.ok(slowJobId);

    // 3. omp_wait on slow job
    const waitSlow = await waitForJobTerminal(client, slowJobId);
    assert.equal(waitSlow.status, "completed");

    // 4. omp_continue on slow job
    const contRes = await client.callTool({
      name: "omp_continue",
      arguments: {
        job_id: slowJobId,
        feedback: "Please refine",
      },
    });
    assert.ok(["queued", "running"].includes(contRes.structuredContent?.status));

    // 5. omp_wait after continue
    const waitCont = await waitForJobTerminal(client, slowJobId);
    assert.equal(waitCont.status, "completed");
    assert.equal(waitCont.summary, "Corrected result");

    // 6. omp_result allows reading full attempts
    const resultRes = await client.callTool({
      name: "omp_result",
      arguments: {
        job_id: slowJobId,
      },
    });
    assert.equal(resultRes.structuredContent?.job_id, slowJobId);
    assert.equal(resultRes.structuredContent?.attempts?.length, 2);

    // 7. omp_delegate + omp_cancel
    const delRes = await client.callTool({
      name: "omp_delegate",
      arguments: {
        goal: "Delegated task to cancel DELAY_TEST_5000",
        cwd: stateRoot,
      },
    });
    const cancelJobId = delRes.structuredContent?.job_id;
    assert.ok(cancelJobId);

    const cancelJobRes = await client.callTool({
      name: "omp_cancel",
      arguments: {
        job_id: cancelJobId,
        reason: "Single task cancel test",
      },
    });
    assert.ok(["cancelling", "cancelled"].includes(cancelJobRes.structuredContent?.status));
    const cancelledTerminal =
      cancelJobRes.structuredContent?.status === "cancelled"
        ? cancelJobRes.structuredContent
        : await waitForJobTerminal(client, cancelJobId);
    assert.equal(cancelledTerminal.status, "cancelled");
  } finally {
    await client.close();
  }
});
