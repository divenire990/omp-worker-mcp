export type JobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "blocked"
  | "awaiting_review"
  | "failed"
  | "timed_out";

export type BatchTaskAccess = "read_only" | "write";

export type BatchTaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked";

export type GroupStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "partial"
  | "failed"
  | "timed_out"
  | "cancelled";

export const GROUP_TERMINAL_STATUSES: ReadonlySet<GroupStatus> = new Set([
  "completed",
  "partial",
  "failed",
  "timed_out",
  "cancelled",
]);

export interface CancellationRequest {
  requestedAt: string;
  reason: string;
}

export type GroupCancellationRequest = CancellationRequest;

export interface Artifact {
  path: string;
  description: string;
}

export interface WorkerEnvelope {
  status: "completed" | "blocked";
  summary: string;
  artifacts: Artifact[];
  verification: string[];
  remaining: string[];
}

export interface JobAttempt {
  number: number;
  kind: "delegate" | "continue";
  status: JobStatus;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  timeoutMinutes: number;
  feedback?: string;
  runnerPid?: number;
  ompPid?: number;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  error?: string;
  finalResponse?: string;
  cancelRequestedAt?: string;
  cancelledAt?: string;
}

export interface JobRecord {
  version: 1;
  id: string;
  status: JobStatus;
  goal: string;
  supervisorBrief?: string;
  cwd: string;
  acceptance: string[];
  maxAttempts: number;
  currentAttempt: number;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  summary?: string;
  artifacts: Artifact[];
  verification: string[];
  remaining: string[];
  finalResponse?: string;
  error?: string;
  cancelRequestedAt?: string;
  cancelReason?: string;
  attempts: JobAttempt[];
  groupId?: string;
  groupTaskId?: string;
  access?: BatchTaskAccess;
  ownership?: string[];
}

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  "completed",
  "cancelled",
  "blocked",
  "awaiting_review",
  "failed",
  "timed_out",
]);

export interface BatchTaskInput {
  id: string;
  goal: string;
  acceptance?: string[];
  depends_on?: string[];
  access?: BatchTaskAccess;
  ownership?: string[];
  timeout_minutes?: number;
  max_attempts?: number;
}

export interface BatchTaskRecord {
  id: string;
  status: BatchTaskStatus;
  jobId?: string;
  goal: string;
  acceptance: string[];
  dependsOn: string[];
  access: BatchTaskAccess;
  ownership: string[];
  timeoutMinutes: number;
  maxAttempts: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface GroupRecord {
  version: 1;
  id: string;
  status: GroupStatus;
  cwd: string;
  maxParallel: number;
  groupTimeoutMinutes: number;
  supervisorBrief?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  coordinatorPid?: number;
  runnerPid?: number;
  cancelRequestedAt?: string;
  cancelReason?: string;
  summary?: string;
  tasks: BatchTaskRecord[];
  error?: string;
}

export interface CompactBatchTaskResult {
  [key: string]: unknown;
  id: string;
  status: "completed" | "failed" | "cancelled" | "timed_out" | "blocked";
  job_id?: string;
  summary?: string;
  artifacts: Artifact[];
  verification: string[];
  remaining: string[];
  error?: string;
  details_path?: string;
}

export interface CompactGroupResult {
  [key: string]: unknown;
  group_id: string;
  status: GroupStatus;
  max_parallel: number;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  cancelled_tasks: number;
  blocked_tasks: number;
  summary: string;
  tasks?: CompactBatchTaskResult[];
}
