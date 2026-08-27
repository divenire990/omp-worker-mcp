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

[Quick Start](#installation-quick-start) • [Entrypoints](#recommended-entrypoints) • [Safety Contract](#task-safety-ownership) • [Platform Support](#platform-support-boundaries) • [Docs Hub](docs/README.md)

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

### 1. Install OMP
Install [Oh My Pi (OMP) from its official project](https://github.com/can1357/oh-my-pi). (Note: running `omp-worker-mcp` requires local Node.js `>= 22.0.0`.)

### 2. Verify OMP Reachability
Verify that the OMP CLI is reachable in your environment:

```bash
omp --version
```

*Troubleshooting: If `omp` is not on your `PATH`, set `OMP_WORKER_OMP_COMMAND` to its executable path in your MCP configuration.*

### 3. Add MCP Configuration & Restart Host
Add `omp-worker-mcp` to your host harness's stdio `mcpServers` configuration (`npx` recommended) and restart the host harness:

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

*For detailed client configurations covering Codex (`config.toml`), Claude Code, Cursor, VS Code / GitHub Copilot, Windsurf Cascade, and Continue, see [Client Configurations](docs/client-configurations.md).*

### 4. Send Your First Prompt
After restarting your host harness, paste a read-only inspection prompt directly into your conversation to verify the full delegation chain:

```text
Please use the configured omp-worker-mcp to perform a read-only inspection of the current workspace, review the project structure and dependencies, and provide a concise summary report. Do not modify any files.
```

---

### Developer Alternative: Building from Source

```bash
git clone https://github.com/divenire990/omp-worker-mcp.git
cd omp-worker-mcp
npm ci
npm run build
npm test
```

## Recommended Entrypoints

A capable host harness automatically selects the appropriate high-level execution entrypoint based on task complexity (users do not need to invoke these internal tools manually):

- **`omp_run_compact` (Single Task)**: High-level single-task entrypoint selected by the host to delegate a discrete coding or research assignment, wait up to `wait_seconds` for execution, and return a compact structured summary and artifact list.
- **`omp_run_batch_compact` (Multi-Task / DAG)**: High-level multi-task entrypoint selected by the host to dispatch interdependent tasks with explicit dependency graphs and concurrency limits, waiting for aggregated results.

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
  - **Windows** and **macOS (Apple Silicon)**: Verified with Node.js 22+ and real OMP CLI end-to-end testing.
  - **Linux**: Supported by the architecture, but awaiting broader production verification.
- **Support Tiers**:
  - **Author-Verified**: Codex (author's daily local workflow; not a cross-platform CI guarantee).
  - **Documented / Reproducible**: Claude Code, WorkBuddy, Claude Desktop, Cursor, Cline, VS Code, GitHub Copilot CLI (*not CI integration-tested*).
  - **Cloud / Remote Hosts**: Conditional (*requires complete runtime, OMP CLI in PATH, writable workspace, and process spawning permissions*).

---

## Documentation Hub

Detailed documentation is organized in the [`docs/`](docs/README.md) directory:

- [**Documentation Index**](docs/README.md): Overview of documentation layout and responsibilities.
- [**Author Workflow Enablement & Architecture**](docs/author-workflow.md): Enablement tutorial, policy templates, host-worker supervision loop, and authoring guidelines.
- [**Client Configurations**](docs/client-configurations.md): Documented and reproducible configuration guidance for Codex, Claude Code, Cursor, VS Code / GitHub Copilot, Windsurf Cascade, and Continue.
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
