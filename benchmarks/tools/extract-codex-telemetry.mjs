#!/usr/bin/env node

import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

/**
 * Validates session ID to prevent path traversal or unsafe characters.
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isValidSessionId(sessionId) {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return false;
  }
  // Allow alphanumeric characters, hyphens, and underscores
  return /^[a-zA-Z0-9_-]+$/.test(sessionId);
}

/**
 * Resolves session file for a given session ID under the Codex home sessions directory.
 * @param {string} sessionId
 * @param {string} [codexHomeOverride]
 * @returns {Promise<string>}
 */
export async function resolveSessionFileById(sessionId, codexHomeOverride) {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`Invalid session ID format: "${sessionId}". Session ID must contain only alphanumeric characters, hyphens, or underscores.`);
  }

  const codexHome = codexHomeOverride || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const sessionsDir = path.resolve(codexHome, "sessions");

  try {
    const stat = await fs.stat(sessionsDir);
    if (!stat.isDirectory()) {
      throw new Error(`Sessions path is not a directory: ${sessionsDir}`);
    }
  } catch (err) {
    throw new Error(`Codex sessions directory not found or inaccessible: ${sessionsDir}`);
  }

  // Recursively search for matching .jsonl files under sessionsDir
  const matches = [];

  async function searchDir(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      // Prevent directory traversal escape
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(sessionsDir)) {
        continue;
      }

      if (entry.isDirectory()) {
        await searchDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        // Match exact <id>.jsonl, or rollout filename containing <id>
        if (
          entry.name === `${sessionId}.jsonl` ||
          entry.name.endsWith(`-${sessionId}.jsonl`) ||
          entry.name.endsWith(`_${sessionId}.jsonl`) ||
          entry.name.includes(sessionId)
        ) {
          matches.push(resolved);
        }
      }
    }
  }

  await searchDir(sessionsDir);

  if (matches.length === 0) {
    throw new Error(`No session file found matching session ID: "${sessionId}" under ${sessionsDir}`);
  }

  if (matches.length > 1) {
    // If exact match exists among matches, prefer it
    const exactMatches = matches.filter(
      (m) => path.basename(m) === `${sessionId}.jsonl` || path.basename(m).endsWith(`-${sessionId}.jsonl`)
    );
    if (exactMatches.length === 1) {
      return exactMatches[0];
    }
    throw new Error(
      `Ambiguous session ID: found ${matches.length} matching session files for session ID "${sessionId}". Please use --session-file to disambiguate.`
    );
  }

  return matches[0];
}

/**
 * Extracts namespace from a tool/function name.
 * @param {string} toolName
 * @returns {string}
 */
export function extractNamespace(toolName) {
  if (typeof toolName !== "string" || toolName.length === 0) {
    return "default";
  }
  if (toolName.includes("__")) {
    const parts = toolName.split("__");
    return parts.slice(0, -1).join("__");
  }
  if (toolName.includes(":")) {
    return toolName.split(":")[0];
  }
  if (toolName.includes(".")) {
    const parts = toolName.split(".");
    return parts.slice(0, -1).join(".");
  }
  return "default";
}

/**
 * Streams and aggregates telemetry from a Codex session JSONL file.
 * @param {string} filePath
 * @returns {Promise<object>}
 */
export async function extractTelemetryFromFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`Specified path is not a file: ${filePath}`);
  }

  const fileStream = createReadStream(resolvedPath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let firstTokenUsage = null;
  let lastTokenUsage = null;
  let hasCacheWrite = false;

  let firstPrimaryUsedPercent = null;
  let lastPrimaryUsedPercent = null;

  const toolInvocationsByName = {};
  const toolInvocationsByNamespace = {};
  let totalToolCalls = 0;

  let functionCallOutputCount = 0;
  let aggregateOutputBytes = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      // Ignore malformed / non-JSON lines
      continue;
    }

    if (!obj || typeof obj !== "object") {
      continue;
    }

    // 1. Extract cumulative token usage
    const tokenUsageObj =
      obj?.payload?.info?.total_token_usage ??
      obj?.info?.total_token_usage ??
      obj?.payload?.total_token_usage ??
      obj?.total_token_usage;

    if (tokenUsageObj && typeof tokenUsageObj === "object") {
      const usageRecord = {
        input_tokens: Number.isFinite(tokenUsageObj.input_tokens) ? tokenUsageObj.input_tokens : 0,
        cached_input_tokens: Number.isFinite(tokenUsageObj.cached_input_tokens) ? tokenUsageObj.cached_input_tokens : 0,
        output_tokens: Number.isFinite(tokenUsageObj.output_tokens) ? tokenUsageObj.output_tokens : 0,
        reasoning_output_tokens: Number.isFinite(tokenUsageObj.reasoning_output_tokens) ? tokenUsageObj.reasoning_output_tokens : 0,
        total_tokens: Number.isFinite(tokenUsageObj.total_tokens) ? tokenUsageObj.total_tokens : 0,
      };

      const cacheWriteVal =
        tokenUsageObj.cache_write ??
        tokenUsageObj.cache_write_tokens ??
        tokenUsageObj.cache_creation_input_tokens;

      if (Number.isFinite(cacheWriteVal)) {
        usageRecord.cache_write = cacheWriteVal;
        hasCacheWrite = true;
      }

      if (!firstTokenUsage) {
        firstTokenUsage = { ...usageRecord };
      }
      lastTokenUsage = { ...usageRecord };
    }

    // 2. Extract primary rate limits used_percent
    const primaryUsedPercent =
      obj?.payload?.rate_limits?.primary?.used_percent ??
      obj?.rate_limits?.primary?.used_percent ??
      obj?.payload?.info?.rate_limits?.primary?.used_percent ??
      obj?.info?.rate_limits?.primary?.used_percent;

    if (typeof primaryUsedPercent === "number" && Number.isFinite(primaryUsedPercent)) {
      if (firstPrimaryUsedPercent === null) {
        firstPrimaryUsedPercent = primaryUsedPercent;
      }
      lastPrimaryUsedPercent = primaryUsedPercent;
    }

    // 3. Extract tool / function call invocations
    const isFunctionCall =
      (obj.type === "response_item" && obj.payload?.type === "function_call") ||
      obj.type === "function_call" ||
      obj.payload?.type === "function_call" ||
      obj.item?.type === "function_call" ||
      obj.response_item?.type === "function_call";

    if (isFunctionCall) {
      const toolName =
        obj.payload?.name ||
        obj.payload?.item?.name ||
        obj.item?.name ||
        obj.response_item?.name ||
        obj.name;

      if (typeof toolName === "string" && toolName.trim().length > 0) {
        const name = toolName.trim();
        toolInvocationsByName[name] = (toolInvocationsByName[name] || 0) + 1;
        totalToolCalls += 1;

        const ns = extractNamespace(name);
        toolInvocationsByNamespace[ns] = (toolInvocationsByNamespace[ns] || 0) + 1;
      }
    }

    // 4. Extract function call outputs and aggregate UTF-8 byte size
    const isFunctionCallOutput =
      (obj.type === "response_item" && obj.payload?.type === "function_call_output") ||
      obj.type === "function_call_output" ||
      obj.payload?.type === "function_call_output" ||
      obj.item?.type === "function_call_output" ||
      obj.response_item?.type === "function_call_output";

    if (isFunctionCallOutput) {
      functionCallOutputCount += 1;
      const rawOutput =
        obj.payload?.output ??
        obj.payload?.item?.output ??
        obj.item?.output ??
        obj.response_item?.output ??
        obj.output ??
        "";

      const outputStr = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput) ?? "";
      aggregateOutputBytes += Buffer.byteLength(outputStr, "utf8");
    }
  }

  // Calculate token usage delta
  let tokenUsage = null;
  if (firstTokenUsage && lastTokenUsage) {
    const delta = {
      input_tokens: Math.max(0, lastTokenUsage.input_tokens - firstTokenUsage.input_tokens),
      cached_input_tokens: Math.max(0, lastTokenUsage.cached_input_tokens - firstTokenUsage.cached_input_tokens),
      output_tokens: Math.max(0, lastTokenUsage.output_tokens - firstTokenUsage.output_tokens),
      reasoning_output_tokens: Math.max(0, lastTokenUsage.reasoning_output_tokens - firstTokenUsage.reasoning_output_tokens),
      total_tokens: Math.max(0, lastTokenUsage.total_tokens - firstTokenUsage.total_tokens),
    };

    if (hasCacheWrite) {
      delta.cache_write = Math.max(
        0,
        (lastTokenUsage.cache_write ?? 0) - (firstTokenUsage.cache_write ?? 0)
      );
    }

    tokenUsage = {
      first: firstTokenUsage,
      last: lastTokenUsage,
      delta,
    };
  }

  // Calculate rate limits delta
  let rateLimits = null;
  if (firstPrimaryUsedPercent !== null && lastPrimaryUsedPercent !== null) {
    rateLimits = {
      primary: {
        first_used_percent: firstPrimaryUsedPercent,
        last_used_percent: lastPrimaryUsedPercent,
        delta_used_percent: +(lastPrimaryUsedPercent - firstPrimaryUsedPercent).toFixed(4),
      },
    };
  }

  return {
    token_usage: tokenUsage,
    rate_limits: rateLimits,
    tool_invocations: {
      total_count: totalToolCalls,
      by_name: toolInvocationsByName,
      by_namespace: toolInvocationsByNamespace,
    },
    function_call_outputs: {
      total_count: functionCallOutputCount,
      aggregate_output_bytes: aggregateOutputBytes,
    },
  };
}

/**
 * Parses CLI arguments strictly requiring exactly one selector.
 * @param {string[]} args
 * @returns {{ sessionId?: string, sessionFile?: string, codexHome?: string, help?: boolean }}
 */
export function parseCliArgs(args) {
  let sessionId = null;
  let sessionFile = null;
  let codexHome = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    if (arg === "--session-id") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        throw new Error("Option --session-id requires a valid string argument.");
      }
      sessionId = args[++i];
    } else if (arg.startsWith("--session-id=")) {
      sessionId = arg.slice("--session-id=".length);
      if (!sessionId) {
        throw new Error("Option --session-id requires a non-empty string argument.");
      }
    } else if (arg === "--session-file") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        throw new Error("Option --session-file requires a file path argument.");
      }
      sessionFile = args[++i];
    } else if (arg.startsWith("--session-file=")) {
      sessionFile = arg.slice("--session-file=".length);
      if (!sessionFile) {
        throw new Error("Option --session-file requires a non-empty file path argument.");
      }
    } else if (arg === "--codex-home") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        throw new Error("Option --codex-home requires a directory path argument.");
      }
      codexHome = args[++i];
    } else if (arg.startsWith("--codex-home=")) {
      codexHome = arg.slice("--codex-home=".length);
    } else {
      throw new Error(`Unknown or unexpected argument: "${arg}". Use --help for usage information.`);
    }
  }

  if (sessionId && sessionFile) {
    throw new Error("Ambiguous selector input: provide either --session-id or --session-file, not both.");
  }

  if (!sessionId && !sessionFile) {
    throw new Error("Missing selector: exactly one of --session-id <uuid> or --session-file <path> is required.");
  }

  return { sessionId, sessionFile, codexHome };
}

/**
 * Main execution routine.
 */
export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (parsed.help) {
    process.stdout.write(`
Safe Codex Session Telemetry Extractor
======================================
Extracts aggregated token counts, primary rate limit used percent, and tool invocation metrics
from a target Codex session JSONL without printing raw message content, arguments, outputs, or absolute paths.

Usage:
  node benchmarks/tools/extract-codex-telemetry.mjs --session-id <uuid> [--codex-home <dir>]
  node benchmarks/tools/extract-codex-telemetry.mjs --session-file <path>
  node benchmarks/tools/extract-codex-telemetry.mjs --help

Options:
  --session-id <uuid>     Search and extract metrics for a session UUID under CODEX_HOME/sessions.
  --session-file <path>   Extract metrics from an explicit session JSONL file path.
  --codex-home <dir>      Override Codex home directory (defaults to CODEX_HOME env or ~/.codex).
  --help, -h              Show this help message.
\n`);
    return;
  }

  let targetFilePath;
  let selectorType;
  let selectorValue;

  try {
    if (parsed.sessionId) {
      targetFilePath = await resolveSessionFileById(parsed.sessionId, parsed.codexHome);
      selectorType = "session_id";
      selectorValue = parsed.sessionId;
    } else {
      targetFilePath = path.resolve(parsed.sessionFile);
      selectorType = "session_file";
      // Sanitized basename only, strictly omitting absolute/relative directory paths
      selectorValue = path.basename(parsed.sessionFile);
    }

    const telemetry = await extractTelemetryFromFile(targetFilePath);

    const result = {
      telemetry_source: "codex_session_jsonl",
      session_metadata: {
        selector_type: selectorType,
        selector_value: selectorValue,
      },
      token_usage: telemetry.token_usage,
      rate_limits: telemetry.rate_limits,
      tool_invocations: telemetry.tool_invocations,
      function_call_outputs: telemetry.function_call_outputs,
      benchmark_token_telemetry: {
        available: telemetry.token_usage !== null,
        telemetry_source: "codex_session_jsonl",
        input_tokens: telemetry.token_usage ? telemetry.token_usage.delta.input_tokens : null,
        output_tokens: telemetry.token_usage ? telemetry.token_usage.delta.output_tokens : null,
        total_tokens: telemetry.token_usage ? telemetry.token_usage.delta.total_tokens : null,
        disclosure: telemetry.token_usage
          ? "Extracted via benchmarks/tools/extract-codex-telemetry.mjs from session JSONL token_count events (delta values over the session)."
          : "No cumulative total_token_usage events were present in the analyzed session.",
      },
    };

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  }
}

// Direct CLI invocation
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  await main();
}
