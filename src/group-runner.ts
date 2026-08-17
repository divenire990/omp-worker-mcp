import { runGroupOrchestrator } from "./group-orchestrator.js";

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    throw new Error("group-runner requires a group.json path or groupId");
  }
  await runGroupOrchestrator(target);
}

main().catch((error: unknown) => {
  console.error("group-runner fatal error:", error);
  process.exit(1);
});
