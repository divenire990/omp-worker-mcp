#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`omp-worker-mcp - Model Context Protocol (MCP) server for delegating coding tasks to OMP

Usage:
  omp-worker-mcp [options]

Options:
  -h, --help       Show this help message
  -v, --version    Show version number

By default, runs the MCP server over stdio for integration with MCP clients.`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  try {
    const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
    console.log(pkg.version || "1.0.0");
  } catch {
    console.log("1.0.0");
  }
  process.exit(0);
}

// Launch the MCP server
await import("../dist/index.js");
