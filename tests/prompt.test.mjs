import assert from "node:assert/strict";
import test from "node:test";
import { buildDelegatePrompt, buildContinuePrompt } from "../dist/protocol.js";

test("buildDelegatePrompt defaults to no browser rules when env is unset", () => {
  const previousEnv = process.env.OMP_WORKER_BROWSER_RULES;
  delete process.env.OMP_WORKER_BROWSER_RULES;
  try {
    const job = {
      version: 1,
      id: "job-test-12345",
      status: "queued",
      goal: "Automate website data processing",
      cwd: "/workspace/project",
      acceptance: ["Extract 10 records", "Verify output"],
      maxAttempts: 3,
      currentAttempt: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      access: "write",
      ownership: ["output.json"],
      supervisorBrief: "General web processing",
      artifacts: [],
      verification: [],
      remaining: [],
      attempts: [],
    };

    const prompt = buildDelegatePrompt(job);

    assert.ok(!prompt.includes("## Browser Automation Rules"), "Prompt must not contain browser rules by default");
    assert.ok(prompt.includes("Task Access: write"), "Prompt must preserve ownership contract");
    assert.ok(prompt.includes("Declared Ownership: output.json"), "Prompt must preserve declared ownership");
    assert.ok(prompt.includes("## Working Directory\n/workspace/project"), "Prompt must contain working directory");
  } finally {
    if (previousEnv !== undefined) {
      process.env.OMP_WORKER_BROWSER_RULES = previousEnv;
    }
  }
});

test("buildDelegatePrompt includes custom browser rules when OMP_WORKER_BROWSER_RULES is set", () => {
  const previousEnv = process.env.OMP_WORKER_BROWSER_RULES;
  process.env.OMP_WORKER_BROWSER_RULES = "## Custom Browser Rules\n- Use headless browser\n- Timeout 30s";
  try {
    const job = {
      version: 1,
      id: "job-test-12345",
      status: "queued",
      goal: "Automate website login and data extraction",
      cwd: "/workspace/project",
      acceptance: ["Extract 10 records"],
      maxAttempts: 3,
      currentAttempt: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      access: "write",
      ownership: ["output.json"],
      supervisorBrief: "Use custom browser rules",
      artifacts: [],
      verification: [],
      remaining: [],
      attempts: [],
    };

    const prompt = buildDelegatePrompt(job);

    assert.ok(prompt.includes("## Browser Automation Rules"), "Prompt must contain browser rules header");
    assert.ok(prompt.includes("## Custom Browser Rules"), "Prompt must contain custom browser rule content");
    assert.ok(prompt.includes("Use headless browser"), "Prompt must contain custom browser instructions");
  } finally {
    if (previousEnv !== undefined) {
      process.env.OMP_WORKER_BROWSER_RULES = previousEnv;
    } else {
      delete process.env.OMP_WORKER_BROWSER_RULES;
    }
  }
});

test("buildContinuePrompt defaults to no browser rules when env is unset", () => {
  const previousEnv = process.env.OMP_WORKER_BROWSER_RULES;
  delete process.env.OMP_WORKER_BROWSER_RULES;
  try {
    const job = {
      version: 1,
      id: "job-test-67890",
      status: "failed",
      goal: "Fix scraping selector and refresh session",
      cwd: "/workspace/project",
      acceptance: ["Pass integration check"],
      maxAttempts: 3,
      currentAttempt: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artifacts: [],
      verification: [],
      remaining: [],
      attempts: [],
    };

    const prompt = buildContinuePrompt(job, "Previous run failed at step 2. Please retry.");

    assert.ok(!prompt.includes("## Browser Automation Rules"), "Continue prompt must not contain browser rules by default");
    assert.ok(prompt.includes("Supervisory Feedback"), "Continue prompt must preserve supervisory feedback");
    assert.ok(prompt.includes("Previous run failed at step 2. Please retry."), "Continue prompt must include feedback content");
  } finally {
    if (previousEnv !== undefined) {
      process.env.OMP_WORKER_BROWSER_RULES = previousEnv;
    }
  }
});

test("buildContinuePrompt includes custom browser rules when OMP_WORKER_BROWSER_RULES is set", () => {
  const previousEnv = process.env.OMP_WORKER_BROWSER_RULES;
  process.env.OMP_WORKER_BROWSER_RULES = "- Custom browser rule for continue";
  try {
    const job = {
      version: 1,
      id: "job-test-67890",
      status: "failed",
      goal: "Fix scraping selector and refresh session",
      cwd: "/workspace/project",
      acceptance: ["Pass integration check"],
      maxAttempts: 3,
      currentAttempt: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artifacts: [],
      verification: [],
      remaining: [],
      attempts: [],
    };

    const prompt = buildContinuePrompt(job, "Previous run failed at step 2. Please retry.");

    assert.ok(prompt.includes("## Browser Automation Rules"), "Continue prompt must contain browser rules header");
    assert.ok(prompt.includes("- Custom browser rule for continue"), "Continue prompt must contain custom rule content");
    assert.ok(prompt.includes("Supervisory Feedback"), "Continue prompt must preserve supervisory feedback");
  } finally {
    if (previousEnv !== undefined) {
      process.env.OMP_WORKER_BROWSER_RULES = previousEnv;
    } else {
      delete process.env.OMP_WORKER_BROWSER_RULES;
    }
  }
});
