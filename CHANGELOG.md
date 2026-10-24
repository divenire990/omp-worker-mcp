# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-10-24

### Security

- Refreshed vulnerable transitive dependencies within their existing compatible ranges: `body-parser` to `2.4.0`, `fast-uri` to `3.1.9`, `hono` to `4.13.13`, `ip-address` to `10.7.4`, `proxy-addr` to `2.0.8`, and `qs` to `6.16.1`.

### Changed

- Updated `@modelcontextprotocol/sdk` to `1.32.1` and `zod` to `4.6.7` (PRs #7 and #8).
- Updated build tooling to TypeScript `7.0.2` and `@types/node` `26.6.5`, with explicit Node ambient types in `tsconfig.json` (PR #6). The runtime minimum remains Node.js 22.
- Updated pinned GitHub Actions to `actions/checkout@7.0.1` and `actions/setup-node@7.1.0` (PRs #4 and #5), retaining the trusted-source publication gates.

### Fixed

- Removed duplicate root `bin` metadata from `package-lock.json` left by dependency-branch integration.

MCP tool names and public request/response schemas are unchanged from `0.2.0`.

## [0.2.0] - 2026-10-23

### Added

- Execution-root allowlist via `OMP_WORKER_ALLOWED_ROOTS` (`realpath` canonicalization, sibling-prefix and symlink/junction escape rejection, fail-closed validation) and bilingual ChatGPT Secure MCP Tunnel guides (`docs/chatgpt-secure-tunnel.md`, `docs/chatgpt-secure-tunnel.zh-CN.md`).
- Optional `OMP_WORKER_ALLOWED_ROOTS` environment variable metadata in `server.json`.
- Windows CI coverage alongside macOS and Ubuntu in `.github/workflows/ci.yml`, plus resilient terminal-wait and detached DAG long-run tests.
- Automated CI-gated release workflow (`.github/workflows/publish.yml`) and release verification/publishing scripts (`scripts/check-release.mjs`, `scripts/publish-release.mjs`, `scripts/release.mjs`, `tests/release.test.mjs`) for npm and the Official MCP Registry.
- `CONTRIBUTING.md`, `CONTRIBUTING.zh-CN.md`, `SECURITY.md`, issue / pull request templates and Dependabot configuration.

### Fixed

- Unified runtime version reporting across `bin/omp-worker-mcp.mjs` (`--version` / `-v`), MCP `serverInfo.version`, and `package-lock.json` via single-source `src/version.ts` (`readPackageVersion`), removing the hardcoded `"1.0.0"` fallback.
- Removed redundant `packages[0].runtimeArguments` from `server.json` per Official MCP Registry npm package conventions so Registry clients derive versioned `npx` startup directly from `identifier` and `version`.

### Documentation

- Rewrote `README.md` and `README.zh-CN.md` around the supervisor–worker workflow: who it is for, per-client quick start, a delegation policy snippet, single-task and DAG examples, tool table, safety model and FAQ.
- Documented `OMP_WORKER_ALLOWED_ROOTS` and Secure MCP Tunnel setup for `omp-worker-mcp >= 0.2.0` (`npx -y omp-worker-mcp` stdio setup, with a historical upgrade note that npm `0.1.1` lacks the allowlist check).
- Updated Secure MCP Tunnel commands to match current `tunnel-client` CLI (`init --sample sample_mcp_stdio_local` → `doctor` → `run`, plus optional `runtimes connect`) and OpenAI permission requirements (`CONTROL_PLANE_API_KEY` with Tunnels Read + Use).
- Rewrote `docs/registry-publishing.md` and `docs/registry-publishing.zh-CN.md` for the official `mcp-publisher` CLI (`validate`, `login github-oidc` / `login github`, `publish`) and CI-gated `.github/workflows/publish.yml` automation.
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
