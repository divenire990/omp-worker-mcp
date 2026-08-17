import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  clearGroupCancellationRequest,
  createJobId,
  ensureJobDirectory,
  hasGroupCancellationRequest,
  jobFilePath,
  readGroup,
  readGroupCancellationRequest,
  readJob,
  validateGroupId,
  writeCancellationRequest,
  writeGroup,
  writeJob,
  writePrompt,
} from "./job-store.js";
import { buildDelegatePrompt } from "./protocol.js";
import {
  TERMINAL_STATUSES,
  type BatchTaskAccess,
  type BatchTaskRecord,
  type GroupRecord,
  type GroupStatus,
  type JobAttempt,
  type JobRecord,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(__dirname, "runner.js");

function attemptPaths(directory: string, number: number) {
  const prefix = `attempt-${String(number).padStart(2, "0")}`;
  return {
    stdoutPath: path.join(directory, `${prefix}.stdout.jsonl`),
    stderrPath: path.join(directory, `${prefix}.stderr.log`),
  };
}

async function validateWorkingDirectory(cwd: string): Promise<string> {
  const resolved = path.resolve(cwd);
  const info = await stat(resolved).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error(`cwd does not exist: ${resolved}`);
    throw error;
  });
  if (!info.isDirectory()) throw new Error(`cwd is not a directory: ${resolved}`);
  return resolved;
}

async function launchRunner(job: JobRecord): Promise<void> {
  const child = spawn(process.execPath, [runnerPath, jobFilePath(job.id)], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

interface JobCreateParams {
  goal: string;
  cwd: string;
  acceptance: string[];
  supervisor_brief?: string;
  timeout_minutes: number;
  max_attempts: number;
  groupId?: string;
  groupTaskId?: string;
  access?: BatchTaskAccess;
  ownership?: string[];
}

async function createAndStartJob(params: JobCreateParams): Promise<{ job: JobRecord; directory: string }> {
  const resolvedCwd = await validateWorkingDirectory(params.cwd);
  const id = createJobId();
  const directory = await ensureJobDirectory(id);
  const now = new Date().toISOString();
  const job: JobRecord = {
    version: 1,
    id,
    status: "queued",
    goal: params.goal,
    supervisorBrief: params.supervisor_brief,
    cwd: resolvedCwd,
    acceptance: params.acceptance,
    maxAttempts: params.max_attempts,
    currentAttempt: 1,
    createdAt: now,
    updatedAt: now,
    artifacts: [],
    verification: [],
    remaining: [],
    attempts: [],
    groupId: params.groupId,
    groupTaskId: params.groupTaskId,
    access: params.access,
    ownership: params.ownership,
  };
  const promptPath = await writePrompt(id, 1, buildDelegatePrompt(job));
  const paths = attemptPaths(directory, 1);
  const attempt: JobAttempt = {
    number: 1,
    kind: "delegate",
    status: "queued",
    promptPath,
    timeoutMinutes: params.timeout_minutes,
    ...paths,
  };
  job.attempts.push(attempt);
  await writeJob(job);
  try {
    await launchRunner(job);
  } catch (error: unknown) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    attempt.status = "failed";
    attempt.error = job.error;
    await writeJob(job);
    throw error;
  }
  return { job, directory };
}

export function parseGroupId(input: string): string {
  const trimmed = input.trim();
  if (trimmed.endsWith("group.json")) {
    const parentDir = path.basename(path.dirname(path.resolve(trimmed)));
    validateGroupId(parentDir);
    return parentDir;
  }
  validateGroupId(trimmed);
  return trimmed;
}

export async function runGroupOrchestrator(groupIdOrPath: string): Promise<GroupRecord> {
  const groupId = parseGroupId(groupIdOrPath);
  let group: GroupRecord;
  try {
    group = await readGroup(groupId);
  } catch (err) {
    throw new Error(`Failed to read group definition for ${groupId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const resolvedCwd = await validateWorkingDirectory(group.cwd);
    group.cwd = resolvedCwd;

    const now = new Date().toISOString();
    group.status = "running";
    group.coordinatorPid = process.pid;
    group.runnerPid = process.pid;
    if (!group.startedAt) {
      group.startedAt = now;
    }
    group.updatedAt = now;
    await writeGroup(group);

    const taskRecordMap = new Map<string, BatchTaskRecord>();
    const completedTaskIds = new Set<string>();
    const failedTaskIds = new Set<string>();
    const activeJobs = new Map<string, { taskId: string; jobId: string }>();

    for (const t of group.tasks) {
      taskRecordMap.set(t.id, t);
      if (t.status === "completed") {
        completedTaskIds.add(t.id);
      } else if (t.status === "failed" || t.status === "blocked" || t.status === "cancelled" || t.status === "timed_out") {
        failedTaskIds.add(t.id);
      } else if (t.status === "running" && t.jobId) {
        activeJobs.set(t.jobId, { taskId: t.id, jobId: t.jobId });
      }
    }

    // Refresh ready tasks initially
    for (const pendingTask of group.tasks) {
      if (pendingTask.status === "pending") {
        const allDepsCompleted = (pendingTask.dependsOn || []).every((dep) => completedTaskIds.has(dep));
        if (allDepsCompleted) {
          pendingTask.status = "ready";
        }
      }
    }
    await writeGroup(group);

    const groupDeadline = new Date(group.createdAt).getTime() + group.groupTimeoutMinutes * 60_000;
    let groupTerminatedStatus: GroupStatus | undefined;

    const blockDownstream = (failedId: string) => {
      const queue = [failedId];
      while (queue.length > 0) {
        const currId = queue.shift()!;
        for (const t of group.tasks) {
          if (t.status === "pending" || t.status === "ready") {
            if (t.dependsOn && t.dependsOn.includes(currId)) {
              t.status = "blocked";
              t.error = `Dependency failed: ${currId}`;
              queue.push(t.id);
            }
          }
        }
      }
    };

    while (true) {
      // 1. Check for group cancellation request
      const isCancelled = await hasGroupCancellationRequest(groupId);
      if (isCancelled) {
        const cancelReq = await readGroupCancellationRequest(groupId);
        groupTerminatedStatus = "cancelled";
        group.cancelRequestedAt = cancelReq?.requestedAt || new Date().toISOString();
        group.cancelReason = cancelReq?.reason || "Group cancelled";

        for (const { jobId } of activeJobs.values()) {
          try {
            await writeCancellationRequest(jobId, cancelReq?.reason || "Group cancelled");
          } catch {}
        }
        for (const t of group.tasks) {
          if (t.status === "pending" || t.status === "ready") {
            t.status = "cancelled";
            t.error = "Group execution cancelled";
          }
        }

        const cancelGraceDeadline = Date.now() + 5_000;
        while (activeJobs.size > 0 && Date.now() < cancelGraceDeadline) {
          await sleep(150);
          for (const [jobId, { taskId }] of Array.from(activeJobs.entries())) {
            try {
              const job = await readJob(jobId);
              if (TERMINAL_STATUSES.has(job.status)) {
                activeJobs.delete(jobId);
                const task = taskRecordMap.get(taskId)!;
                task.status = "cancelled";
                task.completedAt = new Date().toISOString();
                task.error = job.error || "Task cancelled";
              }
            } catch {}
          }
        }
        for (const { taskId } of activeJobs.values()) {
          const task = taskRecordMap.get(taskId)!;
          task.status = "cancelled";
          task.completedAt = new Date().toISOString();
          task.error = "Group cancelled";
        }
        activeJobs.clear();
        break;
      }

      // 2. Check for group timeout
      if (Date.now() >= groupDeadline) {
        groupTerminatedStatus = "timed_out";
        for (const { jobId } of activeJobs.values()) {
          try {
            await writeCancellationRequest(jobId, "Group timeout exceeded");
          } catch {}
        }
        for (const t of group.tasks) {
          if (t.status === "pending" || t.status === "ready") {
            t.status = "timed_out";
            t.error = "Group timeout exceeded before task could start";
          }
        }

        const waitGraceDeadline = Date.now() + 5_000;
        while (activeJobs.size > 0 && Date.now() < waitGraceDeadline) {
          await sleep(150);
          for (const [jobId, { taskId }] of Array.from(activeJobs.entries())) {
            try {
              const job = await readJob(jobId);
              if (TERMINAL_STATUSES.has(job.status)) {
                activeJobs.delete(jobId);
                const task = taskRecordMap.get(taskId)!;
                task.status = "timed_out";
                task.completedAt = new Date().toISOString();
                task.error = "Group timeout exceeded";
              }
            } catch {}
          }
        }
        for (const { taskId } of activeJobs.values()) {
          const task = taskRecordMap.get(taskId)!;
          task.status = "timed_out";
          task.completedAt = new Date().toISOString();
          task.error = "Group timeout exceeded";
        }
        activeJobs.clear();
        break;
      }

      // 3. Poll existing active jobs first to release completed slots
      for (const [jobId, { taskId }] of Array.from(activeJobs.entries())) {
        try {
          const job = await readJob(jobId);
          if (TERMINAL_STATUSES.has(job.status)) {
            activeJobs.delete(jobId);
            const task = taskRecordMap.get(taskId)!;
            task.completedAt = new Date().toISOString();
            if (job.status === "completed") {
              task.status = "completed";
              completedTaskIds.add(task.id);

              for (const pendingTask of group.tasks) {
                if (pendingTask.status === "pending") {
                  const allDepsCompleted = (pendingTask.dependsOn || []).every((dep) => completedTaskIds.has(dep));
                  if (allDepsCompleted) {
                    pendingTask.status = "ready";
                  }
                }
              }
            } else {
              task.status = (job.status === "cancelled" || job.status === "timed_out" ? job.status : "failed") as BatchTaskRecord["status"];
              task.error = job.error || `Task ended with status ${job.status}`;
              failedTaskIds.add(task.id);
              blockDownstream(task.id);
            }
            await writeGroup(group);
          }
        } catch {}
      }

      // 4. Dispatch ready tasks up to maxParallel
      while (activeJobs.size < group.maxParallel) {
        const nextReady = group.tasks.find((t) => t.status === "ready");
        if (!nextReady) break;

        nextReady.status = "running";
        nextReady.startedAt = new Date().toISOString();
        try {
          const { job } = await createAndStartJob({
            goal: nextReady.goal,
            cwd: group.cwd,
            acceptance: nextReady.acceptance,
            supervisor_brief: group.supervisorBrief,
            timeout_minutes: nextReady.timeoutMinutes,
            max_attempts: nextReady.maxAttempts,
            groupId: group.id,
            groupTaskId: nextReady.id,
            access: nextReady.access,
            ownership: nextReady.ownership,
          });
          nextReady.jobId = job.id;
          activeJobs.set(job.id, { taskId: nextReady.id, jobId: job.id });
          await writeGroup(group);
        } catch (err: unknown) {
          nextReady.status = "failed";
          nextReady.completedAt = new Date().toISOString();
          nextReady.error = err instanceof Error ? err.message : String(err);
          failedTaskIds.add(nextReady.id);
          blockDownstream(nextReady.id);
          await writeGroup(group);
        }
      }

      // 5. Check if all tasks have settled or deadlock
      if (activeJobs.size === 0) {
        const hasReady = group.tasks.some((t) => t.status === "ready");
        if (!hasReady) {
          const remainingPending = group.tasks.filter((t) => t.status === "pending");
          if (remainingPending.length > 0) {
            for (const t of remainingPending) {
              t.status = "blocked";
              t.error = "Deadlock or unsatisfied dependencies prevented execution";
            }
            await writeGroup(group);
          }
          break;
        }
      }

      await sleep(150);
    }

    // 6. Aggregate results
    const totalTasks = group.tasks.length;
    let completedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;
    let blockedCount = 0;
    let timedOutCount = 0;

    for (const t of group.tasks) {
      if (t.status === "completed") completedCount++;
      else if (t.status === "failed") failedCount++;
      else if (t.status === "cancelled") cancelledCount++;
      else if (t.status === "blocked") blockedCount++;
      else if (t.status === "timed_out") timedOutCount++;
    }

    let finalGroupStatus: GroupStatus;
    if (groupTerminatedStatus) {
      finalGroupStatus = groupTerminatedStatus;
    } else if (completedCount === totalTasks) {
      finalGroupStatus = "completed";
    } else if (completedCount === 0) {
      finalGroupStatus = "failed";
    } else {
      finalGroupStatus = "partial";
    }

    group.status = finalGroupStatus;
    group.completedAt = new Date().toISOString();
    group.updatedAt = new Date().toISOString();
    group.summary = `Batch execution ${group.id} finished with status '${finalGroupStatus}': ${completedCount}/${totalTasks} tasks completed, ${failedCount} failed, ${blockedCount} blocked, ${cancelledCount} cancelled, ${timedOutCount} timed out.`;

    if (finalGroupStatus === "cancelled") {
      await clearGroupCancellationRequest(group.id).catch(() => {});
    }
    await writeGroup(group);
    return group;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    try {
      const latest = await readGroup(groupId).catch(() => group);
      latest.status = "failed";
      latest.error = errorMessage;
      latest.completedAt = new Date().toISOString();
      latest.updatedAt = new Date().toISOString();
      await writeGroup(latest);
    } catch {}
    throw error;
  }
}
