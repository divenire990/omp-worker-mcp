import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extractAssistantText, extractSessionId, parseResultEnvelope } from "./protocol.js";
import { cancellationFilePath, clearCancellationRequest, readJob, writeJob } from "./job-store.js";
import type { JobRecord } from "./types.js";

export async function terminateOwnedProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => {
        child.kill("SIGTERM");
        resolve();
      });
      killer.once("close", () => resolve());
    });
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
}

async function main(): Promise<void> {
  const jobFile = process.argv[2];
  if (!jobFile) throw new Error("runner requires a job.json path");
  const initial = JSON.parse(await readFile(path.resolve(jobFile), "utf8")) as JobRecord;
  const job = await readJob(initial.id);
  const attempt = job.attempts.find((item) => item.number === job.currentAttempt);
  if (!attempt) throw new Error(`Attempt ${job.currentAttempt} is missing`);

  attempt.status = "running";
  attempt.runnerPid = process.pid;
  attempt.startedAt = new Date().toISOString();
  job.status = "running";
  await writeJob(job);

  const cancelPath = cancellationFilePath(job.id);
  if (existsSync(cancelPath)) {
    const now = new Date().toISOString();
    attempt.status = "cancelled";
    attempt.cancelledAt = now;
    attempt.completedAt = now;
    job.status = "cancelled";
    await clearCancellationRequest(job.id);
    await writeJob(job);
    return;
  }

  const command = process.env.OMP_WORKER_OMP_COMMAND || "omp";
  let prefixArgs: string[] = [];
  if (process.env.OMP_WORKER_OMP_PREFIX_ARGS) {
    const parsed = JSON.parse(process.env.OMP_WORKER_OMP_PREFIX_ARGS) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new Error("OMP_WORKER_OMP_PREFIX_ARGS must be a JSON string array");
    }
    prefixArgs = parsed;
  }

  const args = [
    ...prefixArgs,
    "--cwd",
    job.cwd,
    "--mode",
    "json",
    "--auto-approve",
    "--no-title",
    "--max-time",
    `${attempt.timeoutMinutes}m`,
  ];
  if (attempt.kind === "continue") {
    if (!job.sessionId) throw new Error("Cannot continue without an OMP session ID");
    args.push("--resume", job.sessionId);
  }
  args.push("-p", `@${attempt.promptPath}`);

  const stdoutStream = createWriteStream(attempt.stdoutPath, { flags: "w" });
  const stderrStream = createWriteStream(attempt.stderrPath, { flags: "w" });
  const child = spawn(command, args, {
    cwd: job.cwd,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  attempt.ompPid = child.pid;
  await writeJob(job);

  child.stdout.pipe(stdoutStream);
  child.stderr.pipe(stderrStream);
  let sessionId = job.sessionId;
  let finalResponse = "";
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    try {
      const event = JSON.parse(line) as unknown;
      sessionId = extractSessionId(event) || sessionId;
      finalResponse = extractAssistantText(event) || finalResponse;
    } catch {
      // 原始输出仍写入日志；非 JSON 行不会破坏整个任务状态。
    }
  });

  let terminationReason: "cancelled" | "timed_out" | undefined;
  let stopRequested = false;
  const requestStop = (reason: "cancelled" | "timed_out") => {
    if (stopRequested) return;
    stopRequested = true;
    terminationReason = reason;
    void terminateOwnedProcessTree(child);
  };
  const cancelPoll = setInterval(() => {
    if (existsSync(cancelPath)) requestStop("cancelled");
  }, 250);
  cancelPoll.unref();
  const hardTimeout = setTimeout(() => {
    requestStop("timed_out");
  }, (attempt.timeoutMinutes + 2) * 60_000);
  hardTimeout.unref();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  clearInterval(cancelPoll);
  clearTimeout(hardTimeout);
  await new Promise<void>((resolve) => stdoutStream.end(resolve));
  await new Promise<void>((resolve) => stderrStream.end(resolve));

  const latest = await readJob(job.id);
  const latestAttempt = latest.attempts.find((item) => item.number === latest.currentAttempt);
  if (!latestAttempt) throw new Error("Current attempt disappeared while runner was active");
  latestAttempt.completedAt = new Date().toISOString();
  latestAttempt.exitCode = exitCode;
  latestAttempt.finalResponse = finalResponse || undefined;
  latest.sessionId = sessionId;
  latest.finalResponse = finalResponse || undefined;

  if (terminationReason === "cancelled") {
    const now = new Date().toISOString();
    latest.status = "cancelled";
    latestAttempt.status = "cancelled";
    latestAttempt.cancelledAt = now;
    latest.error = undefined;
  } else if (terminationReason === "timed_out") {
    latest.status = "timed_out";
    latestAttempt.status = "timed_out";
    latest.error = `OMP exceeded the hard timeout (${attempt.timeoutMinutes + 2} minutes)`;
  } else if (exitCode !== 0) {
    latest.status = "failed";
    latestAttempt.status = "failed";
    latest.error = `OMP exited with code ${String(exitCode)}; inspect ${latestAttempt.stderrPath}`;
  } else {
    const envelope = parseResultEnvelope(finalResponse);
    if (!envelope) {
      latest.status = "awaiting_review";
      latestAttempt.status = "awaiting_review";
      latest.error = "OMP exited successfully but did not return the structured completion envelope";
    } else {
      latest.summary = envelope.summary;
      latest.artifacts = envelope.artifacts;
      latest.verification = envelope.verification;
      latest.remaining = envelope.remaining;
      latest.status = envelope.status;
      latestAttempt.status = envelope.status;
      latest.error = undefined;
    }
  }
  await clearCancellationRequest(latest.id);
  await writeJob(latest);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    try {
      const jobFile = process.argv[2];
      if (jobFile) {
        const initial = JSON.parse(await readFile(path.resolve(jobFile), "utf8")) as { id?: string };
        if (initial.id) {
          const job = await readJob(initial.id);
          const attempt = job.attempts.find((item) => item.number === job.currentAttempt);
          job.status = "failed";
          job.error = message;
          if (attempt) {
            attempt.status = "failed";
            attempt.error = message;
            attempt.completedAt = new Date().toISOString();
          }
          await writeJob(job);
        }
      }
    } catch {
      // 最后兜底失败只能写 stderr，避免覆盖原始异常。
    }
    process.exitCode = 1;
  });
}
