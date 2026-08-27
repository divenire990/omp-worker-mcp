<div align="center">

# Author Workflow Enablement & Architecture Reference

**A tutorial for enabling the supervisor-worker delegation policy in host harnesses, combined with an architectural reference.**

<p align="center">
  English •
  <a href="author-workflow.zh-CN.md">简体中文</a> •
  <a href="README.md">Documentation Index</a>
</p>

</div>

---

## 1. Tool Availability, Direct Namespace Access, and Selection Policy

Enabling `omp-worker-mcp` involves three distinct, complementary layers:

1. **Tool Availability (MCP Server Registration)**: Configuring `omp-worker-mcp` in your host harness (e.g., in `config.toml`, `mcp.json`, or via CLI) connects the server and exposes its tool declarations (`omp_run_compact`, `omp_run_batch_compact`, etc.) to the host LLM.
2. **Direct Tool Namespace Access (Codex Environment Layer)**: In Codex specifically, registering an MCP server makes the tools present, but direct tool namespace access is controlled via `direct_only_tool_namespaces` in `~/.codex/config.toml`. Adding `"mcp__omp_worker"` to this setting allows the Codex environment to directly invoke tools under this namespace without friction. *Note: This setting is exclusive to Codex and is not used or required by other host harnesses.*
3. **Selection Policy (Project & System Instructions)**: Making tools available and directly accessible does not guarantee *when* or *why* the host LLM will choose them over its built-in read/edit tools. Providing project-level instructions (such as `AGENTS.md` or `CLAUDE.md`) establishes clear delegation heuristics, guiding the host to reliably offload complex, multi-step execution tasks to background workers.

> **Prerequisites**:
> This tutorial assumes you have already installed Oh My Pi (OMP) and registered `omp-worker-mcp` with your host harness. If you have not done so yet, complete the [Installation & Quick Start](../README.md#installation-quick-start) and consult [Client Configurations](client-configurations.md) before proceeding.

### Codex Direct Namespace Setup

If you are using **Codex**, complete this quick setup step to enable direct tool namespace access:

1. Open your user configuration file: `~/.codex/config.toml` (on Windows: `C:\Users\<username>\.codex\config.toml`).
2. Locate (or add) the `direct_only_tool_namespaces` list.
3. **Preserve existing entries**: Include `"mcp__omp_worker"` alongside any existing direct namespaces you may already have configured. Do not overwrite or drop your existing unrelated entries:
   ```toml
   # Include mcp__omp_worker alongside existing entries
   direct_only_tool_namespaces = ["mcp__omp_worker"]
   ```
4. Restart Codex for the configuration changes to take effect.
5. (Optional) Run the [One-Time Verification Prompt](#one-time-verification-prompt) in Section 3 to confirm end-to-end functionality.

*(For other host harnesses such as Claude Code, Cursor, or VS Code, skip this step and proceed directly to Section 2 for policy placement.)*

---

## 2. Reusable Project-Level Policy Template

To guide your host harness in selecting the appropriate execution path, place a clear delegation policy in your project repository.

### Policy Placement Guide

| Host Harness | Target Policy Location | Notes |
| :--- | :--- | :--- |
| **Codex** | `<workspace>/AGENTS.md` | Loaded automatically as workspace-level instructions. |
| **Claude Code** | `<workspace>/CLAUDE.md` | Read as repository guidelines for Claude Code CLI sessions. |
| **Cursor / VS Code / Other** | `<workspace>/.cursorrules`, `.github/copilot-instructions.md`, or system prompt | Adapt to your specific harness's project instruction mechanism. |

### Policy Template

Copy the following policy into your project's instruction file (e.g., `AGENTS.md` or `CLAUDE.md`):

```markdown
# Background Worker Delegation Policy (`omp-worker-mcp`)

This project provides `omp-worker-mcp` as an internal background execution tool. Treat it as an execution engine rather than a conversational user-facing API.

## Execution Strategy Heuristics

1. **Direct Host Actions**: Use native host tools (direct read, edit, terminal commands) for simple queries, architectural discussions, quick single-file inspections, or localized minor edits.
2. **Single Substantive Tasks (`omp_run_compact`)**: For substantive, multi-step coding, refactoring, or exploratory technical investigations, first perform bounded read-only inspection to understand context and define requirements. Then delegate the execution to `omp_run_compact` with clear `goal` and `acceptance` criteria (conveying read-only or no-modification intent directly in the criteria).
3. **Multi-Task & DAG Workflows (`omp_run_batch_compact`)**: For multi-module implementations or concurrent workflows, organize work into a dependency graph using `omp_run_batch_compact`. Ensure concurrent write tasks declare disjoint, non-overlapping `ownership` paths, and enforce sequential ordering via `depends_on` for shared files.
4. **Human & Host Control**: Retain direct host and human confirmation for irreversible or high-impact operations (e.g., `npm publish`, `git push`, production deployments, secret modification, destructive deletions). Never delegate these actions blindly to background workers.
5. **Failure & Fallback**: If `omp-worker-mcp` is unavailable, misconfigured, or unreachable, report the failure clearly to the user instead of attempting unsupported operations.
```

---

## 3. Verification & Daily Usage

### One-Time Verification Prompt

After registering the MCP server and adding the policy file, verify the end-to-end delegation chain with this prompt:

```text
Please use the configured omp-worker-mcp to perform a read-only inspection of the current workspace, review project structure and dependencies, and provide a concise summary report. Do not modify any files.
```

#### Expected Observable Behavior

1. **Tool Invocation**: The host harness invokes `omp_run_compact` (or `omp_delegate` + `omp_wait`), conveying read-only intent and no-modification acceptance criteria directly within the task's `goal` and `acceptance` parameters.
2. **Background Execution**: A local OMP worker sub-agent executes in the background, inspecting files without blocking the user interface.
3. **Structured Deliverable**: The worker returns an `OMP_WORKER_RESULT` envelope containing status, summary, and verification details.
4. **Final Summary**: The host presents a concise summary of the repository layout and dependencies, confirming that no files were modified.

### Daily Usage Workflow

Once the policy is in place, you do **not** need to mention `omp-worker-mcp` or tool names in everyday requests:

- **Natural Language Requests**: Simply describe your goal (e.g., *"Implement exponential backoff retry in the runner and verify unit tests pass"* or *"Refactor the auth middleware and user service in parallel"*). The host will consult the policy to guide entrypoint selection.
- **Explicit Mention**: You may explicitly request `omp-worker-mcp` during initial verification, when delegation is important, or if the host falls back to direct execution for a large, multi-step task.

---

## 4. Reference Architecture & Supervision Flow

### Host-Worker Architecture

`omp-worker-mcp` implements a decoupled **Supervisor-Worker** pattern across local stdio:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Primary Host Harness                            │
│            (Codex / Claude Code / Cursor / Other Host)                 │
│                                                                        │
│  1. Understand Task  ──▶  2. Decompose / DAG  ──▶  3. Set Acceptance   │
│         ▲                                                 │            │
│         │ (6. In-Session Correction via omp_continue)     │            │
│         │                                                 ▼            │
│  5. Inspect Result   ◀──  4. Delegate & Supervise ───────┘            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ local stdio MCP
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                            omp-worker-mcp                              │
│         (State persistence, concurrency pool, DAG validation)          │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
       ┌─────────────────────────┐      ┌─────────────────────────┐
       │   OMP Worker (Task A)   │      │   OMP Worker (Task B)   │
       │   [write: src/feature/] │      │   [read_only: docs/]    │
       └─────────────────────────┘      └─────────────────────────┘
```

### 6-Step Supervision Lifecycle

1. **Understand & Contextualize**: Comprehend user intent, perform bounded read-only investigation, and confirm workspace prerequisites.
2. **Decompose & Schedule**: Decide whether to handle directly, dispatch a single task, or construct a dependency DAG.
3. **Define Acceptance Criteria & Boundaries**: Establish clear verification criteria, conveying read-only or write intent directly in `goal` and `acceptance` for single tasks, and setting access mode (`read_only` vs. `write`) with non-overlapping `ownership` paths for batch DAG tasks.
4. **Delegate & Supervise**: Launch background execution via `omp_run_compact`, `omp_delegate`, or `omp_run_batch_compact`.
5. **Inspect & Verify**: Inspect structured outcomes (`OMP_WORKER_RESULT`), verifying modified artifacts and test execution evidence before escalating.
6. **In-Session Correction**: If acceptance criteria are unmet, invoke `omp_continue` with targeted feedback to steer the existing session without restarting from scratch.

### Execution Strategy Matrix

| Execution Mode | Best For | Entrypoint Tools | Safety & Usage Boundaries |
| :--- | :--- | :--- | :--- |
| **Direct Processing**<br>*(Host-native)* | Single-file edits, instant Q&A, light design discussions, user-in-the-loop decisions. | Host built-in read/edit/bash tools | No worker process spawned; zero orchestration overhead. |
| **Single Task Delegation** | Independent feature implementations, bug fixes, refactoring, lengthy technical investigations. | `omp_run_compact`<br>*(or `omp_delegate` + `omp_wait`)* | Requires unambiguous `goal` and `acceptance` (conveying read-only intent directly in criteria; single tasks have no `access` or `ownership` parameters). |
| **Batch DAG Orchestration** | Multi-module migrations, parallel frontend/backend tasks, multi-source research followed by synthesis. | `omp_run_batch_compact`<br>*(plus `omp_wait_group`)* | Parallel `write` task items must declare disjoint `ownership`. Shared files require sequential `depends_on`. Bounded by `max_parallel` (1–10). |

---

## 5. Personal Setup & Qualitative Experience

In the author's local development environment, `omp-worker-mcp` was paired with the author's selected Gemini Flash configuration within an Antigravity setup at the time of use. Under this personal configuration, where token limits and model quotas were relatively generous, the setup delivered rapid, responsive, and stable multi-step task execution.

> **Disclaimer**:
> This reflects the author's personal practice and qualitative experience as a reference pattern at the time of use. It is **not** a usage prerequisite, a performance guarantee, or an assertion of universal best practice. Quotas, generation latency, and output quality depend heavily on individual accounts, regions, model versions, and local runtime constraints. Neither Google Gemini nor Antigravity endorses this project.

---

## 6. Safety Guardrails & Documenting Workflows

When adopting or documenting agentic delegation workflows, maintain clear boundaries between reproducible patterns and private environments:

- **Separate Facts from Personal Preferences**: Distinguish protocol-level mechanisms (stdio MCP lifecycle, DAG validation, path checks) from personal choices (models, hardware, client tools).
- **High-Impact Operations Stay with the Host**: Irreversible actions—such as publishing packages (`npm publish`), pushing branches (`git push`), deploying to production, deleting data, or modifying production credentials—**must remain under direct host harness and human confirmation**.
- **Protect Private Environment Details**: Never expose local absolute paths (e.g., local home directories or machine paths; use placeholders like `<workspace_path>`), private API keys, authentication tokens, or account billing/quota details.
