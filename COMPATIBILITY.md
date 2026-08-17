# Compatibility and Upgrade Policy

This document defines the versioning guarantees, public contracts, and upgrade policies for `omp-worker-mcp`.

## Versioning Policy

`omp-worker-mcp` adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

### 0.x Series Semantics

During the initial `0.x` releases:
- **Minor releases (`0.x.0`)**: May introduce new features, architectural improvements, or breaking changes to public contracts when necessary.
- **Patch releases (`0.x.y`)**: Reserved for backward-compatible bug fixes, performance optimizations, and documentation updates.
- Any breaking change in a `0.x` release will be explicitly highlighted in [CHANGELOG.md](./CHANGELOG.md) alongside step-by-step migration guidance.

### 1.0.0 and Beyond

Following `1.0.0`:
- **Major releases (`X.0.0`)**: Breaking contract changes.
- **Minor releases (`x.Y.0`)**: Backward-compatible new capabilities and features.
- **Patch releases (`x.y.Z`)**: Backward-compatible fixes.

---

## Public Contract Definition

The following interfaces constitute the project's public API and contract. Any modification to these surfaces is subject to the breaking change policy.

### 1. MCP Tool Interfaces

All Model Context Protocol (MCP) endpoints provided by the server:

- **Single Task Tools**:
  - `omp_run_compact` (Preferred single-task runner with compact result)
  - `omp_delegate` (Low-level async task dispatch)
  - `omp_wait` (Wait for task completion)
  - `omp_result` (Inspect full task result and logs)
  - `omp_continue` (Resume session with supervisory feedback)
  - `omp_cancel` (Stop or terminate active task)
- **DAG Group Orchestration Tools**:
  - `omp_run_batch_compact` (Preferred DAG batch runner with aggregated result)
  - `omp_wait_group` (Wait for batch group)
  - `omp_cancel_group` (Cancel batch group)
#### Contract Invariants
- **Tool Names**: Stable identifiers exposed via MCP tools list.
- **Input Schemas**: Parameter names, types, required fields, and default values defined via Zod schemas.
- **Response Payloads**: Structured JSON response schemas returned to MCP clients.

### 2. Structured Result Contract

Downstream subagents and tasks output results adhering to the `OMP_WORKER_RESULT` structure:

```json
{
  "status": "completed | blocked",
  "summary": "string",
  "artifacts": [
    {
      "path": "string",
      "description": "string"
    }
  ],
  "verification": ["string"],
  "remaining": ["string"]
}
```

Any changes to field semantics or required keys in this envelope are considered contract modifications.

### 3. On-Disk State Storage Layout

The directory structure and metadata files generated under the state root (`~/.codex/state/omp-worker` or custom configured path):
- Task metadata (`meta.json`)
- Group metadata (`group-meta.json`)
- Standard output and error logs (`stdout.log`, `stderr.log`)
- Result artifacts and cancellation tokens

---

## Breaking Changes and Migration Policy

To ensure smooth upgrades for downstream agents, workflows, and integrations:

1. **Advance Notice & Deprecation**: When a public contract must change, an initial deprecation notice should be introduced prior to removal whenever practical.
2. **Documented Migration Steps**: Every breaking change must be accompanied by explicit migration instructions in `CHANGELOG.md`, covering:
   - The rationale for the change.
   - The previous behavior vs. the new behavior.
   - Concrete examples of updating configuration, tool invocation payloads, or consumer parsers.
3. **Graceful Failures**: If deprecated features or incompatible parameters are passed, clear error messages must be returned rather than silent failures.

---

## Runtime and Platform Support

### Node.js
- **Supported Versions**: Node.js `>= 22.0.0`
- Relies on native ECMAScript Modules (ESM), Node.js built-in test runner (`node:test`), and modern standard library APIs.

### Operating Systems
- **Windows** (win32): Fully verified and supported in production and automated test suites.
- **macOS** (Darwin) & **Linux** (x86_64, aarch64): Architectural design targets; users should verify local OMP CLI availability and platform-specific process management behaviors.
### External Dependencies
- Requires a local `omp` executable available in the system `PATH` or configured explicitly via environment variables.
