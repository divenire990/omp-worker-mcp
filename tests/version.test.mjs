import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DEFAULT_PACKAGE_JSON_PATH, PACKAGE_VERSION, readPackageVersion } from "../dist/version.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");

test("single-source version matches package.json and package-lock.json", async () => {
  const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(projectRoot, "package-lock.json"), "utf8"));

  assert.equal(DEFAULT_PACKAGE_JSON_PATH, path.join(projectRoot, "package.json"));
  assert.equal(PACKAGE_VERSION, pkg.version);
  assert.equal(readPackageVersion(), pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages?.[""]?.version, pkg.version);
});

test("readPackageVersion accepts legitimate 1.0.0 and arbitrary versions while rejecting missing or invalid fields", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "omp-worker-version-test-"));
  try {
    const v1Path = path.join(tempDir, "v1-package.json");
    await writeFile(v1Path, JSON.stringify({ name: "omp-worker-mcp", version: "1.0.0" }), "utf8");
    assert.equal(readPackageVersion(v1Path), "1.0.0");

    const validPath = path.join(tempDir, "valid-package.json");
    await writeFile(validPath, JSON.stringify({ name: "omp-worker-mcp", version: " 2.3.4 \n" }), "utf8");
    assert.equal(readPackageVersion(validPath), "2.3.4");
    const missingVersionPath = path.join(tempDir, "missing-version.json");
    await writeFile(missingVersionPath, JSON.stringify({ name: "omp-worker-mcp" }), "utf8");
    assert.throws(() => readPackageVersion(missingVersionPath), /Invalid or missing "version" field/);

    const emptyVersionPath = path.join(tempDir, "empty-version.json");
    await writeFile(emptyVersionPath, JSON.stringify({ name: "omp-worker-mcp", version: "   " }), "utf8");
    assert.throws(() => readPackageVersion(emptyVersionPath), /Invalid or missing "version" field/);

    const nonStringVersionPath = path.join(tempDir, "non-string-version.json");
    await writeFile(nonStringVersionPath, JSON.stringify({ name: "omp-worker-mcp", version: 100 }), "utf8");
    assert.throws(() => readPackageVersion(nonStringVersionPath), /Invalid or missing "version" field/);

    const nonExistentPath = path.join(tempDir, "does-not-exist.json");
    assert.throws(() => readPackageVersion(nonExistentPath));
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("CLI bin --version and MCP initialize serverInfo report package.json version", async () => {
  const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const binPath = path.join(projectRoot, "bin", "omp-worker-mcp.mjs");

  const { stdout: longFlagOut } = await execFileAsync(process.execPath, [binPath, "--version"]);
  assert.equal(longFlagOut.trim(), pkg.version);

  const { stdout: shortFlagOut } = await execFileAsync(process.execPath, [binPath, "-v"]);
  assert.equal(shortFlagOut.trim(), pkg.version);

  const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-version-mcp-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binPath],
    env: {
      ...process.env,
      OMP_WORKER_STATE_DIR: stateRoot,
      OMP_WORKER_OMP_COMMAND: process.execPath,
      OMP_WORKER_OMP_PREFIX_ARGS: JSON.stringify([path.join(projectRoot, "tests", "fake-omp.mjs")]),
    },
  });
  const client = new Client({ name: "omp-worker-version-client", version: "0.0.1" });
  await client.connect(transport);
  try {
    assert.deepEqual(client.getServerVersion(), {
      name: "omp-worker",
      version: pkg.version,
    });
  } finally {
    await client.close();
    await rm(stateRoot, { recursive: true, force: true }).catch(() => {});
  }
});
