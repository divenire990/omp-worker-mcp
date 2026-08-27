# Benchmark Case 01: Read-Only Investigation

**Case ID**: `case-01-read-only-investigation`  
**Category**: Architecture Discovery & Impact Analysis  
**Access Mode**: `read_only`  
**Target Fixture**: `benchmarks/fixtures/data-pipeline/`

---

## 1. Objective

Perform a targeted, read-only architectural investigation on the deterministic fixture's state persistence, retention cleanup, and storage capacity enforcement mechanisms (`src/storage.js` and `src/validator.js`). The agent must identify relevant files, trace the lifecycle of records, and summarize findings without modifying any workspace files.

---

## 2. Standard Task Prompt

*Use this exact verbatim prompt for both Direct Mode and Supervisor-Worker Mode trials:*

```text
Perform an architectural investigation on the data-pipeline fixture in benchmarks/fixtures/data-pipeline/:
1. Identify all source and documentation files involved in validation and storage.
2. Trace how records are saved in src/storage.js, how TTL expiration is calculated, how stale records are purged, and how max capacity is enforced.
3. Summarize your findings and highlight any potential edge cases or failure modes.
4. Do not modify, create, or delete any files in the workspace.
```

---

## 3. Trial Execution Instructions

### Pre-Trial Baseline Reset
Before starting any trial, reset the fixture state:
```bash
git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/
```

### Trial 1: Direct Mode (`direct`)
1. **Fresh Codex Task**: Create a new, blank Codex task session.
2. **Prompt Submission**: Submit the verbatim standard task prompt.
3. **Execution**: The host model directly invokes its read/grep tools within conversational turns.
4. **Token Telemetry Capture**:
   - Record `input_tokens`, `output_tokens`, and `total_tokens` from visible Codex telemetry / session export.
   - Record `telemetry_source` (e.g., `"codex-desktop-ui"`, `"codex-cli-session-export"`) and client version.
5. **Acceptance Verification**: Confirm zero file modifications (`git status --porcelain benchmarks/fixtures/` must be empty).

### Trial 2: Supervisor-Worker Mode (`supervisor_worker`)
1. **Fresh Codex Task**: Create a new, blank Codex task session.
2. **Prompt Submission**: Submit the identical verbatim standard task prompt.
3. **Supervisor Role & MCP Invocation**:
   - The primary host acts as the supervisor, formulating the boundary and delegating via `omp_run_compact`:
     ```json
     {
       "goal": "Investigate state persistence, TTL calculation, and capacity enforcement in benchmarks/fixtures/data-pipeline/",
       "acceptance": "Identify validator.js and storage.js; explain TTL/purge/eviction logic; zero files modified.",
       "access": "read_only"
     }
     ```
   - The worker executes autonomously in the background and returns a structured `OMP_WORKER_RESULT` envelope.
   - *Note: Do not fabricate or claim performance results in advance; observe actual execution.*
4. **Token Telemetry Capture**:
   - Capture primary host token telemetry from the task interface/export.
   - Record `telemetry_source` and version under the same methodology as Trial 1.
5. **Acceptance Verification**: Check worker envelope `status: "completed"`, `artifacts: []`, and verify `git status --porcelain benchmarks/fixtures/` is empty.

---

## 4. Acceptance Criteria & Evaluation

1. **Identification Accuracy**: Correctly identifies `src/storage.js`, `src/validator.js`, and `README.md`.
2. **Zero Modification Invariant**: `git status --porcelain benchmarks/fixtures/` must be completely empty after the run.
3. **Fixture Test Passage**: Fixture storage unit test passes:
   ```bash
   node --test benchmarks/fixtures/data-pipeline/test/unit/storage.test.js
   ```
4. **Structured Delivery**: In supervisor-worker mode, the worker output includes a valid `OMP_WORKER_RESULT` envelope with status `completed` and an empty `artifacts` list.

---

## 5. Metrics Recording

Copy `benchmarks/schema/template.json` to `benchmarks/results/run-case01-<mode>-<id>.json` and record:
- `wall_clock_seconds`: Elapsed time from prompt submission to final summary.
- `primary_harness_tool_calls`: Number of tool calls executed directly in the host conversation.
- `token_telemetry`: Observed token counts with source and disclosure.
- `acceptance_result`: `"passed"` or `"failed"`.
