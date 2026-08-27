<div align="center">

# Operations & State Lifecycle

**Runtime configuration, environment variables, on-disk state layout, retention cleanup, and restart recovery.**

<p align="center">
  English •
  <a href="operations.zh-CN.md">简体中文</a> •
  <a href="README.md">Documentation Index</a>
</p>

</div>

---

## 1. Environment Variable Reference

All operational behavior can be configured via environment variables in the host environment or within the client's MCP configuration block:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `OMP_WORKER_OMP_COMMAND` | Path or executable name for the OMP CLI binary. | `omp` |
| `OMP_WORKER_OMP_PREFIX_ARGS` | JSON array string of arguments prepended to OMP CLI invocations (e.g. `["--profile", "default"]`). | `[]` |
| `OMP_WORKER_STATE_DIR` | Base directory for storing job states, prompt files, and execution logs. | `~/.codex/state/omp-worker` |
| `OMP_WORKER_BROWSER_RULES` | Optional custom browser automation instructions injected into worker prompts. | *(none)* |
| `OMP_WORKER_RETENTION_TTL_SECONDS` | Optional retention TTL in seconds for terminal job/group records. Unset disables TTL cleanup. | *(none)* |
| `OMP_WORKER_RETENTION_MAX_BYTES` | Optional maximum disk storage in bytes for terminal records. Unset disables size cleanup. | *(none)* |
| `OMP_WORKER_AUTO_CLEANUP_ON_START` | Optional boolean (`"true"` / `"1"`) to trigger a cleanup sweep once when the MCP server starts. | `false` |

---

## 2. On-Disk State Directory Layout

All state records are stored under `OMP_WORKER_STATE_DIR` (defaults to `~/.codex/state/omp-worker`):

```text
~/.codex/state/omp-worker/
├── jobs/
│   └── job-<timestamp>-<hash>/
│       ├── job.json              # Job metadata, parameters, and status
│       ├── cancel.request.json   # Cancellation signal (if requested)
│       ├── attempt-01.prompt.md  # Generated prompt for attempt 1
│       ├── stdout.log            # Execution standard output
│       └── stderr.log            # Execution standard error
└── groups/
    └── group-<timestamp>-<hash>/
        ├── group.json            # Batch DAG metadata, tasks, and status
        └── cancel.request.json   # Group cancellation signal (if requested)
```

---

## 3. Retention and Cleanup Policies

To ensure stability across long-running developer machines and automated environments, `omp-worker-mcp` implements robust state lifecycle safeguards:

- **Conservative by Default**: By default, `omp-worker-mcp` **never automatically deletes completed or historical records**, preventing unexpected data loss.
- **Explicit Cleanup Rules**: Users can opt in to automatic retention by setting `OMP_WORKER_RETENTION_TTL_SECONDS` (pruning terminal records older than N seconds) or `OMP_WORKER_RETENTION_MAX_BYTES` (pruning oldest terminal records when total disk usage exceeds threshold).
- **Protection for Active Jobs**: Non-terminal records (`dispatched`, `running`, `pending`, `validating`, `cancelling`) are **strictly protected and never pruned**.
- **Corrupted Record Protection**: Any record that cannot be verified as terminal is preserved to prevent accidental deletion. Symbolic links within state directories are rejected and never traversed.
- **Transparent Diagnostics**: Cleanup failures or permission issues are surfaced in structured error logs rather than silently ignored.

---

## 4. Server Restart & Crash Recovery

- **Metadata Persistence**: Job and DAG group metadata are written atomically to disk. Dispatched and completed task records remain fully accessible across server restarts via `omp_result` and `omp_wait`.
- **Process Decoupling**: If the MCP server restarts while an external worker process is executing, the server does not attempt unmanaged re-attachment to orphaned processes; the persisted state and captured logs accurately reflect the recorded state.
