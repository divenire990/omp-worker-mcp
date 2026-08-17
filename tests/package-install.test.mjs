import assert from "node:assert/strict";
import { exec, execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");

/**
 * Portable, cross-platform npm runner for smoke tests.
 * Resolves npm CLI without depending on project-local node_modules/npm
 * or hardcoding user machine paths.
 */
function getNpmRunner() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return { type: "node", execPath: process.execPath, script: process.env.npm_execpath };
  }

  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { type: "node", execPath: process.execPath, script: candidate };
    }
  }

  const pathSep = process.platform === "win32" ? ";" : ":";
  const pathExts = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
  const paths = (process.env.PATH || "").split(pathSep);

  for (const dir of paths) {
    if (!dir || (dir.toLowerCase().includes("omp-worker-mcp") && dir.toLowerCase().includes("node_modules"))) {
      continue;
    }
    for (const ext of pathExts) {
      const candidateExec = path.join(dir, `npm${ext}`);
      if (existsSync(candidateExec)) {
        const adjacentCli = [
          path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
          path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
          path.join(dir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
        ];
        for (const cli of adjacentCli) {
          if (existsSync(cli)) {
            return { type: "node", execPath: process.execPath, script: cli };
          }
        }
        return { type: "binary", execPath: candidateExec };
      }
    }
  }

  return { type: "binary", execPath: process.platform === "win32" ? "npm.cmd" : "npm" };
}

const npmRunner = getNpmRunner();

async function runNpm(args, options = {}) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.npm_config_prefix;
  delete cleanEnv.INIT_CWD;

  const runOptions = {
    ...options,
    env: { ...cleanEnv, ...(options.env || {}) },
  };

  if (npmRunner.type === "node") {
    return await execFileAsync(npmRunner.execPath, [npmRunner.script, ...args], runOptions);
  }

  if (process.platform === "win32") {
    const cmdLine = `"${npmRunner.execPath}" ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`;
    return await execAsync(cmdLine, runOptions);
  }

  return await execFileAsync(npmRunner.execPath, args, runOptions);
}
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
  const { stdout } = await runNpm(["pack", "--dry-run", "--json"], {
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
    const { stdout: packStdout } = await runNpm(["pack", "--pack-destination", tempDir], {
      cwd: projectRoot,
    });
    const tarballFileName = packStdout.trim().split(/\r?\n/).pop().trim();
    const tarballPath = path.join(tempDir, tarballFileName);

    // 2. Initialize a dummy consumer project in another temp folder
    const consumerDir = await mkdtemp(path.join(tmpdir(), "omp-worker-consumer-"));

    try {
      await runNpm(["init", "-y"], { cwd: consumerDir });
      await runNpm(["install", tarballPath], { cwd: consumerDir });
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
