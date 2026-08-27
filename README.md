<div align="center">

# omp-worker-mcp

**Durable Model Context Protocol (MCP) server for delegating background coding tasks and DAG workflows to local Oh My Pi (OMP) CLI sub-agents.**

<p align="center">
  English •
  <a href="README.zh-CN.md">简体中文</a> •
  <a href="docs/README.md">Documentation Hub</a>
</p>

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/omp-worker-mcp.svg)](https://www.npmjs.com/package/omp-worker-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](package.json)
[![CI](https://github.com/divenire990/omp-worker-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/divenire990/omp-worker-mcp/actions/workflows/ci.yml)

<br />

<img src="assets/orchestration.gif" alt="Async DAG Orchestration Flow" width="800" />

<p align="center">
  <em>Asynchronous task execution, DAG dependency resolution, path ownership isolation, and structured result verification.</em>
</p>

[Quick Start](#installation--quick-start) • [Minimal Config](#minimal-mcp-configuration) • [Entrypoints](#recommended-entrypoints) • [Safety Contract](#task-safety--ownership) • [Platform Support](#platform-support--boundaries) • [Docs Hub](docs/README.md)

</div>

---

## Value & Operating Model

`omp-worker-mcp` implements an outcome-led **Supervisor-Worker** pattern that decouples high-level planning from concrete implementation:

- **Main Agent Remains in Control**: The primary host harness (e.g., Codex, Claude Code) retains full authority over architecture, task decomposition, trade-off decisions, and final acceptance review.
- **Durable Local Background Execution**: Concrete, long-running coding, refactoring, and exploratory tasks are offloaded to local OMP worker processes running in the background without blocking conversational turns.
- **Topological DAG Orchestration**: Independent work units can be orchestrated as a directed acyclic graph (DAG) with automated dependency resolution, concurrency limits, and failure containment.
- **Explicit Path Ownership Boundaries**: Write tasks must declare explicit write-path ownership. The server validates and rejects overlapping concurrent write scopes in batch DAGs, supplying declared boundaries as worker constraints to prevent write collisions.
- **Structured Results & Supervised Resumption**: Workers report deliverables via the structured `OMP_WORKER_RESULT` envelope (status, summary, artifacts, verification checks, remaining items). Supervisors can inspect logs in real time and inject corrective guidance via `omp_continue` to retry within the same session.

---

## Installation & Quick Start

### Prerequisites

- **Node.js**: `>= 22.0.0` (native ECMAScript Modules support).
- **OMP CLI**: A separately installed [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) CLI available in your system `PATH` (or configured via `OMP_WORKER_OMP_COMMAND`).

`omp-worker-mcp` is an MCP server launched by stdio MCP hosts (such as Codex, Claude Code, etc.) using `npx` or a global install, rather than a standalone interactive CLI.

### Host Stdio Command (Recommended)

```bash
# Executed by your stdio MCP host configuration (e.g., mcpServers)
npx -y omp-worker-mcp
```

### Global Installation

```bash
# Install globally via npm
npm install -g omp-worker-mcp
```

### Building from Source

```bash
git clone https://github.com/divenire990/omp-worker-mcp.git
cd omp-worker-mcp
npm ci
npm run build
npm test
```

---

## Minimal MCP Configuration

Add `omp-worker-mcp` to your host harness's `mcpServers` configuration using standard stdio transport:

```json
{
  "mcpServers": {
    "omp-worker": {
      "command": "npx",
      "args": ["-y", "omp-worker-mcp"],
      "env": {
        "OMP_WORKER_OMP_COMMAND": "omp"
      }
    }
  }
}
```

*For detailed client configurations covering Codex (`config.toml`), Claude Code CLI, WorkBuddy, Cursor, VS Code, and more, see [Client Configurations](docs/client-configurations.md).*

---

## Recommended Entrypoints

Choose your starting point based on workflow complexity:

- **`omp_run_compact` (Single Task)**: Recommended entrypoint for single tasks. Delegates a discrete coding or research assignment, waits up to `wait_seconds` for execution, and returns a compact structured summary and artifact list.
- **`omp_run_batch_compact` (Multi-Task / DAG)**: Recommended entrypoint for multi-task workflows. Dispatches interdependent tasks with explicit dependency graphs and concurrency limits, waiting for aggregated results.

*For lower-level primitives (`omp_delegate`, `omp_wait`, `omp_result`, `omp_continue`, `omp_cancel`, `omp_wait_group`, `omp_cancel_group`) and complete schemas, consult the [Tool Reference](docs/tool-reference.md).*

---

## Task Safety & Ownership

1. **Declared Write Ownership**: `write` tasks must explicitly declare the workspace paths they own via `ownership`, while `read_only` tasks declare no write scope. The server supplies declared boundaries as constraints to the worker.
2. **DAG Overlap Validation**: The server validates batch groups and rejects concurrent tasks with overlapping write scopes; tasks operating on shared paths must declare sequential `depends_on` dependencies.
3. **Structured Verification Contract**: Subagents deliver results using the structured `OMP_WORKER_RESULT` envelope (status, summary, artifacts, verification checks, remaining items).

*High-impact operations (e.g., `npm publish`, `git push`, production deployments, secret modification) must always remain under direct host harness and human supervision.*

---

## Platform Support & Boundaries

- **Upstream Engine**: Interfaces with the [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) CLI (MIT License). The upstream binary is **not bundled** and must be installed separately in your local runtime `PATH`.
- **Runtime Requirement**: Node.js **>= 22.0.0** (native ECMAScript Modules and modern Node.js APIs).
- **Operating Systems**:
  - **Windows** (`win32`) & **macOS** (`darwin` / Apple Silicon): Fully verified with Node 22+ and real OMP CLI E2E testing.
  - **Linux** (`x86_64`, `aarch64`): Architectural design target; awaiting broader production verification.
- **Support Tiers**:
  - **Author-Verified**: Codex (author's daily local workflow; not a cross-platform CI guarantee).
  - **Documented / Reproducible**: Claude Code, WorkBuddy, Claude Desktop, Cursor, Cline, VS Code, GitHub Copilot CLI (*not CI integration-tested*).
  - **Cloud / Remote Hosts**: Conditional (*requires complete runtime, OMP CLI in PATH, writable workspace, and process spawning permissions*).

---

## Documentation Hub

Detailed documentation is organized in the [`docs/`](docs/README.md) directory:

- [**Documentation Index**](docs/README.md): Overview of documentation layout and responsibilities.
- [**Author Workflow & Architecture**](docs/author-workflow.md): Host-Worker supervision loop, execution strategies, and authoring guidelines.
- [**Client Configurations**](docs/client-configurations.md): Documented and reproducible configuration guidance for Codex, Claude Code, WorkBuddy, Cursor, VS Code, and more.
- [**Operations & State Lifecycle**](docs/operations.md): Environment variables, state directory layout, retention policies, and recovery.
- [**Tool Reference & Safety Contract**](docs/tool-reference.md): Full MCP tool specifications and safety boundaries.
- [**Benchmark Protocol**](benchmarks/README.md): Reproducible evaluation protocol comparing direct host execution against supervisor-worker delegation.

---

## Compatibility & Changelog

- **Public Contract & Deprecation**: Review [COMPATIBILITY.md](COMPATIBILITY.md) for versioning guarantees.
- **Release History**: Review [CHANGELOG.md](CHANGELOG.md) for notable updates.

---

## License

This project is licensed under the [MIT License](LICENSE).
