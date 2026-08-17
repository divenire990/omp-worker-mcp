# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-17

### Added

- Initial release of `omp-worker-mcp`.
- Single task delegation MCP tools:
  - `omp_run_compact`: Preferred synchronous single-task execution tool with structured summary.
  - `omp_delegate`: Low-level asynchronous single-task dispatch returning job ID.
  - `omp_wait`: Wait for active single-task completion with timeout.
  - `omp_result`: Inspect full execution status, output logs, artifacts, and verification details.
  - `omp_continue`: Send supervisory feedback and guidance to an existing session for retry/resumption.
  - `omp_cancel`: Gracefully stop or cancel an active task execution.
- DAG group orchestration MCP tools:
  - `omp_run_batch_compact`: Preferred DAG batch orchestration tool with dependency resolution, concurrency limiting, and aggregated summary.
  - `omp_wait_group`: Poll or wait for batch task group completion.
  - `omp_cancel_group`: Request cancellation for all pending/running tasks in a group.
- File-backed job persistence store supporting task metadata, execution logs, and structured `OMP_WORKER_RESULT` capture.
- Cross-platform process management (Windows verified; macOS/Linux design targets).
- Comprehensive test suite covering MCP handlers, DAG orchestration, process cancellation, and end-to-end task execution.
