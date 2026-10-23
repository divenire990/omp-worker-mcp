# Contributing to omp-worker-mcp

English · [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for taking the time to help. Bug reports, tested client configurations, Linux verification and focused pull requests are all very welcome.

## Ways to help

- **Report a bug** — open a [bug report](https://github.com/divenire990/omp-worker-mcp/issues/new?template=bug_report.yml). Include versions, OS, MCP client and the relevant part of the job's logs.
- **Verify a platform or client** — if you ran it on Linux or with a client we only document (Claude Code, Cursor, VS Code, Windsurf, Continue), tell us what worked and what didn't.
- **Suggest a feature** — open a [feature request](https://github.com/divenire990/omp-worker-mcp/issues/new?template=feature_request.yml) and describe the workflow you're trying to support.
- **Security issues** — please do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js ≥ 22 and npm. You do **not** need a real OMP install to run the tests — the suite uses a fake OMP binary (`tests/fake-omp.mjs`).

```bash
git clone https://github.com/divenire990/omp-worker-mcp.git
cd omp-worker-mcp
npm ci
npm test            # runs `tsc` and then `node --test tests/*.test.mjs`
```

To try your local build inside an MCP client, point the client at the compiled entrypoint:

```json
{
  "mcpServers": {
    "omp-worker-dev": {
      "command": "node",
      "args": ["<path-to-repo>/dist/index.js"],
      "env": { "OMP_WORKER_OMP_COMMAND": "omp" }
    }
  }
}
```

Consider setting `OMP_WORKER_STATE_DIR` to a scratch directory while developing so test jobs don't mix with your real ones.

## Project layout

| Path | What's there |
| :--- | :--- |
| `src/index.ts` | MCP server and tool definitions |
| `src/runner.ts` | Spawns and supervises a single OMP process |
| `src/group-orchestrator.ts`, `src/group-runner.ts` | Batch / DAG scheduling |
| `src/job-store.ts` | On-disk job and group state, retention |
| `src/security.ts` | `OMP_WORKER_ALLOWED_ROOTS` checks |
| `src/protocol.ts` | Worker prompt and the `OMP_WORKER_RESULT` contract |
| `tests/` | `node:test` suites and the fake OMP |
| `docs/`, `benchmarks/` | Documentation (English + 简体中文) and the benchmark protocol |

## Pull request guidelines

1. **Keep it focused.** One logical change per PR is much easier to review.
2. **Add or update tests** for behaviour changes. `npm test` must pass on all three CI platforms.
3. **Respect the public contract.** Tool names, input schemas, response payloads, the `OMP_WORKER_RESULT` envelope and the on-disk layout are defined in [COMPATIBILITY.md](COMPATIBILITY.md). If you change any of them, say so in the PR and include migration notes.
4. **Update the changelog.** Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
5. **Keep docs in sync in both languages.** Every page in `docs/` and the root README exist as `<page>.md` and `<page>.zh-CN.md`. If you can't write one of the languages, say so in the PR and the maintainer will help.
6. **Don't leak private details.** Use placeholders such as `<workspace_path>`; never commit real home paths, API keys, tokens or benchmark telemetry from your own account.

## Commit messages

Short, imperative subject lines work best, e.g. `fix: reject empty ownership for write tasks` or `docs: add Linux setup notes`. [Conventional Commits](https://www.conventionalcommits.org/) prefixes are appreciated but not required.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
