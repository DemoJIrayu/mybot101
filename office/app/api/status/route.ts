import { readFile } from "node:fs/promises";
import path from "node:path";

import { demoStatus } from "@/lib/demo";
import { deriveStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

// Written by the agents (agents/agent_team/status.py). Override with OFFICE_STATUS_FILE.
function statusFile(): string {
  return process.env.OFFICE_STATUS_FILE ?? path.join(process.cwd(), "..", "runs", "status.json");
}

export async function GET(request: Request) {
  const now = Date.now() / 1000;
  const headers = { "Cache-Control": "no-store" };
  if (new URL(request.url).searchParams.get("demo") === "1") {
    return Response.json(demoStatus(now), { headers });
  }
  let text: string;
  try {
    // The file lives outside the app (written by the agents at run time), so tell the
    // bundler not to trace it into the build.
    text = await readFile(/* turbopackIgnore: true */ statusFile(), "utf8");
  } catch {
    return Response.json(deriveStatus({}, now, "missing"), { headers });
  }
  try {
    return Response.json(deriveStatus(JSON.parse(text), now, "file"), { headers });
  } catch {
    return Response.json(deriveStatus({}, now, "invalid"), { headers });
  }
}
