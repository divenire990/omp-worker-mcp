import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildContinuePrompt, buildDelegatePrompt } from "./protocol.js";
import {
  cleanState,
  clearCancellationRequest,
  createGroupId,
  createJobId,
  ensureGroupDirectory,
  ensureJobDirectory,
  getRetentionOptionsFromEnv,
  groupFilePath,
  jobFilePath,
  readGroup,
  readJob,
  writeCancellationRequest,
  writeGroup,
  writeGroupCancellationRequest,
  writeJob,
  writePrompt,
} from "./job-store.js";
import {
  GROUP_TERMINAL_STATUSES,
  TERMINAL_STATUSES,
  type BatchTaskAccess,
  type BatchTaskInput,
  type BatchTaskRecord,
  type CompactBatchTaskResult,
  type CompactGroupResult,
  type GroupRecord,
  type GroupStatus,
  type JobAttempt,
  type JobRecord,
  type StateCleanupResult,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(__dirname, "runner.js");
const groupRunnerPath = path.join(__dirname, "group-runner.js");

const artifactSchema = z.object({ path: z.string(), description: z.string() });

const statusOutput = {
  job_id: z.string(),
  status: z.string(),
  attempt: z.number().int(),
  max_attempts: z.number().int(),
  session_id: z.string().optional(),
  summary: z.string().optional(),
  artifacts: z.array(artifactSchema),
  verification: z.array(z.string()),
  remaining: z.array(z.string()),
  error: z.string().optional(),
  details_path: z.string().optional(),
};

const batchTaskResultSchema = z.object({
  id: z.string(),
  status: z.enum(["completed", "failed", "cancelled", "timed_out", "blocked"]),
  job_id: z.string().optional(),
  summary: z.string().optional(),
  artifacts: z.array(artifactSchema),
  verification: z.array(z.string()),
  remaining: z.array(z.string()),
  error: z.string().optional(),
  details_path: z.string().optional(),
});

const batchStatusOutput = {
  group_id: z.string(),
  status: z.enum([
    "queued",
    "running",
    "cancelling",
    "completed",
    "partial",
    "failed",
    "timed_out",
    "cancelled",
  ]),
  max_parallel: z.number().int(),
  total_tasks: z.number().int(),
  completed_tasks: z.number().int(),
  failed_tasks: z.number().int(),
  cancelled_tasks: z.number().int(),
  blocked_tasks: z.number().int(),
  summary: z.string(),
  tasks: z.array(batchTaskResultSchema).optional(),
};

function compactJob(job: JobRecord) {
  return {
    job_id: job.id,
    status: job.status,
    attempt: job.currentAttempt,
    max_attempts: job.maxAttempts,
    session_id: job.sessionId,
    summary: job.summary,
    artifacts: job.artifacts,
    verification: job.verification,
    remaining: job.remaining,
    error: job.error,
    details_path: TERMINAL_STATUSES.has(job.status) ? jobFilePath(job.id) : undefined,
  };
}

function toolResult(job: JobRecord, message?: string) {
  const structuredContent = compactJob(job);
  return {
    content: [{ type: "text" as const, text: message || JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function groupToolResult(structuredContent: CompactGroupResult, message?: string) {
  return {
    content: [{ type: "text" as const, text: message || JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

async function buildCompactGroupResult(
  group: GroupRecord,
  includeTasks: boolean,
  customSummary?: string,
): Promise<CompactGroupResult> {
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

  const totalTasks = group.tasks.length;
  let defaultSummary: string;
  if (GROUP_TERMINAL_STATUSES.has(group.status)) {
    defaultSummary =
      group.summary ||
      `Batch execution ${group.id} finished with status '${group.status}': ${completedCount}/${totalTasks} tasks completed, ${failedCount} failed, ${blockedCount} blocked, ${cancelledCount} cancelled, ${timedOutCount} timed out.`;
  } else {
    defaultSummary = `Batch group ${group.id} is currently '${group.status}': ${completedCount}/${totalTasks} tasks completed, ${failedCount} failed, ${blockedCount} blocked, ${cancelledCount} cancelled. Use omp_wait_group to wait for completion.`;
  }

  let taskResults: CompactBatchTaskResult[] | undefined;
  if (includeTasks) {
    taskResults = [];
    for (const t of group.tasks) {
      if (t.jobId) {
        try {
          const job = await readJob(t.jobId);
          taskResults.push({
            id: t.id,
            status: (t.status === "completed" ||
            t.status === "failed" ||
            t.status === "cancelled" ||
            t.status === "timed_out" ||
            t.status === "blocked"
              ? t.status
              : "failed") as CompactBatchTaskResult["status"],
            job_id: job.id,
            summary: job.summary,
            artifacts: job.artifacts || [],
            verification: job.verification || [],
            remaining: job.remaining || [],
            error: t.error || job.error,
            details_path: TERMINAL_STATUSES.has(job.status) ? jobFilePath(job.id) : undefined,
          });
        } catch {
          taskResults.push({
            id: t.id,
            status: (t.status === "completed" ||
            t.status === "failed" ||
            t.status === "cancelled" ||
            t.status === "timed_out" ||
            t.status === "blocked"
              ? t.status
              : "failed") as CompactBatchTaskResult["status"],
            job_id: t.jobId,
            artifacts: [],
            verification: [],
            remaining: [],
            error: t.error || "Failed to load job details",
          });
        }
      } else {
        taskResults.push({
          id: t.id,
          status: (t.status === "completed" ||
          t.status === "failed" ||
          t.status === "cancelled" ||
          t.status === "timed_out" ||
          t.status === "blocked"
            ? t.status
            : "failed") as CompactBatchTaskResult["status"],
          artifacts: [],
          verification: [],
          remaining: [],
          error: t.error,
        });
      }
    }
  }

  const structuredContent: CompactGroupResult = {
    group_id: group.id,
    status: group.status,
    max_parallel: group.maxParallel,
    total_tasks: totalTasks,
    completed_tasks: completedCount,
    failed_tasks: failedCount,
    cancelled_tasks: cancelledCount,
    blocked_tasks: blockedCount,
    summary: customSummary || defaultSummary,
  };

  if (taskResults !== undefined) {
    structuredContent.tasks = taskResults;
  }

  return structuredContent;
}

async function waitForGroup(
  groupId: string,
  waitSeconds: number,
  signal?: AbortSignal,
): Promise<GroupRecord> {
  let group = await readGroup(groupId);
  if (GROUP_TERMINAL_STATUSES.has(group.status) || waitSeconds <= 0) {
    return group;
  }
  const deadline = Date.now() + waitSeconds * 1_000;
  while (!GROUP_TERMINAL_STATUSES.has(group.status) && Date.now() < deadline) {
    if (signal?.aborted) {
      break;
    }
    await sleep(Math.min(200, Math.max(10, deadline - Date.now())));
    try {
      group = await readGroup(groupId);
    } catch (error: unknown) {
      if (Date.now() >= deadline) throw error;
    }
  }
  return group;
}

async function validateWorkingDirectory(cwd: string): Promise<string> {
  if (!path.isAbsolute(cwd)) throw new Error("cwd must be an absolute path");
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
  child.on("error", (error) => {
    console.error(`Failed to launch runner for job ${job.id}:`, error);
  });
  child.unref();
}

async function launchGroupRunner(groupId: string): Promise<void> {
  const child = spawn(process.execPath, [groupRunnerPath, groupId], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: process.env,
  });
  child.on("error", (error) => {
    console.error(`Failed to launch group runner for group ${groupId}:`, error);
  });
  child.unref();
}

function attemptPaths(directory: string, number: number) {
  const prefix = `attempt-${String(number).padStart(2, "0")}`;
  return {
    stdoutPath: path.join(directory, `${prefix}.stdout.jsonl`),
    stderrPath: path.join(directory, `${prefix}.stderr.log`),
  };
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

function normalizeFilePath(filePath: string, cwd: string): string {
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(cwd, filePath);
  return resolved.replace(/\\/g, "/").toLowerCase();
}

function checkPathOverlap(p1: string, p2: string): boolean {
  if (p1 === p2) return true;
  const p1WithSlash = p1.endsWith("/") ? p1 : `${p1}/`;
  const p2WithSlash = p2.endsWith("/") ? p2 : `${p2}/`;
  return p2.startsWith(p1WithSlash) || p1.startsWith(p2WithSlash);
}

export function validateDAGAndOwnership(tasks: BatchTaskInput[], cwd: string): void {
  const taskMap = new Map<string, BatchTaskInput>();
  for (const t of tasks) {
    if (taskMap.has(t.id)) {
      throw new Error(`Duplicate task id: ${t.id}`);
    }
    taskMap.set(t.id, t);
  }

  for (const t of tasks) {
    const deps = t.depends_on || [];
    for (const dep of deps) {
      if (!taskMap.has(dep)) {
        throw new Error(`Task ${t.id} depends on unknown task: ${dep}`);
      }
      if (dep === t.id) {
        throw new Error(`Task ${t.id} cannot depend on itself`);
      }
    }
  }

  const visited = new Map<string, number>();
  function checkCycle(id: string, pathStack: string[]): void {
    visited.set(id, 1);
    const deps = taskMap.get(id)?.depends_on || [];
    for (const dep of deps) {
      const state = visited.get(dep) || 0;
      if (state === 1) {
        throw new Error(`Cyclic dependency detected: ${[...pathStack, id, dep].join(" -> ")}`);
      }
      if (state === 0) {
        checkCycle(dep, [...pathStack, id]);
      }
    }
    visited.set(id, 2);
  }

  for (const t of tasks) {
    if (!visited.get(t.id)) {
      checkCycle(t.id, []);
    }
  }

  const leadsTo = new Map<string, Set<string>>();
  for (const t of tasks) {
    leadsTo.set(t.id, new Set<string>());
  }
  for (const t of tasks) {
    const deps = t.depends_on || [];
    for (const dep of deps) {
      leadsTo.get(dep)!.add(t.id);
    }
  }

  const allDescendants = new Map<string, Set<string>>();
  for (const t of tasks) {
    const desc = new Set<string>();
    const queue = Array.from(leadsTo.get(t.id) || []);
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (!desc.has(next)) {
        desc.add(next);
        for (const child of leadsTo.get(next) || []) {
          queue.push(child);
        }
      }
    }
    allDescendants.set(t.id, desc);
  }

  function hasOrder(idA: string, idB: string): boolean {
    return allDescendants.get(idA)?.has(idB) || allDescendants.get(idB)?.has(idA) || false;
  }

  for (const t of tasks) {
    const access = t.access || "read_only";
    const ownership = t.ownership || [];
    if (access === "write" && ownership.length === 0) {
      throw new Error(`Write task '${t.id}' must declare non-empty ownership paths`);
    }
  }

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const taskA = tasks[i];
      const taskB = tasks[j];
      if (hasOrder(taskA.id, taskB.id)) {
        continue;
      }
      const accessA = taskA.access || "read_only";
      const accessB = taskB.access || "read_only";
      if (accessA === "read_only" && accessB === "read_only") {
        continue;
      }
      const pathsA = (taskA.ownership || []).map((p) => normalizeFilePath(p, cwd));
      const pathsB = (taskB.ownership || []).map((p) => normalizeFilePath(p, cwd));
      for (const pA of pathsA) {
        for (const pB of pathsB) {
          if (checkPathOverlap(pA, pB)) {
            throw new Error(
              `Concurrent write ownership conflict between task '${taskA.id}' and task '${taskB.id}' on overlapping path ('${pA}' vs '${pB}'). Add depends_on to order them or separate ownership scopes.`,
            );
          }
        }
      }
    }
  }
}

const server = new McpServer(
  { name: "omp-worker", version: "1.0.0" },
  {
    instructions:
      "Use OMP Boss Mode by default for substantive tasks that require tool-driven investigation, implementation, workspace or environment changes, or other multi-step execution. Ordinary conversation, direct explanations, status questions, and answers that need no task execution remain with Codex; the user may also explicitly ask Codex to work directly. In Boss Mode, first perform bounded, risk-proportionate, read-only exploration of the goal and local context. Stop as soon as the evidence is decision-ready, tell the user the concise findings and proposed direction, and call omp_run_compact by default for single tasks or omp_run_batch_compact for multiple independent tasks. If omp_run_compact or omp_run_batch_compact returns a terminal compact result, perform decisive acceptance checks without requesting unnecessary full reports.",
  },
);

server.registerTool(
  "omp_run_batch_compact",
  {
    title: "Run Batch OMP Tasks with DAG and Compact Aggregated Result (Preferred for Multi-task)",
    description:
      "Submits a decomposed group of OMP tasks to execute concurrently in the server-side bounded rolling pool (max_parallel 1-10) using a detached group runner. Enforces dependency DAG and write-ownership safety, waits up to wait_seconds (0-240, default 60s) for batch completion, and returns stable compact aggregated results. If still running when deadline elapses, returns group_id and minimal progress counts for subsequent omp_wait_group.",
    inputSchema: {
      cwd: z.string().min(1).describe("Absolute working directory OMP may inspect and modify"),
      tasks: z
        .array(
          z.object({
            id: z.string().min(1).max(100).describe("Unique task identifier within the group"),
            goal: z.string().min(1).max(20_000).describe("Complete natural-language outcome OMP must deliver"),
            acceptance: z.array(z.string().min(1).max(2_000)).max(20).default([]),
            depends_on: z.array(z.string().min(1).max(100)).default([]),
            access: z.enum(["read_only", "write"]).default("read_only"),
            ownership: z
              .array(z.string().min(1).max(1_000))
              .default([])
              .describe("Workspace paths this task is authorized to write to (required non-empty for write tasks)"),
            timeout_minutes: z.number().int().min(1).max(120).optional(),
            max_attempts: z.number().int().min(1).max(5).optional(),
          }),
        )
        .min(1)
        .max(50)
        .describe("Array of decomposed tasks to execute concurrently according to dependency DAG and ownership safety"),
      max_parallel: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(4)
        .describe("Maximum concurrent active OMP runners (1-10, default 4)"),
      group_timeout_minutes: z
        .number()
        .int()
        .min(1)
        .max(120)
        .default(60)
        .describe("Hard overall group deadline in minutes (1-120, default 60)"),
      default_timeout_minutes: z
        .number()
        .int()
        .min(1)
        .max(120)
        .default(30)
        .describe("Default per-task timeout in minutes if not specified in task (1-120, default 30)"),
      default_max_attempts: z
        .number()
        .int()
        .min(1)
        .max(5)
        .default(3)
        .describe("Default per-task attempt limit if not specified in task (1-5, default 3)"),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(240)
        .default(60)
        .describe("Maximum seconds to wait for batch completion inside this call (0-240, default 60)"),
      supervisor_brief: z
        .string()
        .max(12_000)
        .optional()
        .describe("Shared decision-ready read-only findings, hypotheses, and constraints for the task group"),
    },
    outputSchema: batchStatusOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (
    {
      cwd,
      tasks,
      max_parallel,
      group_timeout_minutes,
      default_timeout_minutes,
      default_max_attempts,
      wait_seconds,
      supervisor_brief,
    },
    extra,
  ) => {
    const resolvedCwd = await validateWorkingDirectory(cwd);
    validateDAGAndOwnership(tasks, resolvedCwd);

    const groupId = createGroupId();
    await ensureGroupDirectory(groupId);

    const initialTaskRecords: BatchTaskRecord[] = tasks.map((t) => ({
      id: t.id,
      status: (t.depends_on && t.depends_on.length > 0 ? "pending" : "ready") as BatchTaskRecord["status"],
      goal: t.goal,
      acceptance: t.acceptance || [],
      dependsOn: t.depends_on || [],
      access: t.access || "read_only",
      ownership: t.ownership || [],
      timeoutMinutes: t.timeout_minutes || default_timeout_minutes,
      maxAttempts: t.max_attempts || default_max_attempts,
    }));

    const now = new Date().toISOString();
    const groupRecord: GroupRecord = {
      version: 1,
      id: groupId,
      status: "queued",
      cwd: resolvedCwd,
      maxParallel: max_parallel,
      groupTimeoutMinutes: group_timeout_minutes,
      supervisorBrief: supervisor_brief,
      createdAt: now,
      updatedAt: now,
      tasks: initialTaskRecords,
    };
    await writeGroup(groupRecord);
    await launchGroupRunner(groupId);

    const latestGroup = await waitForGroup(groupId, wait_seconds, extra?.signal);
    const isTerminal = GROUP_TERMINAL_STATUSES.has(latestGroup.status);
    const structuredContent = await buildCompactGroupResult(
      latestGroup,
      isTerminal,
      isTerminal
        ? undefined
        : `Batch execution ${groupId} is ${latestGroup.status} after ${wait_seconds}s. Use omp_wait_group to continue waiting.`,
    );

    return groupToolResult(
      structuredContent,
      isTerminal
        ? undefined
        : `Batch execution ${groupId} is ${latestGroup.status} after ${wait_seconds}s. Use omp_wait_group to continue waiting.`,
    );
  },
);

server.registerTool(
  "omp_wait_group",
  {
    title: "Wait for Batch Task Group",
    description:
      "Wait for an existing OMP task group to reach a terminal status, polling up to wait_seconds (0-240, default 60s). If completed, returns full aggregated compact results in original input order. If still running when deadline elapses, returns minimal progress counts without leaking task summaries.",
    inputSchema: {
      group_id: z.string().min(1).describe("The unique group_id returned by omp_run_batch_compact"),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(240)
        .default(60)
        .describe("Maximum seconds to wait inside this call (0-240, default 60)"),
    },
    outputSchema: batchStatusOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ group_id, wait_seconds }, extra) => {
    const latestGroup = await waitForGroup(group_id, wait_seconds, extra?.signal);
    const isTerminal = GROUP_TERMINAL_STATUSES.has(latestGroup.status);
    const structuredContent = await buildCompactGroupResult(
      latestGroup,
      isTerminal,
      isTerminal
        ? undefined
        : `Batch execution ${group_id} is ${latestGroup.status} after ${wait_seconds}s. Use omp_wait_group to continue waiting.`,
    );

    return groupToolResult(
      structuredContent,
      isTerminal
        ? undefined
        : `Batch execution ${group_id} is ${latestGroup.status} after ${wait_seconds}s. Use omp_wait_group to continue waiting.`,
    );
  },
);

server.registerTool(
  "omp_cancel_group",
  {
    title: "Cancel Batch Task Group",
    description:
      "Request immediate cancellation of a running batch task group and its child tasks. Writes a cancellation request that the detached group coordinator handles safely. Call this immediately when the user asks to stop a batch.",
    inputSchema: {
      group_id: z.string().min(1).describe("The group_id of the batch task group to cancel"),
      reason: z
        .string()
        .min(1)
        .max(2_000)
        .default("Cancelled at the user's request")
        .describe("Reason for cancellation"),
    },
    outputSchema: batchStatusOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ group_id, reason }) => {
    let group = await readGroup(group_id);
    if (GROUP_TERMINAL_STATUSES.has(group.status)) {
      const structuredContent = await buildCompactGroupResult(
        group,
        true,
        `Batch group ${group_id} is already ${group.status}.`,
      );
      return groupToolResult(structuredContent, `Batch group ${group_id} is already ${group.status}.`);
    }

    const requestedAt = new Date().toISOString();
    group.status = "cancelling";
    group.cancelRequestedAt = requestedAt;
    group.cancelReason = reason;
    await writeGroup(group);
    await writeGroupCancellationRequest(group_id, reason);

    const structuredContent = await buildCompactGroupResult(
      group,
      false,
      `Cancellation requested for batch task group ${group_id}. Use omp_wait_group to wait for cancellation to finalize.`,
    );
    return groupToolResult(
      structuredContent,
      `Cancellation requested for batch task group ${group_id}. Use omp_wait_group to wait for cancellation to finalize.`,
    );
  },
);

server.registerTool(
  "omp_run_compact",
  {
    title: "Run OMP Task with Compact Result (Preferred for Single Task)",
    description:
      "Preferred entrypoint for single substantive execution tasks. Creates a delegated OMP task, launches the detached runner, and waits up to wait_seconds (default 60s) for completion in a single MCP call. If finished, returns a compact summary, artifacts, verification, and details_path without dumping the full final response. If still running at the deadline, returns job_id and status running for subsequent omp_wait.",
    inputSchema: {
      goal: z.string().min(1).max(20_000).describe("Complete natural-language outcome OMP must deliver"),
      cwd: z.string().min(1).describe("Absolute working directory OMP may inspect and modify"),
      acceptance: z.array(z.string().min(1).max(2_000)).max(20).default([]),
      supervisor_brief: z
        .string()
        .max(12_000)
        .optional()
        .describe("Decision-ready read-only findings, hypotheses, constraints, and recommended direction"),
      timeout_minutes: z.number().int().min(1).max(120).default(30),
      max_attempts: z.number().int().min(1).max(5).default(3),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(60)
        .default(60)
        .describe("Maximum seconds to wait for terminal status inside this call (0-60, default 60)"),
    },
    outputSchema: statusOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ goal, cwd, acceptance, supervisor_brief, timeout_minutes, max_attempts, wait_seconds }) => {
    const { job: initialJob } = await createAndStartJob({
      goal,
      cwd,
      acceptance,
      supervisor_brief,
      timeout_minutes,
      max_attempts,
    });

    const deadline = Date.now() + wait_seconds * 1_000;
    let job = initialJob;
    while (!TERMINAL_STATUSES.has(job.status) && Date.now() < deadline) {
      await sleep(Math.min(500, Math.max(1, deadline - Date.now())));
      try {
        job = await readJob(initialJob.id);
      } catch (error: unknown) {
        if (Date.now() >= deadline) {
          throw error;
        }
      }
    }

    if (TERMINAL_STATUSES.has(job.status)) {
      return toolResult(job, `OMP task ${job.id} reached terminal status: ${job.status}.`);
    }
    return toolResult(
      job,
      `OMP task ${job.id} is still running after ${wait_seconds}s. Use omp_wait to continue waiting.`,
    );
  },
);

server.registerTool(
  "omp_delegate",
  {
    title: "Delegate Complete Task to OMP (Low-level)",
    description:
      "Low-level background delegation entrypoint. Transfers ownership of an execution task to OMP and returns immediately with job_id. Prefer omp_run_compact for standard workflows to avoid separate delegate/wait round trips.",
    inputSchema: {
      goal: z.string().min(1).max(20_000).describe("Complete natural-language outcome OMP must deliver"),
      cwd: z.string().min(1).describe("Absolute working directory OMP may inspect and modify"),
      acceptance: z.array(z.string().min(1).max(2_000)).max(20).default([]),
      supervisor_brief: z
        .string()
        .max(12_000)
        .optional()
        .describe("Decision-ready read-only findings, hypotheses, constraints, and recommended direction"),
      timeout_minutes: z.number().int().min(1).max(120).default(30),
      max_attempts: z.number().int().min(1).max(5).default(3),
    },
    outputSchema: statusOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ goal, cwd, acceptance, supervisor_brief, timeout_minutes, max_attempts }) => {
    const { job } = await createAndStartJob({
      goal,
      cwd,
      acceptance,
      supervisor_brief,
      timeout_minutes,
      max_attempts,
    });
    return toolResult(job, `OMP task accepted as ${job.id}. Use omp_wait to wait for completion.`);
  },
);

server.registerTool(
  "omp_cancel",
  {
    title: "Stop OMP Task",
    description:
      "Request immediate cancellation of one exact delegated OMP job. The detached runner owns the OMP child PID and terminates that process tree safely. Call this immediately when the user asks to stop; do not inspect PIDs or manually kill processes first.",
    inputSchema: {
      job_id: z.string().min(1),
      reason: z.string().min(1).max(2_000).default("Cancelled at the user's request"),
    },
    outputSchema: statusOutput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ job_id, reason }) => {
    let job = await readJob(job_id);
    if (TERMINAL_STATUSES.has(job.status)) {
      return toolResult(job, `OMP task ${job_id} is already ${job.status}.`);
    }
    const attempt = job.attempts.find((item) => item.number === job.currentAttempt);
    if (!attempt) throw new Error(`Attempt ${job.currentAttempt} is missing`);
    const previousJobStatus = job.status;
    const previousAttemptStatus = attempt.status;
    const requestedAt = new Date().toISOString();
    job.status = "cancelling";
    job.cancelRequestedAt = requestedAt;
    job.cancelReason = reason;
    attempt.status = "cancelling";
    attempt.cancelRequestedAt = requestedAt;
    await writeJob(job);
    try {
      await writeCancellationRequest(job_id, reason);
    } catch (error) {
      job = await readJob(job_id);
      if (job.status === "cancelling") {
        job.status = previousJobStatus;
        const current = job.attempts.find((item) => item.number === job.currentAttempt);
        if (current?.status === "cancelling") current.status = previousAttemptStatus;
        job.cancelRequestedAt = undefined;
        job.cancelReason = undefined;
        await writeJob(job);
      }
      throw error;
    }
    return toolResult(job, `Cancellation requested for OMP task ${job_id}.`);
  },
);

server.registerTool(
  "omp_wait",
  {
    title: "Wait for OMP Task",
    description:
      "Wait for an existing OMP job to reach a terminal status, polling up to wait_seconds (default 30s, max 60s). Returns the current status and summary once terminal or when the wait deadline elapses. Avoid polling in a tight loop.",
    inputSchema: {
      job_id: z.string().min(1),
      wait_seconds: z.number().int().min(1).max(60).default(30),
    },
    outputSchema: statusOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ job_id, wait_seconds }) => {
    const deadline = Date.now() + wait_seconds * 1_000;
    let job = await readJob(job_id);
    while (!TERMINAL_STATUSES.has(job.status) && Date.now() < deadline) {
      await sleep(Math.min(500, Math.max(1, deadline - Date.now())));
      try {
        job = await readJob(job_id);
      } catch (error: unknown) {
        if (Date.now() >= deadline) throw error;
      }
    }
    return toolResult(job);
  },
);

server.registerTool(
  "omp_result",
  {
    title: "Inspect Complete OMP Task Result",
    description:
      "Retrieve full details of a terminal OMP job, including finalResponse and attempt logs. Call this only when minimal acceptance check fails, high-risk operations occurred, or the user explicitly asks for full inspection; do not call this after every successful compact run.",
    inputSchema: { job_id: z.string().min(1) },
    outputSchema: {
      job_id: z.string(),
      status: z.string(),
      attempt: z.number().int(),
      max_attempts: z.number().int(),
      session_id: z.string().optional(),
      goal: z.string(),
      cwd: z.string(),
      summary: z.string().optional(),
      artifacts: z.array(artifactSchema),
      verification: z.array(z.string()),
      remaining: z.array(z.string()),
      final_response: z.string().optional(),
      error: z.string().optional(),
      details_path: z.string(),
      attempts: z.array(
        z.object({
          number: z.number().int(),
          kind: z.string(),
          status: z.string(),
          stdout_path: z.string(),
          stderr_path: z.string(),
          exit_code: z.number().int().nullable().optional(),
          error: z.string().optional(),
        }),
      ),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ job_id }) => {
    const job = await readJob(job_id);
    const structuredContent = {
      job_id: job.id,
      status: job.status,
      attempt: job.currentAttempt,
      max_attempts: job.maxAttempts,
      session_id: job.sessionId,
      goal: job.goal,
      cwd: job.cwd,
      summary: job.summary,
      artifacts: job.artifacts,
      verification: job.verification,
      remaining: job.remaining,
      final_response: job.finalResponse,
      error: job.error,
      details_path: jobFilePath(job.id),
      attempts: job.attempts.map((attempt) => ({
        number: attempt.number,
        kind: attempt.kind,
        status: attempt.status,
        stdout_path: attempt.stdoutPath,
        stderr_path: attempt.stderrPath,
        exit_code: attempt.exitCode ?? null,
        error: attempt.error,
      })),
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  },
);

server.registerTool(
  "omp_continue",
  {
    title: "Send Supervisory Feedback to Same OMP Session",
    description:
      "Resume the same OMP session with targeted supervisory feedback to correct specific acceptance defects without starting a fresh task from scratch. Bounded to remaining attempts within max_attempts.",
    inputSchema: {
      job_id: z.string().min(1),
      feedback: z
        .string()
        .min(1)
        .max(12_000)
        .describe("Specific defect, evidence, intended correction, and success check"),
      timeout_minutes: z.number().int().min(1).max(120).default(30),
    },
    outputSchema: statusOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ job_id, feedback, timeout_minutes }) => {
    const job = await readJob(job_id);
    if (!job.sessionId) {
      throw new Error(`Job ${job_id} does not have a recorded sessionId to continue`);
    }
    if (job.currentAttempt >= job.maxAttempts) {
      throw new Error(`Job ${job_id} has reached its attempt budget (${job.maxAttempts})`);
    }
    const nextNumber = job.currentAttempt + 1;
    const directory = await ensureJobDirectory(job.id);
    const promptPath = await writePrompt(job.id, nextNumber, buildContinuePrompt(job, feedback));
    const paths = attemptPaths(directory, nextNumber);
    const attempt: JobAttempt = {
      number: nextNumber,
      kind: "continue",
      status: "queued",
      promptPath,
      timeoutMinutes: timeout_minutes,
      feedback,
      ...paths,
    };
    job.currentAttempt = nextNumber;
    job.status = "queued";
    job.error = undefined;
    job.attempts.push(attempt);
    await clearCancellationRequest(job.id);
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
    return toolResult(
      job,
      `Supervisory feedback dispatched to OMP session ${job.sessionId} as attempt ${nextNumber}.`,
    );
  },
);

if (process.env.OMP_WORKER_AUTO_CLEANUP_ON_START === "true" || process.env.OMP_WORKER_AUTO_CLEANUP_ON_START === "1") {
  const envOpts = getRetentionOptionsFromEnv();
  if (envOpts.ttlSeconds || envOpts.maxBytes) {
    cleanState(envOpts)
      .then((res: StateCleanupResult) => {
        if (res.errors.length > 0) {
          for (const err of res.errors) {
            process.stderr.write(`[state-cleanup warning] ${err.path}: ${err.error}\n`);
          }
        }
      })
      .catch((err: unknown) => {
        process.stderr.write(
          `[state-cleanup startup error] ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
