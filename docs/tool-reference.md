<div align="center">

# Tool Reference & Safety Contract

**Complete specifications for exposed MCP tools, execution parameters, task safety rules, and structured outcome envelopes.**

<p align="center">
  English •
  <a href="tool-reference.zh-CN.md">简体中文</a> •
  <a href="README.md">Documentation Index</a>
</p>

</div>

---

## 1. Single Task Delegation Tools

| Tool Name | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| `omp_run_compact` | **High-Level** *(Recommended)* | **Recommended entrypoint for single-task delegation**. Spawns a background OMP worker and blocks up to `wait_seconds` (default: 60s) in a single turn, returning a compact execution summary. |
| `omp_delegate` | **Low-Level** | Dispatches an asynchronous background task without blocking, immediately returning a unique `job_id` for decoupled tracking. |
| `omp_wait` | **Low-Level** | Polls or waits for a running job until it reaches a terminal status or until `timeout_seconds` elapses. |
| `omp_result` | **Inspection** | Retrieves detailed attempt history, stdout/stderr logs, modified file artifacts, and the parsed structured outcome envelope for a specified `job_id`. |
| `omp_continue` | **Supervision** | Injects supervisory guidance (`feedback`) into a failed, blocked, or incomplete task to trigger a new attempt within the same session without losing prior context. |
| `omp_cancel` | **Control** | Sends a cancellation request to a running job and gracefully terminates the spawned worker process tree. |

---

## 2. Batch & DAG Orchestration Tools

| Tool Name | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| `omp_run_batch_compact` | **High-Level** *(Recommended)* | **Recommended entrypoint for multi-task DAG workflows**. Validates dependencies and path ownership, spawns tasks up to `max_parallel` (1–10), and waits up to `wait_seconds` for aggregated progress or completion. |
| `omp_wait_group` | **Low-Level** | Waits for an asynchronous batch task group to advance execution or reach completion. |
| `omp_cancel_group` | **Control** | Cancels all active, pending, and queued tasks within a batch group. |

---

## 3. Task Safety & Ownership Contract

To ensure predictable and collision-free agent execution, `omp-worker-mcp` enforces a three-part safety contract:

### 1. Write vs. Read-Only Boundaries
- **Batch Task Items (`omp_run_batch_compact`)**: Task items in a batch DAG declare `access` (`write` vs. `read_only`). `write` task items must explicitly declare the workspace file paths or directories they intend to modify via the `ownership` parameter; declared boundaries are supplied as worker constraints. `read_only` task items declare no write scope, and read-only constraints are supplied to the worker prompt.
- **Single Tasks (`omp_run_compact`)**: Single-task delegation tools do not accept `access` or `ownership` parameters. Read-only and no-modification intent must be expressed directly within the task's `goal` and `acceptance` criteria.
### 2. DAG Overlap & Collision Verification
- **Disjoint Ownership**: The server validates batch groups and rejects concurrent tasks with overlapping write scopes.
- **Sequential Dependencies**: Tasks that must touch shared files or directories must declare explicit linear dependencies via `depends_on`.
- **Topological Validation**: The server validates the task graph at submission time, rejecting circular dependencies and conflicting ownership before spawning any worker processes.

### 3. Structured Verification Contract (`OMP_WORKER_RESULT`)
All delegated workers are instructed to deliver their final deliverable with an explicit structured outcome envelope:

```text
OMP_WORKER_RESULT
{"status":"completed|blocked","summary":"concise description","artifacts":[{"path":"relative/path","description":"what changed"}],"verification":["test command and outcome"],"remaining":["pending item or blocker reason"]}
```

- **`status`**: `"completed"` when all acceptance criteria are verified; `"blocked"` when an external prerequisite is missing.
- **`summary`**: A concise, actionable summary of the work performed.
- **`artifacts`**: List of modified or created relative file paths with descriptions.
- **`verification`**: Concrete test execution commands, scenario checks, and their observed results.
- **`remaining`**: Explicit blockers or remaining items if status is not completed.
