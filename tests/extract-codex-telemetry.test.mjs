import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  extractNamespace,
  extractTelemetryFromFile,
  isValidSessionId,
  parseCliArgs,
  resolveSessionFileById,
} from "../benchmarks/tools/extract-codex-telemetry.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve("benchmarks/tools/extract-codex-telemetry.mjs");
const FIXTURES_DIR = path.resolve("tests/fixtures/telemetry");

test("isValidSessionId enforces strict alphanumeric, hyphen, and underscore characters", () => {
  assert.equal(isValidSessionId("12345678-abcd-1234-abcd-1234567890ab"), true);
  assert.equal(isValidSessionId("session_01_test"), true);
  assert.equal(isValidSessionId("abc123XYZ"), true);
  assert.equal(isValidSessionId(""), false);
  assert.equal(isValidSessionId("../escape"), false);
  assert.equal(isValidSessionId("session/with/slashes"), false);
  assert.equal(isValidSessionId("session\\with\\backslashes"), false);
  assert.equal(isValidSessionId("session$with!special"), false);
});

test("extractNamespace correctly isolates namespaces from tool names", () => {
  assert.equal(extractNamespace("mcp__filesystem__read_file"), "mcp__filesystem");
  assert.equal(extractNamespace("mcp__omp__run_compact"), "mcp__omp");
  assert.equal(extractNamespace("git:diff"), "git");
  assert.equal(extractNamespace("docker.container.list"), "docker.container");
  assert.equal(extractNamespace("omp_run_compact"), "default");
  assert.equal(extractNamespace(""), "default");
});

test("parseCliArgs enforces exactly one selector and rejects ambiguous / missing options", () => {
  // Help flag
  assert.deepEqual(parseCliArgs(["--help"]), { help: true });
  assert.deepEqual(parseCliArgs(["-h"]), { help: true });

  // Valid session-id
  assert.deepEqual(parseCliArgs(["--session-id", "uuid-123"]), {
    sessionId: "uuid-123",
    sessionFile: null,
    codexHome: null,
  });
  assert.deepEqual(parseCliArgs(["--session-id=uuid-123", "--codex-home=/tmp/fake"]), {
    sessionId: "uuid-123",
    sessionFile: null,
    codexHome: "/tmp/fake",
  });

  // Valid session-file
  assert.deepEqual(parseCliArgs(["--session-file", "test.jsonl"]), {
    sessionId: null,
    sessionFile: "test.jsonl",
    codexHome: null,
  });
  assert.deepEqual(parseCliArgs(["--session-file=test.jsonl"]), {
    sessionId: null,
    sessionFile: "test.jsonl",
    codexHome: null,
  });

  // Missing selector
  assert.throws(
    () => parseCliArgs([]),
    /Missing selector: exactly one of --session-id <uuid> or --session-file <path> is required/
  );

  // Ambiguous selector (both provided)
  assert.throws(
    () => parseCliArgs(["--session-id", "uuid-123", "--session-file", "test.jsonl"]),
    /Ambiguous selector input: provide either --session-id or --session-file, not both/
  );

  // Unknown options
  assert.throws(
    () => parseCliArgs(["--unknown-flag"]),
    /Unknown or unexpected argument: "--unknown-flag"/
  );

  // Incomplete options
  assert.throws(
    () => parseCliArgs(["--session-id"]),
    /Option --session-id requires a valid string argument/
  );
  assert.throws(
    () => parseCliArgs(["--session-file"]),
    /Option --session-file requires a file path argument/
  );
});

test("resolveSessionFileById resolves nested session files and rejects ambiguous or invalid targets", async () => {
  const fakeCodexHome = path.join(FIXTURES_DIR, "fake-codex-home");

  // Valid nested target
  const resolved = await resolveSessionFileById("abcd1234-ef56-7890-abcd-ef1234567890", fakeCodexHome);
  assert.ok(resolved.endsWith("rollout-20260827-010000-abcd1234-ef56-7890-abcd-ef1234567890.jsonl"));

  // Non-existent target
  await assert.rejects(
    () => resolveSessionFileById("non-existent-uuid", fakeCodexHome),
    /No session file found matching session ID/
  );

  // Ambiguous target
  await assert.rejects(
    () => resolveSessionFileById("shared-uuid", fakeCodexHome),
    /Ambiguous session ID: found 2 matching session files/
  );

  // Path traversal attempt in ID
  await assert.rejects(
    () => resolveSessionFileById("../malicious", fakeCodexHome),
    /Invalid session ID format/
  );
});

test("extractTelemetryFromFile extracts cumulative delta, rate limits, tool counts, and output bytes from standard session", async () => {
  const fixturePath = path.join(FIXTURES_DIR, "valid-standard.jsonl");
  const result = await extractTelemetryFromFile(fixturePath);

  // Token usage verification
  assert.ok(result.token_usage !== null);
  assert.deepEqual(result.token_usage.first, {
    input_tokens: 1000,
    cached_input_tokens: 600,
    output_tokens: 150,
    reasoning_output_tokens: 40,
    total_tokens: 1150,
    cache_write: 100,
  });
  assert.deepEqual(result.token_usage.last, {
    input_tokens: 4000,
    cached_input_tokens: 2200,
    output_tokens: 800,
    reasoning_output_tokens: 200,
    total_tokens: 4800,
    cache_write: 500,
  });
  assert.deepEqual(result.token_usage.delta, {
    input_tokens: 3000,
    cached_input_tokens: 1600,
    output_tokens: 650,
    reasoning_output_tokens: 160,
    total_tokens: 3650,
    cache_write: 400,
  });

  // Rate limits verification
  assert.ok(result.rate_limits !== null);
  assert.equal(result.rate_limits.primary.first_used_percent, 8.5);
  assert.equal(result.rate_limits.primary.last_used_percent, 22.0);
  assert.equal(result.rate_limits.primary.delta_used_percent, 13.5);

  // Tool invocations
  assert.equal(result.tool_invocations.total_count, 3);
  assert.deepEqual(result.tool_invocations.by_name, {
    omp_run_compact: 1,
    mcp__fs__read_file: 1,
    mcp__fs__write_file: 1,
  });
  assert.deepEqual(result.tool_invocations.by_namespace, {
    default: 1,
    mcp__fs: 2,
  });

  // Function call outputs
  assert.equal(result.function_call_outputs.total_count, 3);
  const outputs = [
    "Task completed with status: completed. Artifacts: none.",
    "{\"name\": \"data-pipeline\", \"version\": \"1.0.0\"}",
    "File written successfully (450 bytes).",
  ];
  const expectedBytes = outputs.reduce((sum, s) => sum + Buffer.byteLength(s, "utf8"), 0);
  assert.equal(result.function_call_outputs.aggregate_output_bytes, expectedBytes);
});

test("extractTelemetryFromFile handles single-sample session correctly", async () => {
  const fixturePath = path.join(FIXTURES_DIR, "single-token-sample.jsonl");
  const result = await extractTelemetryFromFile(fixturePath);

  assert.ok(result.token_usage !== null);
  assert.deepEqual(result.token_usage.first, {
    input_tokens: 500,
    cached_input_tokens: 200,
    output_tokens: 80,
    reasoning_output_tokens: 20,
    total_tokens: 580,
  });
  assert.deepEqual(result.token_usage.last, {
    input_tokens: 500,
    cached_input_tokens: 200,
    output_tokens: 80,
    reasoning_output_tokens: 20,
    total_tokens: 580,
  });
  assert.deepEqual(result.token_usage.delta, {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  });

  assert.equal(result.rate_limits.primary.first_used_percent, 4.0);
  assert.equal(result.rate_limits.primary.last_used_percent, 4.0);
  assert.equal(result.rate_limits.primary.delta_used_percent, 0.0);

  assert.equal(result.tool_invocations.total_count, 1);
  assert.equal(result.function_call_outputs.total_count, 1);
  assert.equal(result.function_call_outputs.aggregate_output_bytes, 5); // "Done."
});

test("extractTelemetryFromFile tolerates malformed lines, non-JSON noise, and multibyte UTF-8 outputs", async () => {
  const fixturePath = path.join(FIXTURES_DIR, "malformed-and-noise.jsonl");
  const result = await extractTelemetryFromFile(fixturePath);

  assert.ok(result.token_usage !== null);
  assert.deepEqual(result.token_usage.delta, {
    input_tokens: 800,
    cached_input_tokens: 400,
    output_tokens: 150,
    reasoning_output_tokens: 35,
    total_tokens: 950,
  });

  assert.equal(result.rate_limits.primary.first_used_percent, 5.0);
  assert.equal(result.rate_limits.primary.last_used_percent, 9.5);
  assert.equal(result.rate_limits.primary.delta_used_percent, 4.5);

  assert.equal(result.tool_invocations.total_count, 1);
  assert.equal(result.function_call_outputs.total_count, 1);
  // Verify UTF-8 byte calculation for:
  // "Output with UTF-8 symbols: 测试中文 🚀 & special characters."
  const expectedStr = "Output with UTF-8 symbols: 测试中文 🚀 & special characters.";
  const expectedBytes = Buffer.byteLength(expectedStr, "utf8");
  assert.equal(result.function_call_outputs.aggregate_output_bytes, expectedBytes);
});

test("extractTelemetryFromFile handles session with missing telemetry fields", async () => {
  const fixturePath = path.join(FIXTURES_DIR, "missing-fields.jsonl");
  const result = await extractTelemetryFromFile(fixturePath);

  assert.equal(result.token_usage, null);
  assert.equal(result.rate_limits, null);
  assert.equal(result.tool_invocations.total_count, 1);
  assert.deepEqual(result.tool_invocations.by_name, { tool_without_output: 1 });
  assert.equal(result.function_call_outputs.total_count, 0);
  assert.equal(result.function_call_outputs.aggregate_output_bytes, 0);
});

test("CLI child process executes with --session-file and produces clean JSON without raw payloads or absolute paths", async () => {
  const fixturePath = path.join(FIXTURES_DIR, "valid-standard.jsonl");
  const { stdout, stderr } = await execFileAsync("node", [CLI_PATH, "--session-file", fixturePath]);

  assert.equal(stderr, "");
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.telemetry_source, "codex_session_jsonl");
  assert.equal(parsed.session_metadata.selector_type, "session_file");
  assert.equal(parsed.session_metadata.selector_value, "valid-standard.jsonl");

  // Verify benchmark_token_telemetry shape
  assert.equal(parsed.benchmark_token_telemetry.available, true);
  assert.equal(parsed.benchmark_token_telemetry.telemetry_source, "codex_session_jsonl");
  assert.equal(parsed.benchmark_token_telemetry.input_tokens, 3000);
  assert.equal(parsed.benchmark_token_telemetry.output_tokens, 650);
  assert.equal(parsed.benchmark_token_telemetry.total_tokens, 3650);
  assert.ok(typeof parsed.benchmark_token_telemetry.disclosure === "string");

  // Critical safety assertions: raw message content, arguments, outputs, or absolute paths must NEVER appear
  const serialized = JSON.stringify(parsed);
  assert.ok(!serialized.includes(FIXTURES_DIR), "Output must not contain absolute fixture path");
  assert.ok(!serialized.includes("inspect data"), "Output must not contain raw tool arguments");
  assert.ok(!serialized.includes("Task completed with status"), "Output must not contain raw tool outputs");
  assert.ok(!serialized.includes("data-pipeline"), "Output must not contain message content");
});

test("CLI child process executes with --session-id and custom codex-home", async () => {
  const fakeCodexHome = path.join(FIXTURES_DIR, "fake-codex-home");
  const { stdout, stderr } = await execFileAsync("node", [
    CLI_PATH,
    "--session-id",
    "abcd1234-ef56-7890-abcd-ef1234567890",
    "--codex-home",
    fakeCodexHome,
  ]);

  assert.equal(stderr, "");
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.telemetry_source, "codex_session_jsonl");
  assert.equal(parsed.session_metadata.selector_type, "session_id");
  assert.equal(parsed.session_metadata.selector_value, "abcd1234-ef56-7890-abcd-ef1234567890");
  assert.equal(parsed.benchmark_token_telemetry.available, true);
  assert.equal(parsed.benchmark_token_telemetry.input_tokens, 0); // single sample -> delta 0
  assert.equal(parsed.rate_limits.primary.first_used_percent, 10.0);
});

test("CLI child process rejects invalid selectors with non-zero exit code", async () => {
  // No selector
  await assert.rejects(
    async () => execFileAsync("node", [CLI_PATH]),
    (err) => {
      assert.equal(err.code, 1);
      assert.ok(err.stderr.includes("Missing selector"));
      return true;
    }
  );

  // Ambiguous selectors
  await assert.rejects(
    async () => execFileAsync("node", [CLI_PATH, "--session-id", "1234", "--session-file", "file.jsonl"]),
    (err) => {
      assert.equal(err.code, 1);
      assert.ok(err.stderr.includes("Ambiguous selector input"));
      return true;
    }
  );

  // Non-existent file
  await assert.rejects(
    async () => execFileAsync("node", [CLI_PATH, "--session-file", "does-not-exist.jsonl"]),
    (err) => {
      assert.equal(err.code, 1);
      assert.ok(err.stderr.includes("ENOENT") || err.stderr.includes("not found") || err.stderr.includes("does-not-exist"));
      return true;
    }
  );
});
