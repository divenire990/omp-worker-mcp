# Benchmark Results Directory

This directory is designated for storing operator-generated benchmark trial outputs conforming to the [Benchmark Result Schema](../schema/benchmark-result.schema.json).

## Security & Local Privacy Policy

To prevent accidental commits of unverified personal telemetry, local machine identifiers, or private token usage data:

1. **Git Ignored**: All `*.json` result files in this directory are ignored by `.gitignore` by default.
2. **Review Before Publication**: Benchmark results must undergo independent review and verification before any public release or PR submission.
3. **Template**: Use [`../schema/template.json`](../schema/template.json) as the base template for recording individual trials.

## Trial Recording Workflow

For each trial:
1. Copy the base template:
   ```bash
   cp benchmarks/schema/template.json benchmarks/results/run-case01-direct-001.json
   ```
2. Populate the fields with observable operator telemetry (client version, model, elapsed wall clock seconds, tool calls, and visible token counts).
3. Validate against the schema before manual review.
