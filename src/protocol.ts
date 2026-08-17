import type { JobRecord, WorkerEnvelope } from "./types.js";

const RESULT_MARKER = "OMP_WORKER_RESULT";

function acceptanceLines(job: JobRecord): string {
  return job.acceptance.length > 0
    ? job.acceptance.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "1. Deliver the requested outcome and verify the most important behavior.";
}

function resultContract(): string {
  return [
    `Your final response must end with the exact marker below followed by one valid JSON object on a single line.`,
    RESULT_MARKER,
    `{"status":"completed|blocked","summary":"short outcome","artifacts":[{"path":"relative path","description":"what changed"}],"verification":["test or check and its result"],"remaining":["unfinished item or blocker"]}`,
    `Use status=completed only when the acceptance criteria are actually met. Use status=blocked when required work remains.`,
  ].join("\n");
}

function browserAutomationRules(): string {
  return process.env.OMP_WORKER_BROWSER_RULES?.trim() || "";
}

export function buildDelegatePrompt(job: JobRecord): string {
  const supervisorBrief = job.supervisorBrief?.trim() || "No separate supervisor brief was provided.";
  const ownershipSection =
    job.access === "write"
      ? [
          "## Ownership Contract",
          "Task Access: write",
          `Declared Ownership: ${job.ownership && job.ownership.length > 0 ? job.ownership.join(", ") : "None"}`,
          "Constraint: You must only modify files/paths within your declared ownership. Shared integration files must be handled in designated dependency tasks.",
          "",
        ].join("\n")
      : job.access === "read_only"
        ? [
            "## Access Contract",
            "Task Access: read_only (strictly do not modify workspace files)",
            "",
          ].join("\n")
        : "";

  return [
    `# Goal\n${job.goal.trim()}`,
    "",
    "## Acceptance Criteria",
    acceptanceLines(job),
    "",
    ownershipSection,
    "## Supervisor Brief",
    supervisorBrief,
    ...(browserAutomationRules()
      ? ["## Browser Automation Rules", browserAutomationRules(), ""]
      : []),
    "",
    "## Working Directory",
    job.cwd,
    "",
    "## Result Contract",
    resultContract(),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildContinuePrompt(job: JobRecord, feedback: string): string {
  return [
    `# Supervisory Feedback\n${feedback.trim()}`,
    "",
    "## Original Goal",
    job.goal,
    "",
    "## Acceptance Criteria",
    acceptanceLines(job),
    "",
    ...(browserAutomationRules()
      ? ["## Browser Automation Rules", browserAutomationRules(), ""]
      : []),
    "",
    "## Result Contract",
    resultContract(),
  ].join("\n");
}

export function extractAssistantText(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const candidate = event as {
    type?: string;
    message?: { role?: string; content?: Array<{ type?: string; text?: string }> };
  };
  if (candidate.type !== "message_end" || candidate.message?.role !== "assistant") return undefined;
  const text = candidate.message.content
    ?.filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  return text || undefined;
}

export function extractSessionId(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const candidate = event as { type?: string; id?: string };
  return candidate.type === "session" && typeof candidate.id === "string" ? candidate.id : undefined;
}

export function parseResultEnvelope(text: string): WorkerEnvelope | undefined {
  const markerIndex = text.lastIndexOf(RESULT_MARKER);
  if (markerIndex < 0) return undefined;
  const afterMarker = text.slice(markerIndex + RESULT_MARKER.length).trim();
  const firstBrace = afterMarker.indexOf("{");
  const lastBrace = afterMarker.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return undefined;
  try {
    const parsed = JSON.parse(afterMarker.slice(firstBrace, lastBrace + 1)) as Partial<WorkerEnvelope>;
    if (parsed.status !== "completed" && parsed.status !== "blocked") return undefined;
    if (typeof parsed.summary !== "string") return undefined;
    if (!Array.isArray(parsed.artifacts) || !Array.isArray(parsed.verification) || !Array.isArray(parsed.remaining)) {
      return undefined;
    }
    return {
      status: parsed.status,
      summary: parsed.summary,
      artifacts: parsed.artifacts.filter(
        (item): item is { path: string; description: string } =>
          Boolean(item) && typeof item.path === "string" && typeof item.description === "string",
      ),
      verification: parsed.verification.filter((item): item is string => typeof item === "string"),
      remaining: parsed.remaining.filter((item): item is string => typeof item === "string"),
    };
  } catch {
    return undefined;
  }
}
