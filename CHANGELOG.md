# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Execution-root allowlist via `OMP_WORKER_ALLOWED_ROOTS` (`realpath` canonicalization, sibling-prefix and symlink/junction escape rejection, fail-closed validation) and bilingual ChatGPT Secure MCP Tunnel guides (`docs/chatgpt-secure-tunnel.md`, `docs/chatgpt-secure-tunnel.zh-CN.md`).
- Windows CI coverage alongside macOS and Ubuntu in `.github/workflows/ci.yml`, plus resilient terminal-wait and detached DAG long-run tests.
- `CONTRIBUTING.md`, `CONTRIBUTING.zh-CN.md`, `SECURITY.md`, issue / pull request templates and Dependabot configuration.

### Documentation

- Rewrote `README.md` and `README.zh-CN.md` around the supervisor–worker workflow: who it is for, per-client quick start, a delegation policy snippet, single-task and DAG examples, tool table, safety model and FAQ.
- Scoped `OMP_WORKER_ALLOWED_ROOTS` and Secure MCP Tunnel instructions to distinguish unreleased `master` source (identified by commit SHA, while `package.json` still reports `0.1.1`) from published npm `0.1.1`, which predates the allowlist check, with reproducible source-build instructions for remote tunnel deployments.
- Updated Secure MCP Tunnel commands to match current `tunnel-client` CLI (`init --sample sample_mcp_stdio_local` → `doctor` → `run`, plus optional `runtimes connect`) and OpenAI permission requirements (`CONTROL_PLANE_API_KEY` with Tunnels Read + Use).
- Updated Codex direct namespace guidance to distinguish the current official `features.code_mode.direct_only_tool_namespaces` setting from legacy top-level `direct_only_tool_namespaces` configs, clarifying that it is an optional Code Mode preference.
- Replaced the README hero animation with an architecture diagram (`assets/how-it-works.svg`, `assets/how-it-works.zh-CN.svg`) and added a social preview image (`assets/social-preview.png`).
- Corrected on-disk state and log filenames (`job.json`, `group.json`, `attempt-NN.prompt.md`, `attempt-NN.stdout.jsonl`, `attempt-NN.stderr.log`), `omp_wait` (`wait_seconds`) parameter docs, non-terminal status names, and platform/client verification tables across `COMPATIBILITY.md`, `docs/operations*.md`, `docs/tool-reference*.md`, and `.github/ISSUE_TEMPLATE/bug_report.yml`.

## [0.1.1] - 2026-08-27

### Added

- Official MCP Registry manifest (`server.json`) conforming to the official Registry schema for public npm stdio distribution (`io.github.divenire990/omp-worker-mcp`).
- Official Registry verification field `mcpName` in `package.json`.
- Release and registry publishing procedure documentation (`docs/registry-publishing.md` and `docs/registry-publishing.zh-CN.md`).
- Standard benchmark evaluation protocol documentation for task-level prompt tracking, execution timestamps, and structured result validation.

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
