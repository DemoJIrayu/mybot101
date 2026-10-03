import { describe, expect, it } from "vitest";

import { ago, deriveStatus, MEETING_DWELL, pickFocus } from "@/lib/status";

const NOW = 1_000_000;
const agent = (state: string, extra: Record<string, unknown> = {}) => ({
  state,
  task: "t",
  since: NOW - 30,
  updated: NOW - 2,
  ...extra,
});

describe("deriveStatus", () => {
  it("shows all three roles idle when the file is missing or junk", () => {
    for (const raw of [undefined, null, "x", {}, { agents: 5 }]) {
      const s = deriveStatus(raw, NOW, "missing");
      expect(s.agents.map((a) => [a.role, a.state])).toEqual([
        ["lead", "idle"],
        ["dev", "idle"],
        ["qa", "idle"],
      ]);
    }
  });

  it("passes through valid states and rejects unknown ones", () => {
    const s = deriveStatus({ agents: { lead: agent("waiting"), dev: agent("working"), qa: agent("dancing") } }, NOW);
    expect(s.agents.map((a) => a.state)).toEqual(["waiting", "working", "idle"]);
  });

  it("treats a working agent that stopped reporting as idle (stale)", () => {
    const s = deriveStatus({ agents: { dev: agent("working", { updated: NOW - 16 * 60 }) } }, NOW);
    expect(s.agents[1]).toMatchObject({ state: "idle", stale: true, task: "" });
  });

  it("lets a human take hours to approve before calling it stale", () => {
    const s = deriveStatus({ agents: { lead: agent("waiting", { updated: NOW - 3 * 3600 }) } }, NOW);
    expect(s.agents[0]).toMatchObject({ state: "waiting", stale: false });
  });

  it("keeps a short meeting visible for a few seconds after it ended", () => {
    const events = [{ t: NOW - 3, role: "qa", state: "meeting", task: "QA ส่งบั๊กให้ Dev" }];
    const s = deriveStatus({ agents: { qa: agent("idle") }, events }, NOW);
    expect(s.agents[2]).toMatchObject({ state: "meeting", task: "QA ส่งบั๊กให้ Dev" });
    const later = deriveStatus({ agents: { qa: agent("idle") }, events }, NOW + MEETING_DWELL);
    expect(later.agents[2].state).toBe("idle");
  });

  it("caps very long task text", () => {
    const s = deriveStatus({ agents: { dev: agent("working", { task: "x".repeat(500) }) } }, NOW);
    expect(s.agents[1].task.length).toBe(200);
  });
});

describe("pickFocus", () => {
  it("follows the most recently started worker, or nobody", () => {
    const s = deriveStatus(
      { agents: { lead: agent("working", { since: NOW - 100 }), dev: agent("working", { since: NOW - 5 }), qa: agent("idle") } },
      NOW,
    );
    expect(pickFocus(s.agents)).toBe("dev");
    expect(pickFocus(deriveStatus({}, NOW).agents)).toBeNull();
  });
});

describe("ago", () => {
  it("speaks Thai", () => {
    expect(ago(10)).toBe("เมื่อสักครู่");
    expect(ago(125)).toBe("2 นาทีที่แล้ว");
    expect(ago(7300)).toBe("2 ชั่วโมงที่แล้ว");
  });
});
