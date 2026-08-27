import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const promptArg = args.find((value) => value.startsWith("@"));
const prompt = promptArg ? await readFile(promptArg.slice(1), "utf8") : "";

const matchTrack = prompt.match(/TRACK_CONCURRENCY:([^\s\n]+)/);
const trackerTarget = matchTrack ? matchTrack[1] : null;

let trackerDir = null;
if (trackerTarget) {
  try {
    if (existsSync(trackerTarget) && statSync(trackerTarget).isDirectory()) {
      trackerDir = trackerTarget;
    } else if (trackerTarget.endsWith(".json")) {
      trackerDir = trackerTarget.replace(/\.json$/, "_dir");
      mkdirSync(trackerDir, { recursive: true });
    } else {
      trackerDir = trackerTarget;
      mkdirSync(trackerDir, { recursive: true });
    }
  } catch {
    trackerDir = trackerTarget;
  }
}

const runId = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const startTime = Date.now();

function recordExit() {
  if (!trackerDir) return;
  const endTime = Math.max(startTime, Date.now());
  try {
    writeFileSync(
      path.join(trackerDir, `${runId}.json`),
      JSON.stringify({ pid: process.pid, start: startTime, end: endTime }),
      "utf8",
    );
  } catch {}
}

const matchDelay = prompt.match(/DELAY_TEST_(\d+)/);
if (matchDelay) {
  const ms = parseInt(matchDelay[1], 10);
  await new Promise((resolve) => setTimeout(resolve, ms));
} else if (prompt.includes("SLOW_TEST")) {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}

if (prompt.includes("FAIL_TEST")) {
  recordExit();
  console.error("Simulated task failure");
  process.exit(1);
}

const resumed = args.includes("--resume");
const sessionId = resumed ? args[args.indexOf("--resume") + 1] : "fake-session-001";
const summary = resumed ? "Corrected result" : "Initial result";
const envelope = {
  status: "completed",
  summary,
  artifacts: [{ path: "result.txt", description: "Fake integration artifact" }],
  verification: ["fake check passed"],
  remaining: [],
};
const finalText = `Fake worker finished.\nOMP_WORKER_RESULT\n${JSON.stringify(envelope)}`;
console.log(JSON.stringify({ type: "session", version: 3, id: sessionId, cwd: process.cwd() }));
console.log(
  JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: finalText }] },
  }),
);
console.log(JSON.stringify({ type: "agent_end", isTerminal: true }));

recordExit();
