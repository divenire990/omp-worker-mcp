import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const ALLOWED_ROOTS_ENV = "OMP_WORKER_ALLOWED_ROOTS";

function normalizeForComparison(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInsideRoot(target: string, root: string): boolean {
  const normalizedTarget = normalizeForComparison(target);
  const normalizedRoot = normalizeForComparison(root);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function resolveExistingDirectory(value: string, label: string): Promise<string> {
  if (!path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path: ${value}`);
  }

  const resolved = path.resolve(value);
  const info = await stat(resolved).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error(`${label} does not exist: ${resolved}`);
    throw error;
  });
  if (!info.isDirectory()) {
    throw new Error(`${label} is not a directory: ${resolved}`);
  }

  return realpath(resolved);
}

export function parseAllowedRoots(raw = process.env[ALLOWED_ROOTS_ENV]): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim() === "") {
    throw new Error(`${ALLOWED_ROOTS_ENV} must be a non-empty JSON array of absolute directory paths`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${ALLOWED_ROOTS_ENV} must be a JSON array of absolute directory paths`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`${ALLOWED_ROOTS_ENV} must be a non-empty JSON array of absolute directory paths`);
  }

  return parsed.map((item) => item.trim());
}

export async function resolveAllowedRoots(raw = process.env[ALLOWED_ROOTS_ENV]): Promise<string[] | undefined> {
  const configured = parseAllowedRoots(raw);
  if (!configured) return undefined;

  const roots: string[] = [];
  for (const configuredRoot of configured) {
    roots.push(await resolveExistingDirectory(configuredRoot, `${ALLOWED_ROOTS_ENV} entry`));
  }
  return roots;
}

export async function validateAllowedWorkingDirectory(
  cwd: string,
  raw = process.env[ALLOWED_ROOTS_ENV],
): Promise<string> {
  const resolvedCwd = await resolveExistingDirectory(cwd, "cwd");
  const allowedRoots = await resolveAllowedRoots(raw);

  if (!allowedRoots) return resolvedCwd;
  if (allowedRoots.some((root) => isInsideRoot(resolvedCwd, root))) return resolvedCwd;

  throw new Error(
    `cwd is outside OMP_WORKER_ALLOWED_ROOTS: ${resolvedCwd}. Allowed roots: ${allowedRoots.join(", ")}`,
  );
}
