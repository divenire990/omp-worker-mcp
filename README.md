<div align="center">

# omp-worker-mcp

**Durable Model Context Protocol (MCP) server for delegating asynchronous coding tasks and DAG workflows to local Oh My Pi (OMP) CLI sub-agents.**

<p align="center">
  English •
  <a href="README.zh-CN.md">简体中文</a> •
  <a href="docs/README.md">Documentation Hub</a>
</p>

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/omp-worker-mcp.svg)](https://www.npmjs.com/package/omp-worker-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](package.json)
[![CI](https://github.com/divenire990/omp-worker-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/divenire990/omp-worker-mcp/actions/workflows/ci.yml)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.30.0-orange.svg)](https://modelcontextprotocol.io/)
[![M8ven Score](https://m8ven.ai/badge/mcp/divenire990-omp-worker-mcp-4fc9xm?v=4dd1b4cec6489cf043b8630c80138c73)](https://m8ven.ai/mcp/divenire990-omp-worker-mcp-4fc9xm)

<br />

<img src="assets/orchestration.gif" alt="Async DAG Orchestration Flow" width="800" />

<p align="center">
  <em>Asynchronous task execution, DAG dependency resolution, path ownership isolation, and structured result verification.</em>
</p>

[Quick Start](#installation--quick-start) • [Minimal Config](#minimal-mcp-configuration) • [Tool Overview](#available-mcp-tools) • [Safety Contract](#task-safety--ownership) • [Benchmark Protocol](benchmarks/README.md) • [Platform Support](#platform-support--boundaries) • [Docs Hub](docs/README.md)

</div>

---

## Key Highlights

- ⚡ **Asynchronous Task Delegation**: Offload long-running coding, refactoring, and exploration tasks to background OMP workers without blocking conversational turns.
- 🔀 **Topological DAG Orchestration**: Execute interdependent batch tasks with automatic dependency validation, concurrency pool limiting, and failure containment.
- 🛡️ **Workspace Path Isolation**: Enforce explicit write-path boundaries to prevent overlapping modifications between parallel tasks.
- 🔍 **Supervised Resumption & Envelopes**: Inspect interim execution logs in real time, extract structured result envelopes (`OMP_WORKER_RESULT`), and inject supervisory feedback via `omp_continue`.
- 💾 **Persistent State & Configurable Retention**: File-backed state persistence for job metadata and logs with optional TTL and storage capacity bounds.


---

## Why This Architecture?

`omp-worker-mcp` adopts a supervisor-worker delegation model: a premium host LLM (such as Codex or Claude Code) focuses on architecture, task decomposition, and acceptance review, while autonomous `omp-worker-mcp` background workers handle concrete execution.

> **Empirical Hypothesis**: Delegating execution-heavy coding tasks to background workers frees the primary host harness to focus on high-level design and verification, reducing conversational context fatigue while enabling multi-task parallelism. Evaluate this hypothesis empirically using our reproducible [Benchmark Protocol](benchmarks/README.md).
---

## Platform Support & Boundaries

- **Upstream Engine**: Interfaces with the [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) CLI (MIT License). The upstream binary is **not bundled** and must be installed in your local runtime `PATH`.
- **Runtime Requirement**: Node.js **>= 22.0.0** (native ESM and standard library capabilities).
- **Operating Systems**:
  - **Windows** (`win32`) & **macOS** (`darwin` / Apple Silicon): Fully verified with Node 22+ and real OMP CLI E2E testing.
  - **Linux** (`x86_64`, `aarch64`): Architectural design target; awaiting broader production verification.
- **Support Tiers**:
  - **Author-Verified**: Codex (author's daily local workflow; not a cross-platform CI guarantee).
  - **Documented / Reproducible**: Claude Code, WorkBuddy, Claude Desktop, Cursor, Cline, VS Code, Copilot CLI (*not CI integration-tested*).
  - **Cloud / Remote Hosts**: Conditional (*requires complete runtime, OMP CLI in PATH, writable workspace, and process spawning permissions*).

---

## Installation & Quick Start

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

*For detailed configs covering Codex (`config.toml`), Claude Code CLI, WorkBuddy, and other clients, see [Client Configurations](docs/client-configurations.md).*

---

## Available MCP Tools

### Single Task Delegation Tools

| Tool | Purpose |
| :--- | :--- |
| `omp_run_compact` | **Recommended for single tasks**: Delegates a coding task and waits up to `wait_seconds` for a compact summary. |
| `omp_delegate` | Low-level dispatch: Spawns an asynchronous background worker and returns a `job_id`. |
| `omp_wait` | Polls or waits for an asynchronous job to reach a terminal status or timeout. |
| `omp_result` | Inspects attempt history, stdout/stderr logs, modified artifacts, and structured result envelopes. |
| `omp_continue` | Injects supervisory guidance into a failed or blocked task to retry within the same session. |
| `omp_cancel` | Sends a cancellation signal to terminate a running job and its child process tree. |

### Batch & DAG Orchestration Tools

| Tool | Purpose |
| :--- | :--- |
| `omp_run_batch_compact` | **Recommended for multi-task workflows**: Runs an interdependent task DAG with concurrency control and waits for completion. |
| `omp_wait_group` | Waits for progress or completion of an asynchronous batch task group. |
| `omp_cancel_group` | Cancels all active and queued tasks within a batch group. |

*For complete tool schemas and parameter references, consult the [Tool Reference](docs/tool-reference.md).*

---

## Task Safety & Ownership

1. **Write vs. Read-Only Boundaries**: `write` tasks must explicitly declare the workspace paths they own via `ownership`; `read_only` tasks are strictly prohibited from modifying files.
2. **DAG Overlap Verification**: Parallel tasks within the same batch cannot declare overlapping write boundaries; tasks sharing paths must declare sequential `depends_on` dependencies.
3. **Structured Verification Contract**: Subagents deliver deliverables using the structured `OMP_WORKER_RESULT` envelope (status, summary, artifacts, verification checks, remaining items).

*High-impact operations (e.g., `npm publish`, `git push`, production deployments, secret modification) must always remain under direct host harness and human supervision.*

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
