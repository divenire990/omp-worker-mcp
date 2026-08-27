# Benchmark Case 02: Single-Module Bug Fix

**Case ID**: `case-02-single-module-bugfix`  
**Category**: Isolated Defect Reproduction & Regression Fix  
**Access Mode**: `write` (with bounded `ownership`)  
**Target Fixture**: `benchmarks/fixtures/data-pipeline/`

---

## 1. Objective

Given an isolated defect in a single module of the benchmark fixture (`benchmarks/fixtures/data-pipeline/src/transformer.js`), the agent must locate the defect (where missing or `null` tags cause an unhandled `TypeError`), apply a minimal surgical fix strictly within the declared module path, and verify that the regression test suite passes cleanly.

---

## 2. Standard Task Prompt

*Use this exact verbatim prompt for both Direct Mode and Supervisor-Worker Mode trials:*

```text
Fix the boundary handling defect in benchmarks/fixtures/data-pipeline/src/transformer.js:
1. Locate the logic in src/transformer.js where missing or null tags throw TypeError.
2. Apply the minimal necessary fix strictly within src/transformer.js without modifying any other files.
3. Run the targeted test suite to confirm the regression is resolved and all unit tests pass:
   node --test benchmarks/fixtures/data-pipeline/test/unit/transformer.test.js
4. Report the root cause, changed files, and test verification output.
```

---

## 3. Trial Execution Instructions

### Pre-Trial Baseline Reset
Before starting any trial, reset the fixture state:
```bash
git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/
```

### Trial 3: Direct Mode (`direct`)
1. **Fresh Codex Task**: Create a new, blank Codex task session.
2. **Prompt Submission**: Submit the verbatim standard task prompt.
3. **Execution**: The host model directly inspects `src/transformer.js`, applies the edit in-session, and runs the test command via its terminal tool.
4. **Token Telemetry Capture**:
   - Record `input_tokens`, `output_tokens`, and `total_tokens` from visible Codex telemetry / session export.
   - Record `telemetry_source` (e.g., `"codex-desktop-ui"`, `"codex-cli-session-export"`) and client version.
5. **Acceptance Verification**: Run the fixture unit test command and verify only `src/transformer.js` was modified.

### Trial 4: Supervisor-Worker Mode (`supervisor_worker`)
1. **Fresh Codex Task**: Create a new, blank Codex task session.
2. **Prompt Submission**: Submit the identical verbatim standard task prompt.
3. **Supervisor Role & MCP Invocation**:
   - The primary host acts as supervisor, bounding ownership strictly and delegating via `omp_run_compact`:
     ```json
     {
       "goal": "Fix boundary condition handling for missing/null tags in transformer.js and verify unit tests",
       "acceptance": "src/transformer.js patched cleanly; transformer.test.js passes; zero edits outside transformer.js",
       "access": "write",
       "ownership": ["benchmarks/fixtures/data-pipeline/src/transformer.js"]
     }
     ```
   - The worker executes autonomously in the background. If the initial worker result fails criteria, the supervisor invokes `omp_continue` with targeted feedback.
   - *Note: Do not fabricate or claim performance results in advance; observe actual execution.*
4. **Token Telemetry Capture**:
   - Capture primary host token telemetry from the task interface/export.
   - Record `telemetry_source` and version under the same methodology as Trial 3.
5. **Acceptance Verification**: Confirm worker envelope `status: "completed"`, `artifacts: ["benchmarks/fixtures/data-pipeline/src/transformer.js"]`, and execute the fixture test command.

---

## 4. Acceptance Criteria & Evaluation

1. **Path Isolation**: Modifications are strictly confined to `benchmarks/fixtures/data-pipeline/src/transformer.js`.
2. **Regression Test Passage**: The targeted unit test suite passes:
   ```bash
   node --test benchmarks/fixtures/data-pipeline/test/unit/transformer.test.js
   ```
3. **Full Fixture Integrity**: The remaining fixture tests continue to pass without regression:
   ```bash
   node --test benchmarks/fixtures/data-pipeline/test/unit/*.test.js
   ```
4. **Structured Delivery**: In supervisor-worker mode, Worker returns a valid `OMP_WORKER_RESULT` with `status: "completed"`.

---

## 5. Metrics Recording

Copy `benchmarks/schema/template.json` to `benchmarks/results/run-case02-<mode>-<id>.json` and record:
- `wall_clock_seconds`: Elapsed time from prompt submission to verified test passage.
- `primary_harness_tool_calls`: Number of tool calls executed directly in the host conversation.
- `retry_count`: Number of supervisor corrective feedback turns (`omp_continue` calls).
- `token_telemetry`: Observed token counts with source and disclosure.
- `acceptance_result`: `"passed"` or `"failed"`.
