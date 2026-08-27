<div align="center">

# Author Workflow & Architecture

**Architectural models, host supervision flows, execution strategies, and workflow authoring guidelines.**

<p align="center">
  English •
  <a href="author-workflow.zh-CN.md">简体中文</a> •
  <a href="README.md">Documentation Index</a>
</p>

</div>

---

## 1. Reusable Pattern: Host Harness & Worker Architecture

`omp-worker-mcp` is designed around a transport-agnostic, local stdio MCP pattern. Any host harness capable of launching local stdio MCP sub-processes—such as **Codex**, **Claude Code**, **WorkBuddy**, **Cursor**, **Cline**, **VS Code**, or **GitHub Copilot CLI**—can act as the primary supervisor, delegating autonomous execution units to background OMP workers provided local runtime prerequisites are satisfied.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Primary Host Harness                            │
│                  (Codex / Claude Code / WorkBuddy)                     │
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

> **Support Boundary Notice**:
> Mentioning specific MCP clients illustrates compatible local stdio configurations. Configuration format and execution behavior must be verified by the user in their local environment; mentioning a client does **not** imply formal certification, continuous integration guarantees, or official endorsement by the upstream product.


### Why This Architecture: An Empirical Hypothesis

Rather than treating the primary host LLM as a monolithic tool executor, this architecture separates **strategic oversight** from **tactical execution**:
- **Primary Host Harness** (e.g., Codex, Claude Code, Cursor): Focuses on problem formulation, system design, dependency decomposition, and adversarial acceptance verification.
- **OMP Worker Subagents**: Autonomously perform multi-step edits, local searches, and test executions within isolated file ownership boundaries.

> **Note on Benefits**: Benefits such as reduced context degradation, lower conversational turn fatigue, and higher multi-task throughput are treated as **testable hypotheses** to be evaluated empirically under real workloads. See the [Benchmark Protocol](../benchmarks/README.md) for standardized test cases and measurement rules.
---

## 2. Host Harness Supervision Flow

The standard supervision lifecycle consists of six distinct phases:

1. **Understand & Contextualize**: Comprehend user intent, perform bounded read-only investigation, and confirm workspace prerequisites.
2. **Decompose & Schedule**: Decide whether to handle directly, dispatch a single task, or construct a dependency DAG.
3. **Define Acceptance Criteria & Boundaries**: Establish clear verification criteria, set access mode (`read_only` vs. `write`), and assign non-overlapping `ownership` paths for write tasks.
4. **Delegate & Supervise**: Launch background execution via `omp_run_compact`, `omp_delegate`, or `omp_run_batch_compact`.
5. **Inspect & Verify**: Inspect structured outcomes (`OMP_WORKER_RESULT`), verifying modified artifacts and test execution evidence before escalating.
6. **In-Session Correction**: If acceptance criteria are unmet, invoke `omp_continue` with targeted feedback to steer the existing session without restarting from scratch.

---

## 3. Execution Strategy Matrix

| Execution Mode | Best For | Entrypoint Tools | Safety & Usage Boundaries |
| :--- | :--- | :--- | :--- |
| **Direct Processing**<br>*(Host-native)* | Single-file edits, instant Q&A, light design discussions, user-in-the-loop decisions. | Host built-in read/edit/bash tools | No worker process spawned; zero orchestration overhead. |
| **Single Task Delegation** | Independent feature implementations, bug fixes, refactoring, lengthy technical investigations. | `omp_run_compact`<br>*(or `omp_delegate` + `omp_wait`)* | Requires unambiguous `goal` and `acceptance`. Write tasks must declare explicit `ownership` paths. |
| **Batch DAG Orchestration** | Multi-module migrations, parallel frontend/backend tasks, multi-source research followed by synthesis. | `omp_run_batch_compact`<br>*(plus `omp_wait_group`)* | Parallel `write` tasks must declare disjoint `ownership`. Shared files require sequential `depends_on`. Bounded by `max_parallel` (1–10). |

---

## 4. Natural Language Delegation Examples

### Example 1: Read-Only Exploration
- **User Intent / Prompt**: *"Investigate the retention and cleanup mechanism in this repository, identify all affected files, and report findings without editing code."*
- **Host Action**: Invokes `omp_run_compact` with `access: "read_only"`, setting acceptance criteria around identifying relevant files and verifying no workspace modifications occurred.

### Example 2: Single Implementation with In-Session Supervisory Correction
- **User Intent / Prompt**: *"Implement exponential backoff retry in the process runner and ensure all unit tests pass."*
- **Host Action**: Dispatches `omp_run_compact`. When inspection reveals an unverified edge case in the test suite, the host calls `omp_continue(job_id, feedback)` to request the additional assertion within the same session.

### Example 3: Multi-Task DAG Batch Orchestration
- **User Intent / Prompt**: *"Concurrently refactor the auth middleware and user service, then run the full integration suite once both are complete."*
- **Host Action**: Submits `omp_run_batch_compact` with tasks `refactor-auth` and `refactor-user-svc` declaring disjoint `ownership` paths, and a third task `run-integration-tests` specifying `depends_on: ["refactor-auth", "refactor-user-svc"]`.

---

## 5. Personal Setup & Qualitative Experience

In the author's local development environment, `omp-worker-mcp` is paired with **Gemini 3.7 Flash** as the background worker model within an Antigravity setup. Under this personal configuration, where token limits and model quotas are relatively generous, the setup delivers rapid, responsive, and stable multi-step task execution.

> **Disclaimer**:
> This reflects the author's personal practice and qualitative experience as a reference pattern. It is **not** a usage prerequisite, a performance guarantee, or an assertion of universal best practice. Quotas, generation latency, and output quality depend heavily on individual accounts, regions, model versions, and local runtime constraints. Neither Google Gemini nor Antigravity endorses this project.

---

## 6. Safety Guardrails & Documenting Personal Workflows

When adopting or documenting agentic delegation workflows, maintain clear boundaries between reproducible patterns and private environments:

- **Separate Facts from Personal Preferences**: Distinguish protocol-level mechanisms (stdio MCP lifecycle, DAG validation, path checks) from personal choices (models, hardware, client tools).
- **High-Impact Operations Stay with the Host**: Irreversible actions—such as publishing packages (`npm publish`), pushing branches (`git push`), deploying to production, deleting data, or modifying production credentials—**must remain under direct host harness and human confirmation**.
- **Protect Private Environment Details**: Never expose local absolute paths (e.g., local home directories or machine paths; use placeholders like `<workspace_path>`), private API keys, authentication tokens, or account billing/quota details.
