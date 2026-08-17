import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  GROUP_TERMINAL_STATUSES,
  TERMINAL_STATUSES,
  type CancellationRequest,
  type CleanupError,
  type CleanupItemResult,
  type GroupCancellationRequest,
  type GroupRecord,
  type JobRecord,
  type StateCleanupResult,
  type StateRetentionOptions,
} from "./types.js";

const JOB_ID_PATTERN = /^job-[0-9]+-[a-f0-9]{8}$/;
const GROUP_ID_PATTERN = /^group-[0-9]+-[a-f0-9]{8}$/;

export function stateRoot(): string {
  return process.env.OMP_WORKER_STATE_DIR
    ? path.resolve(process.env.OMP_WORKER_STATE_DIR)
    : path.join(homedir(), ".codex", "state", "omp-worker");
}

export function createJobId(): string {
  return `job-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

export function validateJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`Invalid job_id: ${jobId}`);
  }
}

export function jobDirectory(jobId: string): string {
  validateJobId(jobId);
  const root = path.resolve(stateRoot(), "jobs");
  const target = path.resolve(root, jobId);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel !== jobId) {
    throw new Error(`Path traversal detected for job_id: ${jobId}`);
  }
  return target;
}

export function jobFilePath(jobId: string): string {
  return path.join(jobDirectory(jobId), "job.json");
}

export function cancellationFilePath(jobId: string): string {
  return path.join(jobDirectory(jobId), "cancel.request.json");
}

export async function ensureJobDirectory(jobId: string): Promise<string> {
  const directory = jobDirectory(jobId);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function readJob(jobId: string): Promise<JobRecord> {
  const content = await readFile(jobFilePath(jobId), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error(`Unknown job_id: ${jobId}`);
    }
    throw error;
  });
  return JSON.parse(content) as JobRecord;
}

async function writeAtomicFile(target: string, content: string): Promise<void> {
  const temp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, content, "utf8");
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(temp, target);
      return;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EBUSY") {
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      await rm(target, { force: true }).catch(() => {});
      if (attempt === 4) {
        try {
          await rename(temp, target);
          return;
        } catch {
          await writeFile(target, content, "utf8");
          await rm(temp, { force: true }).catch(() => {});
          return;
        }
      }
    }
    await delay(10 * (attempt + 1));
  }
}

export async function writeJob(record: JobRecord): Promise<void> {
  validateJobId(record.id);
  if (!record.updatedAt) {
    record.updatedAt = new Date().toISOString();
  }
  const target = jobFilePath(record.id);
  await writeAtomicFile(target, `${JSON.stringify(record, null, 2)}\n`);
}

export async function writePrompt(jobId: string, attempt: number, content: string): Promise<string> {
  const target = path.join(jobDirectory(jobId), `attempt-${String(attempt).padStart(2, "0")}.prompt.md`);
  await writeFile(target, content, "utf8");
  return target;
}

export async function writeCancellationRequest(jobId: string, reason: string): Promise<void> {
  validateJobId(jobId);
  const target = cancellationFilePath(jobId);
  await writeFile(
    target,
    `${JSON.stringify({ requestedAt: new Date().toISOString(), reason }, null, 2)}\n`,
    "utf8",
  );
}

export async function readCancellationRequest(jobId: string): Promise<CancellationRequest | null> {
  validateJobId(jobId);
  try {
    const content = await readFile(cancellationFilePath(jobId), "utf8");
    return JSON.parse(content) as CancellationRequest;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function hasCancellationRequest(jobId: string): Promise<boolean> {
  validateJobId(jobId);
  try {
    await readFile(cancellationFilePath(jobId), "utf8");
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function clearCancellationRequest(jobId: string): Promise<void> {
  validateJobId(jobId);
  await rm(cancellationFilePath(jobId), { force: true });
}

export function createGroupId(): string {
  return `group-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

export function validateGroupId(groupId: string): void {
  if (!GROUP_ID_PATTERN.test(groupId)) {
    throw new Error(`Invalid group_id: ${groupId}`);
  }
}

export function groupDirectory(groupId: string): string {
  validateGroupId(groupId);
  const root = path.resolve(stateRoot(), "groups");
  const target = path.resolve(root, groupId);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel !== groupId) {
    throw new Error(`Path traversal detected for group_id: ${groupId}`);
  }
  return target;
}

export function groupFilePath(groupId: string): string {
  return path.join(groupDirectory(groupId), "group.json");
}

export function groupCancellationFilePath(groupId: string): string {
  return path.join(groupDirectory(groupId), "cancel.request.json");
}

export async function ensureGroupDirectory(groupId: string): Promise<string> {
  const directory = groupDirectory(groupId);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function readGroup(groupId: string): Promise<GroupRecord> {
  const content = await readFile(groupFilePath(groupId), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error(`Unknown group_id: ${groupId}`);
    }
    throw error;
  });
  return JSON.parse(content) as GroupRecord;
}

export async function writeGroup(record: GroupRecord): Promise<void> {
  validateGroupId(record.id);
  if (!record.updatedAt) {
    record.updatedAt = new Date().toISOString();
  }
  const target = groupFilePath(record.id);
  await writeAtomicFile(target, `${JSON.stringify(record, null, 2)}\n`);
}

export async function writeGroupCancellationRequest(groupId: string, reason: string): Promise<void> {
  validateGroupId(groupId);
  const target = groupCancellationFilePath(groupId);
  await writeFile(
    target,
    `${JSON.stringify({ requestedAt: new Date().toISOString(), reason }, null, 2)}\n`,
    "utf8",
  );
}

export async function readGroupCancellationRequest(groupId: string): Promise<GroupCancellationRequest | null> {
  validateGroupId(groupId);
  try {
    const content = await readFile(groupCancellationFilePath(groupId), "utf8");
    return JSON.parse(content) as GroupCancellationRequest;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function hasGroupCancellationRequest(groupId: string): Promise<boolean> {
  validateGroupId(groupId);
  try {
    await readFile(groupCancellationFilePath(groupId), "utf8");
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function clearGroupCancellationRequest(groupId: string): Promise<void> {
  validateGroupId(groupId);
  await rm(groupCancellationFilePath(groupId), { force: true });
}

export async function calculateDirectorySize(dirPath: string): Promise<number> {
  let totalBytes = 0;
  try {
    const stats = await lstat(dirPath);
    if (stats.isSymbolicLink()) {
      return 0;
    }
    if (!stats.isDirectory()) {
      return stats.size;
    }
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        totalBytes += await calculateDirectorySize(fullPath);
      } else if (entry.isFile()) {
        try {
          const fileStat = await lstat(fullPath);
          totalBytes += fileStat.size;
        } catch {
          // ignore concurrent file deletion
        }
      }
    }
  } catch {
    return 0;
  }
  return totalBytes;
}

export function getRetentionOptionsFromEnv(): StateRetentionOptions {
  const ttlEnv = process.env.OMP_WORKER_RETENTION_TTL_SECONDS;
  const maxBytesEnv = process.env.OMP_WORKER_RETENTION_MAX_BYTES;
  const ttlSeconds = ttlEnv && !Number.isNaN(Number(ttlEnv)) && Number(ttlEnv) > 0 ? Number(ttlEnv) : undefined;
  const maxBytes = maxBytesEnv && !Number.isNaN(Number(maxBytesEnv)) && Number(maxBytesEnv) > 0 ? Number(maxBytesEnv) : undefined;
  return { ttlSeconds, maxBytes };
}

interface ScannedEntry {
  id: string;
  type: "job" | "group";
  directory: string;
  bytes: number;
  isTerminal: boolean;
  timestamp: number;
  updatedAt: string;
}

export async function cleanState(options?: StateRetentionOptions): Promise<StateCleanupResult> {
  const ttlSeconds = options?.ttlSeconds;
  const maxBytes = options?.maxBytes;
  const dryRun = options?.dryRun ?? false;

  const jobsRoot = path.resolve(stateRoot(), "jobs");
  const groupsRoot = path.resolve(stateRoot(), "groups");

  const scanned: ScannedEntry[] = [];
  const errors: CleanupError[] = [];

  // 1. Scan Jobs
  try {
    const jobDirents = await readdir(jobsRoot, { withFileTypes: true });
    for (const dirent of jobDirents) {
      const dirName = dirent.name;
      const fullPath = path.join(jobsRoot, dirName);
      if (dirent.isSymbolicLink()) {
        errors.push({
          id: dirName,
          type: "job",
          path: fullPath,
          error: "Symbolic links in state directory are rejected and not followed",
        });
        continue;
      }
      if (!JOB_ID_PATTERN.test(dirName)) {
        errors.push({
          id: dirName,
          type: "job",
          path: fullPath,
          error: `Invalid job directory name: ${dirName}`,
        });
        continue;
      }
      try {
        const stat = await lstat(fullPath);
        if (stat.isSymbolicLink()) {
          errors.push({
            id: dirName,
            type: "job",
            path: fullPath,
            error: "Symbolic links in state directory are rejected and not followed",
          });
          continue;
        }
        if (!stat.isDirectory()) {
          continue;
        }
      } catch (err: unknown) {
        errors.push({
          id: dirName,
          type: "job",
          path: fullPath,
          error: `Cannot stat job directory: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      let record: JobRecord | null = null;
      const jsonFile = path.join(fullPath, "job.json");
      try {
        const content = await readFile(jsonFile, "utf8");
        record = JSON.parse(content) as JobRecord;
      } catch (err: unknown) {
        errors.push({
          id: dirName,
          type: "job",
          path: fullPath,
          error: `Corrupted or unreadable job.json: ${err instanceof Error ? err.message : String(err)}`,
        });
        // Corrupted records cannot be confirmed terminal, protect from deletion
        continue;
      }

      const isTerminal = TERMINAL_STATUSES.has(record.status);
      const timeStr = record.completedAt || record.updatedAt || record.createdAt || new Date(0).toISOString();
      let timestamp = new Date(timeStr).getTime();
      if (Number.isNaN(timestamp) || timestamp <= 0) {
        timestamp = Date.now();
      }
      const bytes = await calculateDirectorySize(fullPath);
      scanned.push({
        id: record.id,
        type: "job",
        directory: fullPath,
        bytes,
        isTerminal,
        timestamp,
        updatedAt: timeStr,
      });
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      errors.push({
        path: jobsRoot,
        error: `Failed to read jobs directory: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 2. Scan Groups
  try {
    const groupDirents = await readdir(groupsRoot, { withFileTypes: true });
    for (const dirent of groupDirents) {
      const dirName = dirent.name;
      const fullPath = path.join(groupsRoot, dirName);
      if (dirent.isSymbolicLink()) {
        errors.push({
          id: dirName,
          type: "group",
          path: fullPath,
          error: "Symbolic links in state directory are rejected and not followed",
        });
        continue;
      }
      if (!GROUP_ID_PATTERN.test(dirName)) {
        errors.push({
          id: dirName,
          type: "group",
          path: fullPath,
          error: `Invalid group directory name: ${dirName}`,
        });
        continue;
      }
      try {
        const stat = await lstat(fullPath);
        if (stat.isSymbolicLink()) {
          errors.push({
            id: dirName,
            type: "group",
            path: fullPath,
            error: "Symbolic links in state directory are rejected and not followed",
          });
          continue;
        }
        if (!stat.isDirectory()) {
          continue;
        }
      } catch (err: unknown) {
        errors.push({
          id: dirName,
          type: "group",
          path: fullPath,
          error: `Cannot stat group directory: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      let record: GroupRecord | null = null;
      const jsonFile = path.join(fullPath, "group.json");
      try {
        const content = await readFile(jsonFile, "utf8");
        record = JSON.parse(content) as GroupRecord;
      } catch (err: unknown) {
        errors.push({
          id: dirName,
          type: "group",
          path: fullPath,
          error: `Corrupted or unreadable group.json: ${err instanceof Error ? err.message : String(err)}`,
        });
        // Corrupted records cannot be confirmed terminal, protect from deletion
        continue;
      }

      const isTerminal = GROUP_TERMINAL_STATUSES.has(record.status);
      const timeStr = record.completedAt || record.updatedAt || record.createdAt || new Date(0).toISOString();
      let timestamp = new Date(timeStr).getTime();
      if (Number.isNaN(timestamp) || timestamp <= 0) {
        timestamp = Date.now();
      }
      const bytes = await calculateDirectorySize(fullPath);
      scanned.push({
        id: record.id,
        type: "group",
        directory: fullPath,
        bytes,
        isTerminal,
        timestamp,
        updatedAt: timeStr,
      });
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      errors.push({
        path: groupsRoot,
        error: `Failed to read groups directory: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const totalBytes = scanned.reduce((acc, item) => acc + item.bytes, 0);
  const retainedJobsCount = scanned.filter((item) => item.type === "job").length;
  const retainedGroupsCount = scanned.filter((item) => item.type === "group").length;

  // Safe default: If neither TTL nor maxBytes is configured, do not delete anything
  if ((ttlSeconds === undefined || ttlSeconds <= 0) && (maxBytes === undefined || maxBytes <= 0)) {
    return {
      cleanedJobs: 0,
      cleanedGroups: 0,
      freedBytes: 0,
      retainedJobs: retainedJobsCount,
      retainedGroups: retainedGroupsCount,
      totalBytes,
      dryRun,
      items: [],
      errors,
    };
  }

  const toDelete = new Map<string, { entry: ScannedEntry; reason: string }>();

  // Policy 1: TTL on terminal entries
  if (ttlSeconds !== undefined && ttlSeconds > 0) {
    const cutoff = Date.now() - ttlSeconds * 1000;
    for (const entry of scanned) {
      if (entry.isTerminal && entry.timestamp <= cutoff) {
        toDelete.set(entry.directory, {
          entry,
          reason: `Expired by TTL (${ttlSeconds}s)`,
        });
      }
    }
  }

  // Policy 2: Max bytes on remaining terminal entries (LRU/oldest first)
  if (maxBytes !== undefined && maxBytes > 0) {
    let currentBytes = scanned.reduce((sum, item) => {
      return toDelete.has(item.directory) ? sum : sum + item.bytes;
    }, 0);

    if (currentBytes > maxBytes) {
      const candidates = scanned
        .filter((item) => item.isTerminal && !toDelete.has(item.directory))
        .sort((a, b) => a.timestamp - b.timestamp);

      for (const entry of candidates) {
        if (currentBytes <= maxBytes) break;
        toDelete.set(entry.directory, {
          entry,
          reason: `Exceeded max bytes limit (${maxBytes} bytes)`,
        });
        currentBytes -= entry.bytes;
      }
    }
  }

  const items: CleanupItemResult[] = [];
  let freedBytes = 0;
  let cleanedJobs = 0;
  let cleanedGroups = 0;

  for (const { entry, reason } of toDelete.values()) {
    // Strict safety guard before deletion: ensure path is within jobsRoot or groupsRoot
    const resolved = path.resolve(entry.directory);
    const isSafeJob = resolved.startsWith(jobsRoot) && resolved !== jobsRoot;
    const isSafeGroup = resolved.startsWith(groupsRoot) && resolved !== groupsRoot;
    if (!isSafeJob && !isSafeGroup) {
      errors.push({
        id: entry.id,
        type: entry.type,
        path: entry.directory,
        error: `Path traversal violation during cleanup: ${entry.directory}`,
      });
      continue;
    }

    // Double check it's not a symlink
    try {
      const st = await lstat(resolved);
      if (st.isSymbolicLink()) {
        errors.push({
          id: entry.id,
          type: entry.type,
          path: resolved,
          error: "Refusing to delete symlink during state cleanup",
        });
        continue;
      }
    } catch (err: unknown) {
      errors.push({
        id: entry.id,
        type: entry.type,
        path: resolved,
        error: `Failed to verify directory before deletion: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    let deleted = false;
    if (dryRun) {
      deleted = false;
    } else {
      try {
        await rm(resolved, { recursive: true, force: true });
        deleted = true;
      } catch (err: unknown) {
        errors.push({
          id: entry.id,
          type: entry.type,
          path: resolved,
          error: `Failed to remove directory: ${err instanceof Error ? err.message : String(err)}`,
        });
        deleted = false;
      }
    }

    if (deleted || dryRun) {
      if (entry.type === "job") cleanedJobs++;
      if (entry.type === "group") cleanedGroups++;
      freedBytes += entry.bytes;
    }

    items.push({
      id: entry.id,
      type: entry.type,
      path: entry.directory,
      bytes: entry.bytes,
      updatedAt: entry.updatedAt,
      deleted,
      reason,
    });
  }

  return {
    cleanedJobs,
    cleanedGroups,
    freedBytes,
    retainedJobs: retainedJobsCount - (dryRun ? 0 : cleanedJobs),
    retainedGroups: retainedGroupsCount - (dryRun ? 0 : cleanedGroups),
    totalBytes: totalBytes - (dryRun ? 0 : freedBytes),
    dryRun,
    items,
    errors,
  };
}
