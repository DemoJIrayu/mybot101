import { create } from "zustand";
import type { Activity, BotView, GroupView, Msg } from "@/lib/hub";

export type Manual = { kind: "zone"; id: string } | { kind: "overview" };
export type Ball = { id: number; pos: [number, number, number]; vel: [number, number, number]; color: string };

type State = {
  bots: BotView[]; groups: GroupView[]; sections: { id: string; name: string }[]; error: string; connected: boolean;
  live: Record<string, Activity>; feed: Activity[];
  selected: string | null; hovered: string | null; focus: string | null;
  manual: Manual | null; manualAt: number;
  auto: boolean; sound: boolean; voice: boolean; throwMode: boolean; entered: boolean;
  caption: { botId: string; text: string } | null;
  balls: Ball[];
  hits: Record<string, { at: number; text: string }>;
};

export const useOffice = create<State>(() => ({
  bots: [], groups: [], sections: [], error: "", connected: false,
  live: {}, feed: [],
  selected: null, hovered: null, focus: null, manual: null, manualAt: 0,
  auto: true, sound: true, voice: true, throwMode: false, entered: false,
  caption: null, balls: [], hits: {},
}));
export const setOffice = useOffice.setState;

const listeners = new Set<(a: Activity) => void>();
export const onActivity = (fn: (a: Activity) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export function connect() {
  const es = new EventSource("/api/events"); // reconnects by itself after errors
  es.onopen = () => setOffice({ connected: true });
  es.onerror = () => setOffice({ connected: false });
  es.onmessage = ev => {
    const m = JSON.parse(ev.data) as Msg;
    if (m.type === "state") setOffice({ bots: m.bots, groups: m.groups, sections: m.sections, error: m.error, connected: true });
    else {
      const a = m.activity;
      setOffice(s => ({ live: { ...s.live, [a.botId]: a }, feed: [a, ...s.feed].slice(0, 60) }));
      listeners.forEach(fn => fn(a));
    }
  };
  return () => es.close();
}

let ballId = 0;
const BALL_COLORS = ["#ff6b8b", "#ffb347", "#6dd3a8", "#6d9dff", "#c58cff", "#ffe066"];
export function addBall(pos: [number, number, number], vel: [number, number, number]) {
  setOffice(s => ({ balls: [...s.balls, { id: ++ballId, pos, vel, color: BALL_COLORS[ballId % BALL_COLORS.length] }].slice(-14) }));
}

export const botById = (id: string | null) => (id ? useOffice.getState().bots.find(b => b.id === id) : undefined);
export const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)!) | 0; return Math.abs(h); };

export function bangkokHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Bangkok" }).format(d));
}
