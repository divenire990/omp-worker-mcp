import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("runner captures OMP session and structured result", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-test-"));
  const id = "job-1000000000000-abcdef12";
  const directory = path.join(root, "jobs", id);
  await mkdir(directory, { recursive: true });
  const promptPath = path.join(directory, "attempt-01.prompt.md");
  await writeFile(promptPath, "fake prompt", "utf8");
  const now = new Date().toISOString();
  const job = {
    version: 1,
    id,
    status: "queued",
    goal: "fake goal",
    cwd: root,
    acceptance: ["fake acceptance"],
    maxAttempts: 3,
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
      OMP_WORKER_STATE_DIR: root,
      OMP_WORKER_OMP_COMMAND: process.execPath,
      OMP_WORKER_OMP_PREFIX_ARGS: JSON.stringify([path.join(projectRoot, "tests", "fake-omp.mjs")]),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const completed = JSON.parse(await readFile(jobFile, "utf8"));
  assert.equal(completed.status, "completed");
  assert.equal(completed.sessionId, "fake-session-001");
  assert.equal(completed.summary, "Initial result");
  assert.deepEqual(completed.verification, ["fake check passed"]);
  assert.equal(completed.attempts[0].exitCode, 0);
});
