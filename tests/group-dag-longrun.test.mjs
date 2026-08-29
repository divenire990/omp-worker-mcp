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
  const client = new Client({ name: "omp-worker-longrun-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

async function waitForGroupStatus(groupJsonPath, expectedStatus, timeoutMs = 15000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let lastRecord;

  while (Date.now() < deadline) {
    try {
      lastRecord = JSON.parse(await readFile(groupJsonPath, "utf8"));
      if (lastRecord.status === expectedStatus) return lastRecord;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Expected group to reach ${expectedStatus} within ${timeoutMs}ms, got ${lastRecord?.status ?? "missing"}`,
  );
}

// 缺陷 1：批任务初始有限等待应在未完成时迅速返回 running + group_id，而不是无限阻塞直到全部完成
test("Red Test 1: omp_run_batch_compact with limited wait_seconds returns running status and group_id when batch is still executing", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-red-1-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const startTime = Date.now();
    const result = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 1,
        tasks: [
          {
            id: "task-long-1",
            goal: "First long task DELAY_TEST_3000",
            access: "read_only",
          },
          {
            id: "task-long-2",
            goal: "Second long task DELAY_TEST_3000",
            access: "read_only",
          },
        ],
      },
    });

    const elapsed = Date.now() - startTime;
    assert.ok(elapsed < 2500, `Expected call to return within ~1-2s wait_seconds, but took ${elapsed}ms`);

    const structured = result.structuredContent;
    assert.ok(structured, "Expected structuredContent in response");
    assert.equal(structured.status, "running", "Expected status to be 'running' on initial limited wait");
    assert.match(structured.group_id, /^group-[0-9]+-[a-f0-9]{8}$/, "Expected valid group_id");
    assert.equal(structured.total_tasks, 2, "Expected total_tasks to be 2");
    assert.equal(structured.completed_tasks, 0, "Expected completed_tasks to be 0");
  } finally {
    await client.close();
  }
});

// 缺陷 2：客户端关闭后组协调器及后续多级 DAG 任务应在后台继续执行，不因客户端关闭/断开而中断
test("Red Test 2: Group coordinator and subsequent DAG tasks continue running in background after client closes connection", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-red-2-"));
  const { client, transport } = await createTestClient(stateRoot);

  let callPromise;
  try {
    // 发起包含 3 级依赖链的批任务，总耗时 > 4.5 秒
    callPromise = client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 1,
        tasks: [
          {
            id: "step-1",
            goal: "Step 1 DELAY_TEST_1500",
            access: "read_only",
          },
          {
            id: "step-2",
            goal: "Step 2 DELAY_TEST_1500",
            depends_on: ["step-1"],
            access: "read_only",
          },
          {
            id: "step-3",
            goal: "Step 3 DELAY_TEST_1500",
            depends_on: ["step-2"],
            access: "read_only",
          },
        ],
      },
    });

    // 允许调用发送到服务器并创建 group 目录
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    // 模拟客户端超时或异常强制关闭连接及传输层
    await transport.close().catch(() => {});
    await client.close().catch(() => {});
  }

  // 此时 MCP 服务器进程已随着 transport.close 被销毁。
  // 如果没有独立的 detached group coordinator，step-2 / step-3 永远不会完成。
  // 不使用固定 sleep：Windows hosted runner 的进程调度可能明显慢于 Linux/macOS，
  // 因此在有界时间内轮询持久化状态，仍严格要求最终达到 completed。
  const groupsDir = path.join(stateRoot, "groups");
  const { readdir } = await import("node:fs/promises");
  const groupDirs = await readdir(groupsDir).catch(() => []);
  assert.ok(groupDirs.length > 0, "Expected a group directory to be created");
  const groupId = groupDirs[0];

  const groupJsonPath = path.join(groupsDir, groupId, "group.json");
  const groupRecord = await waitForGroupStatus(groupJsonPath, "completed");

  const step3 = groupRecord.tasks.find((t) => t.id === "step-3");
  assert.equal(step3?.status, "completed", "Expected dependent step-3 to be scheduled and completed in background");
});

// 缺陷 3：正式 group wait 工具（omp_wait_group）可在新客户端连接后取到终态聚合结果
test("Red Test 3: omp_wait_group allows a new disconnected MCP client to wait for and retrieve final aggregated result", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-red-3-"));
  
  // 客户端 1：发起批任务
  const { client: client1 } = await createTestClient(stateRoot);
  let groupId;
  try {
    const result = await client1.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 1,
        tasks: [
          {
            id: "t1",
            goal: "Task 1 DELAY_TEST_1500",
            access: "read_only",
          },
          {
            id: "t2",
            goal: "Task 2 DELAY_TEST_1500",
            access: "read_only",
          },
        ],
      },
    });
    groupId = result.structuredContent?.group_id;
  } finally {
    await client1.close();
  }

  assert.ok(groupId, "Expected valid group_id from submission");

  // 客户端 2：全新客户端连接，调用正式 group wait 工具等待完成
  const { client: client2 } = await createTestClient(stateRoot);
  try {
    const waitResult = await client2.callTool({
      name: "omp_wait_group",
      arguments: {
        group_id: groupId,
        wait_seconds: 10,
      },
    });

    const structured = waitResult.structuredContent;
    assert.ok(structured, "Expected structuredContent in omp_wait_group response");
    assert.equal(structured.status, "completed", "Expected group to reach completed status");
    assert.equal(structured.total_tasks, 2, "Expected 2 total tasks");
    assert.equal(structured.completed_tasks, 2, "Expected 2 completed tasks");
    assert.ok(Array.isArray(structured.tasks), "Expected aggregated tasks array");
    assert.equal(structured.tasks.length, 2, "Expected 2 task results in input order");
    assert.equal(structured.tasks[0].id, "t1");
    assert.equal(structured.tasks[1].id, "t2");
  } finally {
    await client2.close();
  }
});

// 缺陷 4：运行态响应为极简进度，不泄露 task summaries 数组，防止 context 膨胀
test("Red Test 4: Running status response provides minimal group progress without leaking task summaries array", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-red-4-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const result = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 1,
        tasks: [
          {
            id: "t-secret-1",
            goal: "Secret goal DELAY_TEST_3000",
            access: "read_only",
          },
        ],
      },
    });

    const structured = result.structuredContent;
    assert.ok(structured, "Expected structuredContent");
    assert.equal(structured.status, "running", "Expected running status");

    // 运行态必须是极简进度，不应包含完整的 tasks 数组或任务 summaries，避免上下文膨胀
    assert.equal(
      structured.tasks,
      undefined,
      "Expected running status to omit tasks array or task summaries",
    );
    assert.ok(typeof structured.total_tasks === "number", "Expected minimal total_tasks field");
  } finally {
    await client.close();
  }
});

test("Red Test 5: omp_cancel_group requests cancellation for a running group and marks it cancelled", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-red-5-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const runRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 1,
        tasks: [
          {
            id: "cancel-task-1",
            goal: "Task to be cancelled DELAY_TEST_5000",
            access: "read_only",
          },
        ],
      },
    });

    const groupId = runRes.structuredContent?.group_id;
    assert.ok(groupId, "Expected valid group_id");

    const cancelRes = await client.callTool({
      name: "omp_cancel_group",
      arguments: {
        group_id: groupId,
        reason: "User requested group cancellation test",
      },
    });

    const cancelStruct = cancelRes.structuredContent;
    assert.ok(cancelStruct, "Expected structuredContent from cancel tool");
    assert.equal(cancelStruct.group_id, groupId);
    assert.ok(["cancelling", "cancelled"].includes(cancelStruct.status), `Expected cancelling/cancelled status, got ${cancelStruct.status}`);

    // 等待取消流程完成
    const waitRes = await client.callTool({
      name: "omp_wait_group",
      arguments: {
        group_id: groupId,
        wait_seconds: 10,
      },
    });

    const waitStruct = waitRes.structuredContent;
    assert.equal(waitStruct.status, "cancelled", "Expected group to be cancelled");
    assert.equal(waitStruct.cancelled_tasks, 1, "Expected cancelled_tasks = 1");
  } finally {
    await client.close();
  }
});

test("Red Test 6: omp_wait_group returns running status and minimal progress without leaking tasks array when group is running", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-red-6-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const runRes = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 0,
        tasks: [
          {
            id: "slow-t1",
            goal: "Slow task DELAY_TEST_4000",
            access: "read_only",
          },
        ],
      },
    });
    const groupId = runRes.structuredContent?.group_id;
    assert.ok(groupId);

    const waitRes = await client.callTool({
      name: "omp_wait_group",
      arguments: {
        group_id: groupId,
        wait_seconds: 1,
      },
    });

    const structured = waitRes.structuredContent;
    assert.equal(structured.status, "running");
    assert.equal(structured.group_id, groupId);
    assert.equal(structured.tasks, undefined, "Expected tasks array omitted on running status");
    assert.equal(structured.total_tasks, 1);
  } finally {
    await client.close();
  }
});

test("Red Test 7: Schema bounds for wait_seconds reject values > 240 or < 0", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-red-7-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const runOver = await client.callTool({
      name: "omp_run_batch_compact",
      arguments: {
        cwd: stateRoot,
        wait_seconds: 241,
        tasks: [{ id: "t1", goal: "task goal", access: "read_only" }],
      },
    });
    assert.equal(runOver.isError, true);
    assert.match(runOver.content?.[0]?.text || "", /wait_seconds|Invalid/i);

    const waitOver = await client.callTool({
      name: "omp_wait_group",
      arguments: {
        group_id: "group-1234567890-abcdef12",
        wait_seconds: 300,
      },
    });
    assert.equal(waitOver.isError, true);
    assert.match(waitOver.content?.[0]?.text || "", /wait_seconds|Invalid/i);
  } finally {
    await client.close();
  }
});
