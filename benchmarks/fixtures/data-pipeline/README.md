# Data Pipeline Benchmark Fixture

A lightweight, deterministic, zero-dependency Node.js pipeline application designed for reproducible A/B evaluation between Direct Mode and Supervisor-Worker Mode.

## Architecture Overview

```
benchmarks/fixtures/data-pipeline/
├── package.json                   # Zero external dependencies (uses node:test & node:assert)
├── README.md                      # Fixture documentation & reset commands
├── src/
│   ├── index.js                   # Pipeline orchestrator
│   ├── validator.js               # Payload validation & boundary schema check
│   ├── storage.js                 # State store with TTL calculation & stale record purging (Case 01 target)
│   ├── transformer.js             # Normalization logic with seeded boundary defect (Case 02 target)
│   └── modules/
│       ├── alpha-enricher.js      # Disjoint write target A (Case 03 target A)
│       └── beta-formatter.js      # Disjoint write target B (Case 03 target B)
└── test/
    ├── unit/
    │   ├── storage.test.js        # Case 01 verification (passes cleanly)
    │   ├── validator.test.js      # Validator unit tests (passes cleanly)
    │   ├── transformer.test.js    # Case 02 verification (contains seeded regression test)
    │   ├── alpha-enricher.test.js # Module A unit tests
    │   └── beta-formatter.test.js # Module B unit tests
    └── integration/
        └── pipeline.test.js       # Case 03 end-to-end integration test
```

## Deterministic Baseline Reset Command

To restore the fixture to its pristine baseline without affecting any other repository files or running broad destructive git commands:

```bash
git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/
```

*Note: This command is scoped strictly to `benchmarks/fixtures/` and does not use `git reset --hard`.*

## Acceptance Commands

Run the full fixture test suite:
```bash
node --test benchmarks/fixtures/data-pipeline/test/unit/*.test.js benchmarks/fixtures/data-pipeline/test/integration/*.test.js
```

Or from inside `benchmarks/fixtures/data-pipeline/`:
```bash
node --test test/unit/*.test.js test/integration/*.test.js
```

Run case-specific test suites:
- **Case 01 (Investigation)**: `node --test test/unit/storage.test.js`
- **Case 02 (Bug Fix)**: `node --test test/unit/transformer.test.js`
- **Case 03 (Disjoint Write & Integration)**: `node --test test/integration/pipeline.test.js`
