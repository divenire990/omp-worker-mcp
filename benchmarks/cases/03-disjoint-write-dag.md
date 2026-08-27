# Benchmark Case 03: Disjoint-Write DAG Plus Integration Test

**Case ID**: `case-03-disjoint-write-dag`  
**Category**: Multi-Task DAG Concurrency & Integration  
**Access Mode**: `write` (parallel disjoint ownership) + sequential verification  
**Target Fixture**: `benchmarks/fixtures/data-pipeline/`

---

## 1. Objective

Execute a multi-stage workflow on the benchmark fixture involving two independent, parallel feature tasks touching disjoint file paths (`src/modules/alpha-enricher.js` and `src/modules/beta-formatter.js`), followed by a downstream integration task that depends on both upstream completions to execute the integration test suite and synthesize results.

---

## 2. Standard Task Prompt

*Use this exact verbatim prompt for both Direct Mode and Supervisor-Worker Mode trials:*

```text
Implement two independent module enhancements and run the end-to-end integration test in benchmarks/fixtures/data-pipeline/:
1. Task A: Enhance src/modules/alpha-enricher.js (owned path: benchmarks/fixtures/data-pipeline/src/modules/alpha-enricher.js) to support custom stage metadata and verify with test/unit/alpha-enricher.test.js.
2. Task B: Enhance src/modules/beta-formatter.js (owned path: benchmarks/fixtures/data-pipeline/src/modules/beta-formatter.js) to support custom destination sinks and verify with test/unit/beta-formatter.test.js.
3. Task C (Integration): Run the full integration test suite after Task A and Task B complete:
   node --test benchmarks/fixtures/data-pipeline/test/integration/pipeline.test.js
Ensure Task A and Task B have non-overlapping ownership paths and Task C depends on both upstream completions.
```

---

## 3. Trial Execution Instructions

### Pre-Trial Baseline Reset
Before starting any trial, reset the fixture state:
```bash
git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/
```

### Trial 5: Direct Mode (`direct`)
1. **Fresh Codex Task**: Create a new, blank Codex task session.
2. **Prompt Submission**: Submit the verbatim standard task prompt.
3. **Execution**: The host model serializes or interleaves the edits for Module A and Module B in the main session, then runs the integration test.
4. **Token Telemetry Capture**:
   - Record `input_tokens`, `output_tokens`, and `total_tokens` from visible Codex telemetry / session export.
   - Record `telemetry_source` (e.g., `"codex-desktop-ui"`, `"codex-cli-session-export"`) and client version.
5. **Acceptance Verification**: Run the integration test command to verify end-to-end pipeline execution.

### Trial 6: Supervisor-Worker Mode (`supervisor_worker`)
1. **Fresh Codex Task**: Create a new, blank Codex task session.
2. **Prompt Submission**: Submit the identical verbatim standard task prompt.
3. **Supervisor Role & MCP Invocation**:
   - The primary host builds a DAG batch request using `omp_run_batch_compact`:
     ```json
     {
       "tasks": [
         {
           "id": "enhance-alpha",
           "goal": "Enhance Alpha Enricher metadata handling in src/modules/alpha-enricher.js",
           "access": "write",
           "ownership": ["benchmarks/fixtures/data-pipeline/src/modules/alpha-enricher.js"],
           "acceptance": "Alpha Enricher updated and test/unit/alpha-enricher.test.js passes."
         },
         {
           "id": "enhance-beta",
           "goal": "Enhance Beta Formatter sink handling in src/modules/beta-formatter.js",
           "access": "write",
           "ownership": ["benchmarks/fixtures/data-pipeline/src/modules/beta-formatter.js"],
           "acceptance": "Beta Formatter updated and test/unit/beta-formatter.test.js passes."
         },
         {
           "id": "run-integration",
           "goal": "Run full pipeline integration test suite after upstream tasks complete",
           "access": "read_only",
           "depends_on": ["enhance-alpha", "enhance-beta"],
           "acceptance": "node --test test/integration/pipeline.test.js passes cleanly."
         }
       ],
       "max_parallel": 2
     }
     ```
   - The worker MCP runtime validates disjoint ownership and cycle freedom, schedules Task A and B concurrently, and triggers Task C upon completion.
   - *Note: Do not fabricate or claim performance results in advance; observe actual execution.*
4. **Token Telemetry Capture**:
   - Capture primary host token telemetry from the task interface/export.
   - Record `telemetry_source` and version under the same methodology as Trial 5.
5. **Acceptance Verification**: Confirm worker envelope `status: "completed"` and verify the integration test passes cleanly.

---

## 4. Acceptance Criteria & Evaluation

1. **Disjoint Ownership Enforcement**: Parallel write tasks do not modify identical files (Task A owns `alpha-enricher.js`, Task B owns `beta-formatter.js`).
2. **Topological Order**: Task C begins execution only after Task A and Task B complete successfully.
3. **End-to-End Test Passage**: The integration test suite passes:
   ```bash
   node --test benchmarks/fixtures/data-pipeline/test/integration/pipeline.test.js
   ```
4. **Structured Delivery**: Each sub-task and the batch summary produce valid `OMP_WORKER_RESULT` envelopes.

---

## 5. Metrics Recording

Copy `benchmarks/schema/template.json` to `benchmarks/results/run-case03-<mode>-<id>.json` and record:
- `wall_clock_seconds`: Elapsed time from prompt dispatch to batch acceptance.
- `primary_harness_tool_calls`: Number of tool calls executed directly in the host conversation.
- `retry_count`: Number of supervisor corrective feedback turns.
- `token_telemetry`: Observed token counts with source and disclosure.
- `acceptance_result`: `"passed"` or `"failed"`.
