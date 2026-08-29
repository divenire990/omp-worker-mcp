import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
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
  const client = new Client({ name: "omp-worker-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

const TEST_TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked",
  "awaiting_review",
]);

async function waitForTerminal(client, jobId, { allowAwaitingReview = false } = {}) {
  for (let index = 0; index < 40; index += 1) {
    const result = await client.callTool({
      name: "omp_wait",
      arguments: { job_id: jobId, wait_seconds: 1 },
    });
    const structured = result.structuredContent;
    if (TEST_TERMINAL_STATUSES.has(structured?.status)) {
      if (structured.status === "awaiting_review" && !allowAwaitingReview) {
        throw new Error(
          `Fake OMP task reached unexpected terminal state 'awaiting_review' (envelope missing or unparsed). error=${structured.error || "none"}, details_path=${structured.details_path || "none"}`
        );
      }
      return structured;
    }
  }
  throw new Error(`Fake OMP task did not reach a terminal state for job ${jobId}`);
}

test("MCP exposes all nine tools including omp_run_batch_compact, omp_wait_group, omp_cancel_group", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-mcp-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), [
      "omp_cancel",
      "omp_cancel_group",
      "omp_continue",
      "omp_delegate",
      "omp_result",
      "omp_run_batch_compact",
      "omp_run_compact",
      "omp_wait",
      "omp_wait_group",
    ]);
  } finally {
    await client.close();
  }
});

test("omp_run_compact completes within wait_seconds and returns compact summary without leaking final_response", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-mcp-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const runResult = await client.callTool({
      name: "omp_run_compact",
      arguments: {
        goal: "Run compact end-to-end task",
        cwd: projectRoot,
        acceptance: ["Complete within single call"],
        supervisor_brief: "Verified: fast run",
        timeout_minutes: 5,
        max_attempts: 3,
        wait_seconds: 10,
      },
    });

    const structured = runResult.structuredContent;
    assert.ok(structured, "structuredContent must be returned");
    assert.equal(typeof structured.job_id, "string");
    assert.equal(structured.status, "completed");
    assert.equal(structured.attempt, 1);
    assert.equal(structured.max_attempts, 3);
    assert.equal(structured.session_id, "fake-session-001");
    assert.equal(structured.summary, "Initial result");
    assert.deepEqual(structured.artifacts, [{ path: "result.txt", description: "Fake integration artifact" }]);
    assert.deepEqual(structured.verification, ["fake check passed"]);
    assert.deepEqual(structured.remaining, []);
    assert.equal(typeof structured.details_path, "string");

    // Strictly assert NO final_response or attempts array leaked in compact output
    assert.equal("final_response" in structured, false);
    assert.equal("attempts" in structured, false);

    // Verify details_path points to readable on-disk job file
    const storedJob = JSON.parse(await readFile(structured.details_path, "utf8"));
    assert.equal(storedJob.id, structured.job_id);
    assert.equal(storedJob.status, "completed");
    assert.match(storedJob.finalResponse, /Fake worker finished/);
  } finally {
    await client.close();
  }
});

test("omp_run_compact returns running status and job_id on timeout without leaking final_response", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-mcp-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const slowRun = await client.callTool({
      name: "omp_run_compact",
      arguments: {
        goal: "Slow task SLOW_TEST",
        cwd: projectRoot,
        acceptance: ["Wait 1s then return running"],
        supervisor_brief: "Slow execution test SLOW_TEST",
        timeout_minutes: 5,
        max_attempts: 3,
        wait_seconds: 1,
      },
    });

    const structured = slowRun.structuredContent;
    assert.ok(structured, "structuredContent must be returned");
    assert.equal(typeof structured.job_id, "string");
    assert.equal(structured.status, "running");
    assert.equal("final_response" in structured, false);
    assert.equal("attempts" in structured, false);
    assert.equal(structured.details_path, undefined);

    // Can subsequently cancel the running job
    const cancelRes = await client.callTool({
      name: "omp_cancel",
      arguments: { job_id: structured.job_id, reason: "Cancel slow test" },
    });
    const cancelled =
      cancelRes.structuredContent?.status === "cancelled"
        ? cancelRes.structuredContent
        : await waitForTerminal(client, structured.job_id);
    assert.equal(cancelled.status, "cancelled");
  } finally {
    await client.close();
  }
});

test("omp_run_compact and omp_delegate validate working directory identically", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-mcp-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const nonExistentPath = path.join(projectRoot, "non-existent-directory-xyz-123");

    const compactRes = await client.callTool({
      name: "omp_run_compact",
      arguments: {
        goal: "Invalid cwd test",
        cwd: nonExistentPath,
      },
    });
    assert.equal(compactRes.isError, true);
    assert.match(compactRes.content?.[0]?.text || "", /cwd does not exist/);

    const delegateRes = await client.callTool({
      name: "omp_delegate",
      arguments: {
        goal: "Invalid cwd test",
        cwd: nonExistentPath,
      },
    });
    assert.equal(delegateRes.isError, true);
    assert.match(delegateRes.content?.[0]?.text || "", /cwd does not exist/);
  } finally {
    await client.close();
  }
});

test("Existing low-level tools (delegate, wait, result, continue, cancel) regress cleanly", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-mcp-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    // 1. Delegate
    const delegateRes = await client.callTool({
      name: "omp_delegate",
      arguments: {
        goal: "Low level task test",
        cwd: projectRoot,
      },
    });
    const jobId = delegateRes.structuredContent.job_id;
    assert.ok(jobId);

    // 2. Wait
    const terminal = await waitForTerminal(client, jobId);
    assert.equal(terminal.status, "completed");

    // 3. Result
    const resultRes = await client.callTool({
      name: "omp_result",
      arguments: { job_id: jobId },
    });
    const fullResult = resultRes.structuredContent;
    assert.equal(fullResult.job_id, jobId);
    assert.ok(fullResult.final_response);
    assert.equal(fullResult.attempts.length, 1);

    // 4. Continue
    const continueRes = await client.callTool({
      name: "omp_continue",
      arguments: {
        job_id: jobId,
        feedback: "Please adjust the result slightly",
      },
    });
    assert.equal(continueRes.structuredContent.attempt, 2);
    const contTerminal = await waitForTerminal(client, jobId);
    assert.equal(contTerminal.status, "completed");
    assert.equal(contTerminal.summary, "Corrected result");

    // 5. Cancel test on a slow job
    const slowDelegate = await client.callTool({
      name: "omp_delegate",
      arguments: {
        goal: "SLOW_TEST slow task for cancel test",
        cwd: projectRoot,
      },
    });
    const slowJobId = slowDelegate.structuredContent.job_id;
    const cancelRes = await client.callTool({
      name: "omp_cancel",
      arguments: { job_id: slowJobId, reason: "Test cancellation" },
    });
    assert.ok(cancelRes.structuredContent);
    const cancelTerminal = await waitForTerminal(client, slowJobId);
    assert.equal(cancelTerminal.status, "cancelled");
  } finally {
    await client.close();
  }
});

test("Fast fake OMP structured output completes with parsed envelope and does not become awaiting_review", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-mcp-test-"));
  const { client } = await createTestClient(stateRoot);
  try {
    const delegateRes = await client.callTool({
      name: "omp_delegate",
      arguments: {
        goal: "Fast completion structured envelope regression test",
        cwd: projectRoot,
      },
    });
    const jobId = delegateRes.structuredContent.job_id;
    assert.ok(jobId);

    const terminal = await waitForTerminal(client, jobId);
    assert.equal(terminal.status, "completed");
    assert.notEqual(terminal.status, "awaiting_review");
    assert.equal(terminal.summary, "Initial result");
    assert.deepEqual(terminal.artifacts, [{ path: "result.txt", description: "Fake integration artifact" }]);
    assert.deepEqual(terminal.verification, ["fake check passed"]);
    assert.deepEqual(terminal.remaining, []);

    const resultRes = await client.callTool({
      name: "omp_result",
      arguments: { job_id: jobId },
    });
    const fullResult = resultRes.structuredContent;
    assert.equal(fullResult.job_id, jobId);
    assert.equal(fullResult.status, "completed");
    assert.notEqual(fullResult.status, "awaiting_review");
    assert.ok(fullResult.final_response);
    assert.match(fullResult.final_response, /OMP_WORKER_RESULT/);
    assert.equal(fullResult.attempts.length, 1);
    assert.equal(fullResult.attempts[0].exit_code, 0);
  } finally {
    await client.close();
  }
});
