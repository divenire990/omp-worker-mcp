import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CancellationRequest, GroupCancellationRequest, GroupRecord, JobRecord } from "./types.js";

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
  return path.join(stateRoot(), "jobs", jobId);
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
  record.updatedAt = new Date().toISOString();
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
  return path.join(stateRoot(), "groups", groupId);
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
  record.updatedAt = new Date().toISOString();
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
