import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
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

test("runner deterministically captures fast child output and exit during delayed ompPid metadata write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-race-test-"));
  const id = "job-1000000000001-abcdef01";
  const directory = path.join(root, "jobs", id);
  await mkdir(directory, { recursive: true });
  const promptPath = path.join(directory, "attempt-01.prompt.md");
  await writeFile(promptPath, "fake prompt", "utf8");
  const now = new Date().toISOString();
  const job = {
    version: 1,
    id,
    status: "queued",
    goal: "deterministic fast exit during metadata write",
    cwd: root,
    acceptance: ["must not lose child close or stdout"],
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

  const runnerUrl = pathToFileURL(path.join(projectRoot, "dist", "runner.js")).href;
  const jobStoreUrl = pathToFileURL(path.join(projectRoot, "dist", "job-store.js")).href;
  const driverScript = `
    import { runJobAttempt } from ${JSON.stringify(runnerUrl)};
    import { writeJob } from ${JSON.stringify(jobStoreUrl)};
    let writeCalls = 0;
    runJobAttempt(process.argv[1], {
      writeJobFn: async (record) => {
        writeCalls += 1;
        if (writeCalls === 2) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        return writeJob(record);
      },
    }).catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", driverScript, jobFile], {
    encoding: "utf8",
    timeout: 15_000,
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
  assert.deepEqual(completed.artifacts, [{ path: "result.txt", description: "Fake integration artifact" }]);
  assert.deepEqual(completed.verification, ["fake check passed"]);
  assert.deepEqual(completed.remaining, []);
  assert.equal(completed.attempts[0].status, "completed");
  assert.equal(completed.attempts[0].exitCode, 0);
  assert.equal(typeof completed.attempts[0].ompPid, "number");
  assert.match(completed.finalResponse, /OMP_WORKER_RESULT/);
});

test("runner fails visibly and persists failed job status when child spawn emits an immediate error during metadata write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-worker-spawn-err-test-"));
  const id = "job-1000000000002-abcdef02";
  const directory = path.join(root, "jobs", id);
  await mkdir(directory, { recursive: true });
  const promptPath = path.join(directory, "attempt-01.prompt.md");
  await writeFile(promptPath, "fake prompt", "utf8");
  const now = new Date().toISOString();
  const job = {
    version: 1,
    id,
    status: "queued",
    goal: "deterministic spawn error test",
    cwd: root,
    acceptance: ["must fail visibly without unhandled rejection"],
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

  const runnerUrl = pathToFileURL(path.join(projectRoot, "dist", "runner.js")).href;
  const jobStoreUrl = pathToFileURL(path.join(projectRoot, "dist", "job-store.js")).href;
  const errorDriverScript = `
    import { runJobAttempt } from ${JSON.stringify(runnerUrl)};
    import { writeJob, readJob } from ${JSON.stringify(jobStoreUrl)};
    let writeCalls = 0;
    runJobAttempt(process.argv[1], {
      writeJobFn: async (record) => {
        writeCalls += 1;
        if (writeCalls === 2) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return writeJob(record);
      },
    }).catch(async (err) => {
      const message = err instanceof Error ? err.stack || err.message : String(err);
      process.stderr.write(message + "\\n");
      const jobRecord = await readJob(${JSON.stringify(id)});
      jobRecord.status = "failed";
      jobRecord.error = message;
      if (jobRecord.attempts[0]) {
        jobRecord.attempts[0].status = "failed";
        jobRecord.attempts[0].error = message;
        jobRecord.attempts[0].completedAt = new Date().toISOString();
      }
      await writeJob(jobRecord);
      process.exitCode = 1;
    });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", errorDriverScript, jobFile], {
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      OMP_WORKER_STATE_DIR: root,
      OMP_WORKER_OMP_COMMAND: path.join(root, "non-existent-omp-binary-xyz"),
    },
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /UnhandledPromiseRejection/);
  const failed = JSON.parse(await readFile(jobFile, "utf8"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts[0].status, "failed");
  assert.match(failed.error || "", /ENOENT|spawn/i);

  // Also verify direct CLI entry point (dist/runner.js main().catch) on immediate spawn error
  const cliJobId = "job-1000000000003-abcdef03";
  const cliDir = path.join(root, "jobs", cliJobId);
  await mkdir(cliDir, { recursive: true });
  const cliJobFile = path.join(cliDir, "job.json");
  await writeFile(
    cliJobFile,
    `${JSON.stringify({ ...job, id: cliJobId, status: "queued", attempts: [{ ...job.attempts[0], status: "queued" }] }, null, 2)}\n`,
    "utf8",
  );
  const cliResult = spawnSync(process.execPath, [path.join(projectRoot, "dist", "runner.js"), cliJobFile], {
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      OMP_WORKER_STATE_DIR: root,
      OMP_WORKER_OMP_COMMAND: path.join(root, "non-existent-omp-binary-xyz"),
    },
  });
  assert.notEqual(cliResult.status, 0);
  assert.doesNotMatch(cliResult.stderr, /UnhandledPromiseRejection/);
  const cliFailed = JSON.parse(await readFile(cliJobFile, "utf8"));
  assert.equal(cliFailed.status, "failed");
  assert.equal(cliFailed.attempts[0].status, "failed");
  assert.match(cliFailed.error || "", /ENOENT|spawn/i);
});
