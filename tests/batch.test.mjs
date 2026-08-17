import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  const client = new Client({ name: "omp-worker-batch-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

test("1. 3 independent tasks run concurrently with peak <= max_parallel", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-batch-test-"));
  const trackerFile = path.join(stateRoot, "concurrency-track.json");
  await writeFile(trackerFile, JSON.stringify({ current: 0, peak: 0 }), "utf8");

  const { client } = await createTestClient(stateRoot);
  try {
    const result = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        max_parallel: 3,
        tasks: [
          {
            id: "task-1",
            goal: `DELAY_TEST_1000 TRACK_CONCURRENCY:${trackerFile} Task 1 work`,
            access: "read_only",
          },
          {
            id: "task-2",
            goal: `DELAY_TEST_1000 TRACK_CONCURRENCY:${trackerFile} Task 2 work`,
            access: "read_only",
          },
          {
            id: "task-3",
            goal: `DELAY_TEST_1000 TRACK_CONCURRENCY:${trackerFile} Task 3 work`,
            access: "read_only",
          },
        ],
      },
    });

    const structured = result.structuredContent;
    assert.equal(structured.status, "completed");
    assert.equal(structured.total_tasks, 3);
    assert.equal(structured.completed_tasks, 3);
    assert.equal(structured.tasks.length, 3);
    assert.equal(structured.tasks[0].id, "task-1");
    assert.equal(structured.tasks[1].id, "task-2");
    assert.equal(structured.tasks[2].id, "task-3");

    const track = JSON.parse(await readFile(trackerFile, "utf8"));
    assert.ok(track.peak >= 2, `Expected concurrent execution (peak >= 2), got peak=${track.peak}`);
    assert.ok(track.peak <= 3, `Expected peak <= max_parallel (3), got peak=${track.peak}`);
  } finally {
    await client.close();
  }
});

test("2. max_parallel > 10 or < 1 is rejected by schema validation", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-batch-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const resOver = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        max_parallel: 11,
        tasks: [{ id: "t1", goal: "do work" }],
      },
    });
    assert.equal(resOver.isError, true);
    assert.match(resOver.content?.[0]?.text || "", /max_parallel|Invalid/i);

    const resUnder = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        max_parallel: 0,
        tasks: [{ id: "t1", goal: "do work" }],
      },
    });
    assert.equal(resUnder.isError, true);
    assert.match(resUnder.content?.[0]?.text || "", /max_parallel|Invalid/i);
  } finally {
    await client.close();
  }
});

test("3. Rolling pool handles >10 tasks with bounded max_parallel", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-batch-test-"));
  const trackerFile = path.join(stateRoot, "concurrency-12.json");
  await writeFile(trackerFile, JSON.stringify({ current: 0, peak: 0 }), "utf8");

  const { client } = await createTestClient(stateRoot);
  try {
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      id: `task-${String(i + 1).padStart(2, "0")}`,
      goal: `DELAY_TEST_50 TRACK_CONCURRENCY:${trackerFile} Task ${i + 1} work`,
      access: "read_only",
    }));

    const result = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        max_parallel: 3,
        tasks,
      },
    });

    const structured = result.structuredContent;
    assert.equal(structured.status, "completed");
    assert.equal(structured.total_tasks, 12);
    assert.equal(structured.completed_tasks, 12);
    assert.equal(structured.tasks.length, 12);

    for (let i = 0; i < 12; i++) {
      assert.equal(structured.tasks[i].id, tasks[i].id);
      assert.equal(structured.tasks[i].status, "completed");
    }

    const track = JSON.parse(await readFile(trackerFile, "utf8"));
    assert.ok(track.peak <= 3, `Expected peak concurrency <= 3, got peak=${track.peak}`);
  } finally {
    await client.close();
  }
});

test("4. DAG ready waves execute in strict dependency order", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-batch-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const result = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        max_parallel: 4,
        tasks: [
          { id: "task-3", goal: "Wave 3 goal", depends_on: ["task-2"] },
          { id: "task-1", goal: "Wave 1 goal" },
          { id: "task-2", goal: "Wave 2 goal", depends_on: ["task-1"] },
        ],
      },
    });

    const structured = result.structuredContent;
    assert.equal(structured.status, "completed");
    assert.equal(structured.total_tasks, 3);
    assert.equal(structured.completed_tasks, 3);

    // Results preserve input order: task-3, task-1, task-2
    assert.equal(structured.tasks[0].id, "task-3");
    assert.equal(structured.tasks[1].id, "task-1");
    assert.equal(structured.tasks[2].id, "task-2");

    // All reached completed
    assert.equal(structured.tasks[0].status, "completed");
    assert.equal(structured.tasks[1].status, "completed");
    assert.equal(structured.tasks[2].status, "completed");
  } finally {
    await client.close();
  }
});

test("5. DAG validation rejects duplicate ID, unknown dependency, and cycles", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-batch-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    // Duplicate ID
    const dupRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        tasks: [
          { id: "dup", goal: "g1" },
          { id: "dup", goal: "g2" },
        ],
      },
    });
    assert.equal(dupRes.isError, true);
    assert.match(dupRes.content?.[0]?.text || "", /Duplicate task id/i);

    // Unknown dependency
    const unkRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        tasks: [{ id: "t1", goal: "g1", depends_on: ["nonexistent"] }],
      },
    });
    assert.equal(unkRes.isError, true);
    assert.match(unkRes.content?.[0]?.text || "", /unknown task/i);

    // Self dependency
    const selfRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        tasks: [{ id: "t1", goal: "g1", depends_on: ["t1"] }],
      },
    });
    assert.equal(selfRes.isError, true);
    assert.match(selfRes.content?.[0]?.text || "", /cannot depend on itself/i);

    // Cycle A -> B -> A
    const cycleRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        tasks: [
          { id: "A", goal: "gA", depends_on: ["B"] },
          { id: "B", goal: "gB", depends_on: ["A"] },
        ],
      },
    });
    assert.equal(cycleRes.isError, true);
    assert.match(cycleRes.content?.[0]?.text || "", /Cyclic dependency/i);
  } finally {
    await client.close();
  }
});

test("6. Write ownership overlap is rejected when concurrent, permitted when ordered by depends_on", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-batch-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    // Missing ownership on write task
    const emptyOwnerRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        tasks: [{ id: "w1", goal: "write work", access: "write", ownership: [] }],
      },
    });
    assert.equal(emptyOwnerRes.isError, true);
    assert.match(emptyOwnerRes.content?.[0]?.text || "", /must declare non-empty ownership/i);

    // Concurrent write ownership conflict (same file)
    const sameFileRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        tasks: [
          { id: "w1", goal: "write A", access: "write", ownership: ["src/index.ts"] },
          { id: "w2", goal: "write B", access: "write", ownership: ["src/index.ts"] },
        ],
      },
    });
    assert.equal(sameFileRes.isError, true);
    assert.match(sameFileRes.content?.[0]?.text || "", /Concurrent write ownership conflict/i);

    // Concurrent write ownership conflict (parent/child directory overlap)
    const dirOverlapRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        tasks: [
          { id: "w1", goal: "write dir", access: "write", ownership: ["src"] },
          { id: "w2", goal: "write file", access: "write", ownership: ["src/types.ts"] },
        ],
      },
    });
    assert.equal(dirOverlapRes.isError, true);
    assert.match(dirOverlapRes.content?.[0]?.text || "", /Concurrent write ownership conflict/i);

    // Permitted when ordered with depends_on
    const orderedRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        tasks: [
          { id: "w1", goal: "step 1", access: "write", ownership: ["src/index.ts"] },
          { id: "w2", goal: "step 2", access: "write", ownership: ["src/index.ts"], depends_on: ["w1"] },
        ],
      },
    });
    assert.equal(orderedRes.isError, undefined);
    assert.equal(orderedRes.structuredContent.status, "completed");
  } finally {
    await client.close();
  }
});

test("7. Partial failure marks dependent tasks blocked while independent siblings finish", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-batch-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const result = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        max_parallel: 3,
        tasks: [
          { id: "task-fail", goal: "FAIL_TEST this task" },
          { id: "task-dep", goal: "Depends on fail", depends_on: ["task-fail"] },
          { id: "task-ok", goal: "Independent success" },
        ],
      },
    });

    const structured = result.structuredContent;
    assert.equal(structured.status, "partial");
    assert.equal(structured.total_tasks, 3);
    assert.equal(structured.completed_tasks, 1);
    assert.equal(structured.failed_tasks, 1);
    assert.equal(structured.blocked_tasks, 1);

    const taskFail = structured.tasks.find((t) => t.id === "task-fail");
    const taskDep = structured.tasks.find((t) => t.id === "task-dep");
    const taskOk = structured.tasks.find((t) => t.id === "task-ok");

    assert.equal(taskFail.status, "failed");
    assert.equal(taskDep.status, "blocked");
    assert.match(taskDep.error, /Dependency failed/i);
    assert.equal(taskOk.status, "completed");
  } finally {
    await client.close();
  }
});

test("8. Aggregated results preserve stable input order and omit final_response / attempts", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-batch-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const result = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        tasks: [
          { id: "z-last", goal: "Task Z" },
          { id: "a-first", goal: "Task A" },
          { id: "m-mid", goal: "Task M" },
        ],
      },
    });

    const structured = result.structuredContent;
    assert.equal(structured.tasks[0].id, "z-last");
    assert.equal(structured.tasks[1].id, "a-first");
    assert.equal(structured.tasks[2].id, "m-mid");

    for (const t of structured.tasks) {
      assert.equal("final_response" in t, false);
      assert.equal("finalResponse" in t, false);
      assert.equal("attempts" in t, false);
      assert.ok(t.summary);
      assert.ok(Array.isArray(t.artifacts));
      assert.ok(Array.isArray(t.verification));
      assert.ok(Array.isArray(t.remaining));
      assert.ok(t.details_path);
    }
  } finally {
    await client.close();
  }
});

test("9. Group timeout validation rejects invalid range", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-batch-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const underRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        group_timeout_minutes: 0,
        tasks: [{ id: "t1", goal: "g1" }],
      },
    });
    assert.equal(underRes.isError, true);
    assert.match(underRes.content?.[0]?.text || "", /group_timeout_minutes|Invalid/i);

    const overRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: projectRoot,
        group_timeout_minutes: 121,
        tasks: [{ id: "t1", goal: "g1" }],
      },
    });
    assert.equal(overRes.isError, true);
    assert.match(overRes.content?.[0]?.text || "", /group_timeout_minutes|Invalid/i);
  } finally {
    await client.close();
  }
});
