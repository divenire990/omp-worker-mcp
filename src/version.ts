import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PACKAGE_JSON_PATH = path.resolve(__dirname, "..", "package.json");

export function readPackageVersion(packageJsonPath: string = DEFAULT_PACKAGE_JSON_PATH): string {
  const raw = readFileSync(packageJsonPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string" ||
    parsed.version.trim().length === 0
  ) {
    throw new Error(`Invalid or missing "version" field in ${packageJsonPath}`);
  }
  return parsed.version.trim();
}

export const PACKAGE_VERSION = readPackageVersion();
