<div align="center">

# Benchmark Protocol

**A reproducible, operator-evaluated protocol for comparing Direct Host execution against Supervisor-Worker delegation.**

<p align="center">
  English •
  <a href="README.zh-CN.md">简体中文</a> •
  <a href="../README.md">Repository Root</a>
</p>

</div>

---

## 1. Objectives & Scope

This benchmark protocol provides a standardized, empirical evaluation framework to measure the operational differences between two execution architectures:

1. **Direct Mode (`direct`)**: The primary host LLM (e.g., Codex, Claude Code, Cursor) directly executes tool calls (reads, edits, terminal commands) in its main conversational session.
2. **Supervisor-Worker Mode (`supervisor_worker`)**: The primary host LLM acts as an orchestrator/supervisor (handling decomposition, boundary definition, and acceptance verification) while delegating autonomous execution units to background `omp-worker-mcp` workers.

### Architectural Hypothesis
The core architectural proposition of `omp-worker-mcp` is framed as a **testable hypothesis**:
> *Delegating execution-heavy tasks to background workers frees the primary host harness to focus on high-level architecture and verification, reducing conversational turn fatigue while executing structured sub-tasks in parallel.*

This protocol defines standard test cases, a deterministic local fixture, and measurement rules to evaluate this hypothesis empirically. **It does not fabricate numerical claims, cost savings, or fixed quotas.**

---

## 2. Deterministic Benchmark Fixture

All benchmark trials execute against the self-contained, zero-dependency Node.js fixture located under [`fixtures/data-pipeline/`](fixtures/data-pipeline/):

```
benchmarks/fixtures/data-pipeline/
├── package.json                   # Zero external dependencies (native node:test & node:assert)
├── README.md                      # Fixture layout & local command reference
├── src/
│   ├── index.js                   # Pipeline orchestrator
│   ├── validator.js               # Payload validation (Case 01 target)
│   ├── storage.js                 # State persistence & TTL cleanup (Case 01 target)
│   ├── transformer.js             # Data transform with seeded boundary defect (Case 02 target)
│   └── modules/
│       ├── alpha-enricher.js      # Disjoint write target A (Case 03 target A)
│       └── beta-formatter.js      # Disjoint write target B (Case 03 target B)
└── test/
    ├── unit/
    │   ├── storage.test.js        # Case 01 verification
    │   ├── validator.test.js      # Validator unit tests
    │   ├── transformer.test.js    # Case 02 verification (detects seeded bug)
    │   ├── alpha-enricher.test.js # Module A unit tests
    │   └── beta-formatter.test.js # Module B unit tests
    └── integration/
        └── pipeline.test.js       # Case 03 end-to-end integration test
```

### Deterministic Baseline Reset Command

Before each trial, reset the fixture to its clean baseline using the tracked-file reset command (strictly confined to the fixture path):

```bash
git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/
```

### Fixture Acceptance Command

Run the full fixture test suite:
```bash
node --test benchmarks/fixtures/data-pipeline/test/unit/*.test.js benchmarks/fixtures/data-pipeline/test/integration/*.test.js
```

---

## 3. Test Cases Overview

The benchmark suite defines three stable test cases covering representative development workflows:

| Case ID | Name | Focus | Workload Pattern |
| :--- | :--- | :--- | :--- |
| [`case-01`](cases/01-read-only-investigation.md) | **Read-Only Investigation** | Architecture discovery & impact analysis | Zero-write exploration of `storage.js` / `validator.js`, file identification, actionable report. |
| [`case-02`](cases/02-single-module-bugfix.md) | **Single-Module Bug Fix** | Isolated bug reproduction & regression fix | Surgical fix for missing `tags` TypeError in `src/transformer.js`, unit test verification. |
| [`case-03`](cases/03-disjoint-write-dag.md) | **Disjoint-Write DAG & Integration** | Multi-task DAG concurrency & integration | Independent parallel writes to `alpha-enricher.js` and `beta-formatter.js` + sequential integration test. |

---

## 4. Execution Protocol: 6 Standard Trials

A complete comparative benchmark run consists of **6 trials** (3 test cases × 2 execution modes):

1. **Trial 1**: Case 01 — Direct Mode
2. **Trial 2**: Case 01 — Supervisor-Worker Mode
3. **Trial 3**: Case 02 — Direct Mode
4. **Trial 4**: Case 02 — Supervisor-Worker Mode
5. **Trial 5**: Case 03 — Direct Mode
6. **Trial 6**: Case 03 — Supervisor-Worker Mode

### Mandatory Trial Execution Rules

For every trial, the operator must adhere to the following protocol:

1. **Fresh Codex Task**: The operator **must** create a brand-new, clean Codex session/task for each trial to eliminate cross-trial conversational memory or context cache leakage.
2. **Identical Verbatim Prompt**: Use the exact, verbatim prompt specified in the case documentation for both Direct Mode and Supervisor-Worker Mode.
3. **Baseline Reset**: Execute `git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/` before starting the task.
4. **Token Telemetry Capture**:
   - Inspect the visible token usage metrics exposed by the Codex interface, session export, or CLI telemetry output, or extract them using the safe extractor tool:
     ```bash
     node benchmarks/tools/extract-codex-telemetry.mjs --session-id <uuid>
     # or
     node benchmarks/tools/extract-codex-telemetry.mjs --session-file <path>
     ```
   - Record `input_tokens`, `output_tokens`, and `total_tokens`.
   - Record the exact `telemetry_source` (e.g., `"codex_session_jsonl"`, `"codex-desktop-ui"`, `"codex-cli-session-export"`) and `client_version`.
   - If token telemetry is unobservable in the operator's environment, explicitly mark `token_telemetry.available: false` with the mandatory disclosure string.
5. **Fixture Acceptance Verification**: Run the case acceptance test command to independently confirm correctness.
6. **Role Split in Supervisor-Worker Mode**:
   - The primary host acts as supervisor (planning, bounding ownership, issuing MCP tool calls, verifying output).
   - The worker executes autonomously via `omp_run_compact` or `omp_run_batch_compact`.
   - Do **not** claim pre-determined numerical results; record actual operator observations.
7. **Local Result Storage**: Save individual trial JSON files in `benchmarks/results/` (which is git-ignored by default to prevent accidental telemetry leakage).

---

## 5. Metrics & Data Collection Protocol

Every benchmark run must be recorded using the standardized [JSON Result Schema](schema/benchmark-result.schema.json) and [Template](schema/template.json).

### Captured Fields

1. **`mode`** (`"direct"` | `"supervisor_worker"`): The execution architecture used.
2. **`case_id`**: Identifier of the benchmark case (e.g., `case-01-read-only-investigation`).
3. **`task_id`**: Operator-assigned unique run identifier (e.g., `run-20260827-01`).
4. **`operator_metadata`**:
   - `model_identifier`: Primary host model and worker model (e.g., `claude-3-7-sonnet`, `gemini-3.7-flash`).
   - `client_identifier`: Harness/client name (e.g., `codex`, `claude-code`, `cursor`, `workbuddy`).
   - `client_version`: Exact version, build, or release identifier of the host client/harness.
   - `omp_worker_version`: Version of `omp-worker-mcp` (e.g., `0.1.0`).
   - `environment_os`: Operating system and architecture (e.g., `win32-x64`).
5. **`wall_clock_seconds`**: Total elapsed wall-clock time from task dispatch to final acceptance.
6. **`primary_harness_tool_calls`**: Number of tool calls executed directly by the primary harness during the run (when observable).
7. **`acceptance_result`** (`"passed"` | `"failed"` | `"partial"`): Evaluation against the case acceptance criteria.
8. **`retry_count`**: Number of in-session corrections or supervisor retries (`omp_continue` or re-prompts).
9. **`token_telemetry`**:
   - `available` (`boolean`): Explicit flag indicating whether reliable token consumption telemetry was observed.
   - `telemetry_source` (`string` | `null`): Name or description of the client-provided usage view, CLI export, or telemetry surface (e.g., `codex_session_jsonl`, `codex-desktop-ui`, `codex-cli-session-export`). Required when token telemetry is available; `null` if unobservable.
   - `input_tokens` / `output_tokens` / `total_tokens`: Observed token counts if exposed; `null` if unexposed.
   - `disclosure`: Mandatory disclosure statement explaining how token telemetry was collected or why it is unavailable.
10. **`cost_telemetry`**:
    - `available` (`boolean`): Explicit flag indicating whether exact per-session monetary cost was directly provided by the host client/platform.
    - `total_cost_usd`: Numerical cost in USD if directly provided; `null` if unexposed or operating under flat subscription/quota tiers.
    - `disclosure`: Mandatory disclosure explaining cost availability or reasons for unobservability.
11. **`notes`**: Operator qualitative observations (e.g., context window pressure, UX responsiveness).

---

## 6. Telemetry & Cost Disclosure Policy

### Strict Non-Fabrication Rule
Many host harnesses and MCP clients do not expose per-session token consumption or exact financial costs.
- Operators **MUST NOT** estimate, hallucinate, or fabricate unobserved token counts or dollar savings.
- Benchmark reports must clearly state what telemetry was directly observable vs. unavailable.
- This project does not claim any undocumented Codex UI/API route or automated ingestion mechanism; all telemetry depends on the operator recording verified outputs surfaced by the client/account.

### Codex Token Telemetry Requirement
1. **Explicit Token Recording**: Operators are **explicitly required** to record observed prompt/input, completion/output, and total token usage whenever exposed by the client interface, CLI output, session export, or account usage view. When extracting from local Codex session files, the bundled safe telemetry tool (`benchmarks/tools/extract-codex-telemetry.mjs`) may be used with `telemetry_source: "codex_session_jsonl"`.
2. **Telemetry Source Naming**: The `token_telemetry.telemetry_source` field must explicitly name the exact view or export used (e.g., `"codex_session_jsonl"`, `"codex-desktop-ui"`, `"codex-cli-session-export"`).
3. **Exact Client Interface & Version**: The operator must record the exact Codex interface (`operator_metadata.client_identifier`) and client version (`operator_metadata.client_version`).
4. **Comparability Rule**: Reported comparative results between `direct` and `supervisor_worker` modes are **only valid and comparable** when the exact same telemetry source, client version, and interface are used across both runs.

### Safe Telemetry Extraction Tool

The benchmark suite provides a dedicated CLI tool under `benchmarks/tools/extract-codex-telemetry.mjs`:
```bash
# Extract metrics by session UUID (searches CODEX_HOME/sessions or ~/.codex/sessions)
node benchmarks/tools/extract-codex-telemetry.mjs --session-id <uuid>

# Or extract metrics from an explicit session JSONL file
node benchmarks/tools/extract-codex-telemetry.mjs --session-file <path>
```
This tool streams the target session JSONL line-by-line and aggregates:
- Cumulative token counts (`input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`, and optional `cache_write`) including first, last, and delta values;
- Primary rate limit `used_percent` (first, last, and delta window change);
- Tool invocation counts grouped by tool name and namespace;
- Function call output counts and aggregate UTF-8 output byte totals.

**Safety Guarantee**: The extractor strictly omits all raw session prompts, message content, tool arguments, tool results, credentials, and absolute file paths from its output.

### Understanding Total Tokens vs. Rate Limit Used Percent

When interpreting Codex telemetry:
- **`total_tokens` (Processing Volume)**: Measures the actual cumulative or delta token volume processed by the model context during the session (inputs, cached prompts, completions, and reasoning tokens).
- **`used_percent` (Quota-Window Utilization)**: Reflects the instantaneous or delta percentage of the account's rate-limit quota consumed within a sliding time window (e.g., 5-hour rolling window).
- **No Monetary Cost Equivalence**: Neither `total_tokens` nor `used_percent` represents monetary cost (USD). Flat-rate subscriptions, tiered enterprise plans, and promotional quotas operate under fixed pricing models where token deltas or quota percentages do not incur per-token financial billing. Operators **MUST NOT** infer or claim dollar costs from token counts or quota percentages.
### Separation of Token and Cost Telemetry
Token telemetry and monetary cost telemetry are modeled as strictly separate objects:
- **Cost May Be Unavailable Even When Tokens Are Observable**: Subscription-based tiers, rate-limited quota allocations, or unpriced usage exports often provide exact token counts without per-session dollar figures.
- **No Dollar Inference**: Operators **MUST NOT** calculate, estimate, or infer dollar amounts from subscription fees, rate-limit quotas, or theoretical token multipliers. If exact per-session monetary cost is not directly reported by the platform, operators must set `cost_telemetry.available: false` and `cost_telemetry.total_cost_usd: null`.
