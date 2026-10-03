// Where things are in the office and where each bot should go for its state.

import type { Role, State } from "./status";

export type Vec2 = [number, number]; // x, z on the floor

export const FLOOR = { width: 16, depth: 11 };
export const AISLE_Z = 0.4; // bots walk along this corridor between zones

export const COLORS: Record<Role, string> = {
  lead: "#f2b134", // marigold
  dev: "#3c8dff", // azure
  qa: "#2fb37a", // jade
};
export const WAITING_COLOR = "#ff5a5f"; // coral

// Desks along the back wall; the bot stands/sits in front of its desk.
export const DESKS: Record<Role, { desk: Vec2; seat: Vec2 }> = {
  lead: { desk: [-4.5, -3.4], seat: [-4.5, -2.2] },
  dev: { desk: [0, -3.4], seat: [0, -2.2] },
  qa: { desk: [4.5, -3.4], seat: [4.5, -2.2] },
};

export const MEETING_TABLE: Vec2 = [0, 3.0];
const MEETING_RADIUS = 1.55;
const MEETING_ANGLE: Record<Role, number> = { lead: Math.PI / 2, dev: Math.PI * 1.15, qa: -Math.PI * 0.15 };
export const MEETING_SEATS: Record<Role, Vec2> = Object.fromEntries(
  (Object.keys(MEETING_ANGLE) as Role[]).map((r) => [
    r,
    [
      MEETING_TABLE[0] + Math.cos(MEETING_ANGLE[r]) * MEETING_RADIUS,
      MEETING_TABLE[1] + Math.sin(MEETING_ANGLE[r]) * MEETING_RADIUS,
    ],
  ]),
) as Record<Role, Vec2>;

// Approval board near the door: waiting bots queue in front of it.
export const APPROVAL_BOARD: Vec2 = [-6.3, 2.6];
export const APPROVAL_SPOTS: Record<Role, Vec2> = {
  lead: [-5.2, 2.0],
  dev: [-5.2, 3.0],
  qa: [-5.2, 4.0],
};

// Lounge corner (sofa, plant, coffee): idle bots wander between these spots.
export const LOUNGE_SPOTS: Vec2[] = [
  [4.6, 2.2],
  [5.8, 3.2],
  [4.4, 4.0],
  [6.4, 4.3],
  [3.4, 3.1],
];

export function targetFor(role: Role, state: State, loungeIndex = 0): Vec2 {
  switch (state) {
    case "working":
      return DESKS[role].seat;
    case "meeting":
      return MEETING_SEATS[role];
    case "waiting":
      return APPROVAL_SPOTS[role];
    default:
      return LOUNGE_SPOTS[((loungeIndex % LOUNGE_SPOTS.length) + LOUNGE_SPOTS.length) % LOUNGE_SPOTS.length];
  }
}

/** Waypoints from `from` to `to`: step into the aisle, walk along it, step out. */
export function pathBetween(from: Vec2, to: Vec2): Vec2[] {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  if (near(from[0], to[0]) && near(from[1], to[1])) return [];
  const points: Vec2[] = [];
  if (!near(from[1], AISLE_Z)) points.push([from[0], AISLE_Z]);
  if (!near(from[0], to[0])) points.push([to[0], AISLE_Z]);
  points.push(to);
  // Drop consecutive duplicates.
  return points.filter((p, i) => i === 0 || !(near(p[0], points[i - 1][0]) && near(p[1], points[i - 1][1])));
}

/** Direction (yaw) a bot should face when it has arrived, per state. */
export function facingFor(role: Role, state: State, at: Vec2): number {
  const lookAt = (target: Vec2) => Math.atan2(target[0] - at[0], target[1] - at[1]);
  if (state === "working") return lookAt(DESKS[role].desk);
  if (state === "meeting") return lookAt(MEETING_TABLE);
  if (state === "waiting") return lookAt(APPROVAL_BOARD);
  return lookAt([at[0] - 1, at[1] + 2]);
}

/** Next lounge spot for an idle bot: the next one in turn that nobody is standing near. */
export function nextLoungeIndex(current: number, step: number, others: Vec2[], minGap = 1.3): number {
  const n = LOUNGE_SPOTS.length;
  for (let i = 1; i <= n; i++) {
    const idx = (((current + step * i) % n) + n) % n;
    const [x, z] = LOUNGE_SPOTS[idx];
    if (others.every(([ox, oz]) => Math.hypot(ox - x, oz - z) >= minGap)) return idx;
  }
  return current; // every spot is taken: stay put
}
