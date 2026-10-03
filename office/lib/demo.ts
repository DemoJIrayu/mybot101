// Demo mode (?demo=1): a scripted day at the office, for trying the page with no agents.

import { deriveStatus, type OfficeStatus, type Role, type State } from "./status";

const SCRIPT: { lead: State; dev: State; qa: State; task: Partial<Record<Role, string>> }[] = [
  { lead: "working", dev: "idle", qa: "idle", task: { lead: "วางแผน: หน้าเว็บเครื่องคิดเลข" } },
  { lead: "waiting", dev: "idle", qa: "idle", task: { lead: "รออนุมัติแผนงาน" } },
  { lead: "idle", dev: "working", qa: "idle", task: { dev: "งาน 1/2: สร้างหน้า web/app/page.tsx" } },
  { lead: "idle", dev: "working", qa: "idle", task: { dev: "งาน 2/2: เพิ่ม unit test" } },
  { lead: "idle", dev: "idle", qa: "working", task: { qa: "ทดสอบรอบ 1: Playwright" } },
  { lead: "meeting", dev: "meeting", qa: "meeting", task: { lead: "QA ส่งบั๊ก 1 ข้อให้ Dev", dev: "QA ส่งบั๊ก 1 ข้อให้ Dev", qa: "QA ส่งบั๊ก 1 ข้อให้ Dev" } },
  { lead: "idle", dev: "working", qa: "idle", task: { dev: "แก้บั๊กรอบ 1" } },
  { lead: "meeting", dev: "meeting", qa: "meeting", task: { lead: "สรุปงานก่อนเปิด PR", dev: "สรุปงานก่อนเปิด PR", qa: "สรุปงานก่อนเปิด PR" } },
  { lead: "idle", dev: "idle", qa: "idle", task: {} },
];
export const DEMO_STEP_SECONDS = 12;

export function demoStatus(now: number): OfficeStatus {
  const step = Math.floor(now / DEMO_STEP_SECONDS) % SCRIPT.length;
  const started = now - (now % DEMO_STEP_SECONDS);
  const s = SCRIPT[step];
  const agents = Object.fromEntries(
    (["lead", "dev", "qa"] as Role[]).map((r) => [r, { state: s[r], task: s.task[r] ?? "", since: started, updated: now }]),
  );
  return deriveStatus({ agents, events: [] }, now, "file");
}
