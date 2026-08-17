# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-17

### Added

- Initial release of `omp-worker-mcp`.
- Single task delegation MCP tools:
  - `omp_worker_run`: Asynchronously dispatch a coding task to the local OMP CLI runner.
  - `omp_worker_cancel`: Request graceful termination or cancellation of an active task execution.
  - `omp_worker_result`: Query status, stdout/stderr tails, logs, and artifacts of a dispatched task.
- DAG group orchestration MCP tools:
  - `omp_worker_group_run`: Coordinate multi-task execution graphs with dependency resolution, concurrency limiting, and failure containment.
  - `omp_worker_group_result`: Poll DAG group state, aggregated progress, and individual task metrics.
- File-backed job persistence store supporting task metadata, execution logs, and structured `OMP_WORKER_RESULT` capture.
- Cross-platform process management supporting Windows, macOS, and Linux process trees.
- Comprehensive test suite covering MCP handlers, DAG orchestration, process cancellation, and end-to-end task execution.
