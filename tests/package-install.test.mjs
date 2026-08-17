import assert from "node:assert/strict";
import { exec, execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

test("package.json metadata satisfies publishing and Node >=22 constraints", async () => {
  const pkgContent = await readFile(path.join(projectRoot, "package.json"), "utf8");
  const pkg = JSON.parse(pkgContent);

  assert.equal(pkg.name, "omp-worker-mcp");
  assert.equal(pkg.type, "module");
  assert.ok(pkg.version, "version should be defined");
  assert.equal(pkg.license, "MIT");
  assert.ok(pkg.repository && pkg.repository.url, "repository url should be defined");
  assert.ok(!pkg.repository.url.includes("undefined"), "repository url should be valid");
  assert.equal(pkg.bin["omp-worker-mcp"], "./bin/omp-worker-mcp.mjs");
  assert.equal(pkg.exports["."], "./dist/index.js");
  assert.equal(pkg.engines?.node, ">=22");
  assert.ok(Array.isArray(pkg.files), "files should be an array");
  assert.ok(pkg.files.includes("dist"));
  assert.ok(pkg.files.includes("bin"));
  assert.ok(pkg.files.includes("README.md"));
  assert.ok(pkg.files.includes("LICENSE"));
});

test("npm pack includes dist and bin and excludes src, tests, and dev configs", async () => {
  const { stdout } = await execAsync(`"${npmCmd}" pack --dry-run --json`, {
    cwd: projectRoot,
  });

  const packData = JSON.parse(stdout);
  assert.ok(Array.isArray(packData) && packData.length > 0, "packData should be non-empty array");

  const files = packData[0].files.map((f) => f.path);

  // Must contain build outputs, entry points, and required package assets
  assert.ok(files.some((f) => f === "dist/index.js" || f.startsWith("dist/")), "dist output must be included");
  assert.ok(files.some((f) => f === "bin/omp-worker-mcp.mjs"), "bin/omp-worker-mcp.mjs must be included");
  assert.ok(files.some((f) => f === "package.json"), "package.json must be included");
  assert.ok(files.some((f) => f === "README.md"), "README.md must be included");
  assert.ok(files.some((f) => f === "LICENSE"), "LICENSE must be included");

  // Must NOT contain source files, test suites, node_modules, or development configs
  const forbiddenPrefixes = ["src/", "tests/", "node_modules/", "assets/", "scripts/"];
  const forbiddenFiles = ["tsconfig.json", ".gitignore", ".env.example", ".npmignore"];

  for (const file of files) {
    for (const prefix of forbiddenPrefixes) {
      assert.ok(!file.startsWith(prefix), `Packed file "${file}" must not start with "${prefix}"`);
    }
    for (const forbidden of forbiddenFiles) {
      assert.notEqual(file, forbidden, `Packed file list must not contain "${forbidden}"`);
    }
  }
});

test("npm pack, install into isolated directory, and execute bin entry", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "omp-worker-pack-test-"));

  try {
    // 1. Pack the package to a tarball in temp directory
    const { stdout: packStdout } = await execAsync(`"${npmCmd}" pack --pack-destination "${tempDir}"`, {
      cwd: projectRoot,
    });

    const tarballFileName = packStdout.trim().split(/\r?\n/).pop().trim();
    const tarballPath = path.join(tempDir, tarballFileName);

    // 2. Initialize a dummy consumer project in another temp folder
    const consumerDir = await mkdtemp(path.join(tmpdir(), "omp-worker-consumer-"));

    try {
      await execAsync(`"${npmCmd}" init -y`, { cwd: consumerDir });
      await execAsync(`"${npmCmd}" install "${tarballPath}"`, { cwd: consumerDir });

      const binScriptPath = path.join(consumerDir, "node_modules", "omp-worker-mcp", "bin", "omp-worker-mcp.mjs");

      // 3. Test bin --help
      const { stdout: helpOut } = await execFileAsync(process.execPath, [binScriptPath, "--help"]);
      assert.ok(helpOut.includes("omp-worker-mcp"), "help output should mention tool name");
      assert.ok(helpOut.includes("--help"), "help output should describe help option");

      // 4. Test bin -h
      const { stdout: helpShortOut } = await execFileAsync(process.execPath, [binScriptPath, "-h"]);
      assert.ok(helpShortOut.includes("Usage:"), "help output should include usage");

      // 5. Test bin --version
      const { stdout: versionOut } = await execFileAsync(process.execPath, [binScriptPath, "--version"]);
      assert.ok(/^\d+\.\d+\.\d+/.test(versionOut.trim()), `version output should be semver, got: ${versionOut.trim()}`);

      // 6. Test running MCP server via installed bin using stdio transport
      const stateRoot = await mkdtemp(path.join(tmpdir(), "omp-worker-installed-state-"));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [binScriptPath],
        env: {
          ...process.env,
          OMP_WORKER_STATE_DIR: stateRoot,
          OMP_WORKER_OMP_COMMAND: process.execPath,
          OMP_WORKER_OMP_PREFIX_ARGS: JSON.stringify([path.join(projectRoot, "tests", "fake-omp.mjs")]),
        },
      });

      const client = new Client({ name: "omp-worker-package-smoke-test", version: "1.0.0" });
      await client.connect(transport);

      try {
        const { tools } = await client.listTools();
        const toolNames = tools.map((t) => t.name);
        assert.ok(toolNames.includes("omp_delegate"), "installed MCP server should expose omp_delegate");
        assert.ok(toolNames.includes("omp_run_batch_compact"), "installed MCP server should expose omp_run_batch_compact");
        assert.ok(toolNames.length >= 9, "installed MCP server should expose all MCP tools");
      } finally {
        await client.close();
        await rm(stateRoot, { recursive: true, force: true }).catch(() => {});
      }
    } finally {
      await rm(consumerDir, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});
