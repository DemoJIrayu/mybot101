import { describe, expect, it } from "vitest";

import { AISLE_Z, APPROVAL_SPOTS, DESKS, LOUNGE_SPOTS, MEETING_SEATS, nextLoungeIndex, pathBetween, targetFor } from "@/lib/layout";
import { ROLES, STATES } from "@/lib/status";

describe("targets", () => {
  it("sends each state to its own zone", () => {
    expect(targetFor("dev", "working")).toEqual(DESKS.dev.seat);
    expect(targetFor("qa", "meeting")).toEqual(MEETING_SEATS.qa);
    expect(targetFor("lead", "waiting")).toEqual(APPROVAL_SPOTS.lead);
    expect(LOUNGE_SPOTS).toContainEqual(targetFor("dev", "idle", 3));
    expect(LOUNGE_SPOTS).toContainEqual(targetFor("dev", "idle", -1));
  });

  it("never puts two bots on the same spot in the same state", () => {
    for (const state of STATES.filter((s) => s !== "idle")) {
      const spots = ROLES.map((r) => targetFor(r, state).join(","));
      expect(new Set(spots).size).toBe(ROLES.length);
    }
  });
});

describe("pathBetween", () => {
  it("walks via the aisle and ends at the target", () => {
    const path = pathBetween(DESKS.dev.seat, APPROVAL_SPOTS.dev);
    expect(path[0]).toEqual([DESKS.dev.seat[0], AISLE_Z]);
    expect(path.at(-1)).toEqual(APPROVAL_SPOTS.dev);
  });

  it("is empty when already there", () => {
    expect(pathBetween([1, 2], [1, 2])).toEqual([]);
  });
});

describe("nextLoungeIndex", () => {
  it("skips spots another bot is standing on", () => {
    expect(nextLoungeIndex(0, 1, [])).toBe(1);
    expect(nextLoungeIndex(0, 1, [LOUNGE_SPOTS[1]])).toBe(2);
  });

  it("stays put when every spot is taken", () => {
    expect(nextLoungeIndex(3, 1, LOUNGE_SPOTS)).toBe(3);
  });
});
