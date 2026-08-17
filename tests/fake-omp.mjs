import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const promptArg = args.find((value) => value.startsWith("@"));
const prompt = promptArg ? await readFile(promptArg.slice(1), "utf8") : "";

const matchTrack = prompt.match(/TRACK_CONCURRENCY:([^\s\n]+)/);
const trackerFile = matchTrack ? matchTrack[1] : null;

function updateTracker(delta) {
  if (!trackerFile) return;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const raw = existsSync(trackerFile) ? JSON.parse(readFileSync(trackerFile, "utf8")) : { current: 0, peak: 0 };
      raw.current = Math.max(0, (raw.current || 0) + delta);
      if (raw.current > (raw.peak || 0)) raw.peak = raw.current;
      writeFileSync(trackerFile, JSON.stringify(raw), "utf8");
      break;
    } catch {
      // brief busy-wait retry for concurrent file access
      const end = Date.now() + 5;
      while (Date.now() < end) {}
    }
  }
}

// Track entrance before any delay or workload
if (trackerFile) {
  updateTracker(1);
}

const matchDelay = prompt.match(/DELAY_TEST_(\d+)/);
if (matchDelay) {
  const ms = parseInt(matchDelay[1], 10);
  await new Promise((resolve) => setTimeout(resolve, ms));
} else if (prompt.includes("SLOW_TEST")) {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}

if (prompt.includes("FAIL_TEST")) {
  if (trackerFile) {
    updateTracker(-1);
  }
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

if (trackerFile) {
  updateTracker(-1);
}
