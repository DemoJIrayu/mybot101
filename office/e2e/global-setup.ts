import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// A status file like the agents write, with fresh timestamps so nothing looks stale.
export default function globalSetup() {
  const now = Date.now() / 1000;
  const file = path.join(__dirname, "..", "test-results", "e2e-status.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      updated: now,
      agents: {
        lead: { state: "waiting", task: "รออนุมัติแผนงาน", since: now - 30, updated: now },
        dev: { state: "working", task: "งาน 1/2: สร้างหน้าเว็บ", since: now - 120, updated: now },
        qa: { state: "idle", task: "", since: now - 600, updated: now },
      },
      events: [],
    }),
  );
}
