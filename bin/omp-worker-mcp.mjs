#!/usr/bin/env node
import { PACKAGE_VERSION } from "../dist/version.js";

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
  console.log(PACKAGE_VERSION);
  process.exit(0);
}

// Launch the MCP server
await import("../dist/index.js");
