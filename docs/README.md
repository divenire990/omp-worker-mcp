<div align="center">

# omp-worker-mcp Documentation

**Comprehensive guides, architectural workflows, client configurations, and operational references for `omp-worker-mcp`.**

<p align="center">
  English •
  <a href="README.zh-CN.md">简体中文</a> •
  <a href="../README.md">Back to Root README</a>
</p>

</div>

---

## Overview

Welcome to the `omp-worker-mcp` documentation hub. This directory contains in-depth documentation covering agent supervisor workflows, multi-client stdio integration guides, operational state management, and complete MCP tool references.

If you are looking for a high-level project summary or quick start instructions, please visit the root [README](../README.md).

---

## Documentation Layout

To maintain clear boundaries and eliminate redundant content, documentation responsibilities are divided across dedicated guides:

| Document | Primary Scope & Responsibilities | Key Topics Covered |
| :--- | :--- | :--- |
| [**Author Workflow & Architecture**](author-workflow.md) | Architectural models, orchestration flows, and authoring guidelines. | • Host-Worker supervision loop (6-step lifecycle)<br>• Execution strategy matrix (Direct vs. Single vs. Batch DAG)<br>• Natural language delegation examples<br>• Author's personal Gemini/Antigravity setup (non-guaranteed reference)<br>• Safety guardrails for documenting workflows |
| [**Client Configurations**](client-configurations.md) | MCP host harness connection and configuration guides. | • Local stdio compatibility prerequisites<br>• Evidence-based support tiers (Verified vs. Documented vs. Conditional)<br>• Generic `mcpServers` JSON template<br>• Client setups (Codex, Claude Code, WorkBuddy, Claude Desktop)<br>• Official reference links (Cursor, VS Code, Copilot CLI, Cline) |
| [**Operations & State Lifecycle**](operations.md) | Runtime configuration, persistence internals, and operational maintenance. | • Environment variable reference table<br>• On-disk state directory layout (`~/.codex/state/omp-worker`)<br>• Retention and cleanup policies (TTL & size bounds)<br>• Server restart, crash safety, and process decoupling |
| [**Tool Reference & Safety Contract**](tool-reference.md) | Detailed specifications for all exposed MCP tools and security contracts. | • Single-task delegation tools (`omp_run_compact`, `omp_delegate`, etc.)<br>• Batch and DAG orchestration tools (`omp_run_batch_compact`, etc.)<br>• Path ownership isolation rules (`write` vs. `read_only`)<br>• Structured output envelope contract (`OMP_WORKER_RESULT`) |

---

## Quick Navigation

- **New to Agent Delegation?** Start with [Author Workflow & Architecture](author-workflow.md) to understand the Host-Worker paradigm.
- **Configuring your MCP client?** Head over to [Client Configurations](client-configurations.md) for verified configs and templates.
- **Managing production or CI environments?** Check [Operations & State Lifecycle](operations.md) for retention settings and state layout.
- **Developing agent prompts or custom integrations?** Consult the [Tool Reference & Safety Contract](tool-reference.md).

---

## Language Synchronization

Every document in this directory is maintained synchronously in both English and Simplified Chinese:

- **English**: `docs/<page>.md`
- **简体中文**: `docs/<page>.zh-CN.md`
