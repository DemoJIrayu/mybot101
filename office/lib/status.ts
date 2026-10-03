// Turns the raw runs/status.json written by the agents into what the office shows.

export const ROLES = ["lead", "dev", "qa"] as const;
export type Role = (typeof ROLES)[number];

export const STATES = ["idle", "working", "waiting", "meeting"] as const;
export type State = (typeof STATES)[number];

export const ROLE_INFO: Record<Role, { name: string; title: string }> = {
  lead: { name: "Lead", title: "หัวหน้าทีม" },
  dev: { name: "Dev", title: "นักพัฒนา" },
  qa: { name: "QA", title: "ทดสอบคุณภาพ" },
};

export const STATE_LABEL: Record<State, string> = {
  idle: "ว่าง",
  working: "กำลังทำงาน",
  waiting: "รออนุมัติ",
  meeting: "ประชุม",
};

export interface AgentView {
  role: Role;
  state: State;
  task: string;
  since: number; // unix seconds
  updated: number; // unix seconds
  stale: boolean; // the agent stopped reporting; shown as idle
}

export interface OfficeStatus {
  now: number;
  agents: AgentView[];
  source: "file" | "missing" | "invalid";
}

// A running agent refreshes `updated` every few seconds. If it stops (crash, Ctrl+C
// before cleanup), treat it as idle after this long. Waiting for a human can be long.
const STALE_AFTER: Record<State, number> = {
  idle: Infinity,
  working: 15 * 60,
  meeting: 15 * 60,
  waiting: 12 * 60 * 60,
};

// Handoffs (meetings) can last only a moment; keep showing them long enough to see.
export const MEETING_DWELL = 8;

interface RawAgent {
  state?: unknown;
  task?: unknown;
  since?: unknown;
  updated?: unknown;
}

interface RawEvent {
  t?: unknown;
  role?: unknown;
  state?: unknown;
  task?: unknown;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");
const isState = (v: unknown): v is State => typeof v === "string" && (STATES as readonly string[]).includes(v);

export function deriveStatus(raw: unknown, now: number, source: OfficeStatus["source"] = "file"): OfficeStatus {
  const data = (raw && typeof raw === "object" ? raw : {}) as { agents?: Record<string, RawAgent>; events?: RawEvent[] };
  const agents = data.agents && typeof data.agents === "object" ? data.agents : {};
  const events = Array.isArray(data.events) ? data.events : [];

  const views = ROLES.map((role): AgentView => {
    const a = agents[role] ?? {};
    let state: State = isState(a.state) ? a.state : "idle";
    let task = str(a.task);
    const updated = num(a.updated, now); // no report yet: treat as just now
    let since = num(a.since, updated);
    let stale = false;

    if (state !== "idle" && now - updated > STALE_AFTER[state]) {
      state = "idle";
      task = "";
      stale = true;
    }

    if (state === "idle" && !stale) {
      const recentMeeting = [...events]
        .reverse()
        .find((e) => e.role === role && e.state === "meeting" && now - num(e.t, 0) <= MEETING_DWELL);
      if (recentMeeting) {
        state = "meeting";
        task = str(recentMeeting.task);
        since = num(recentMeeting.t, since);
      }
    }
    return { role, state, task, since, updated, stale };
  });

  return { now, agents: views, source };
}

/** Which bot the camera should follow: the most recently started worker, if any. */
export function pickFocus(agents: AgentView[]): Role | null {
  const working = agents.filter((a) => a.state === "working");
  if (working.length === 0) return null;
  return working.reduce((a, b) => (b.since > a.since ? b : a)).role;
}

export function ago(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return "เมื่อสักครู่";
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.floor(s / 86400)} วันที่แล้ว`;
}
