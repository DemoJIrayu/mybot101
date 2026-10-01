// Walking without clipping: a Recast navmesh baked from the layout boxes (furniture and walls are holes) and a
// Detour crowd that plans paths and steers agents around each other. Bots' visuals and Rapier bodies follow it.
import { Crowd, NavMeshQuery, init, type CrowdAgent, type NavMesh } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import { BoxGeometry, Mesh } from "three";
import type { BotView, GroupView, Activity } from "@/lib/hub";
import type { World } from "./world";

export type Goal = { x: number; z: number; yaw: number; kind: "desk" | "poi" | "meet"; label?: string; emoji?: string; poi?: number };
export type Rt = {
  x: number; z: number; yaw: number; speed: number; arrived: boolean; goal: Goal;
  until: number; nextWander: number; lastWork: number; stuck: number;
};

const AGENT = { radius: 0.35, height: 1.4, maxAcceleration: 8, maxSpeed: 1.3, collisionQueryRange: 2.5, pathOptimizationRange: 10, separationWeight: 1.5 };
const MAX_WANDERERS = 6;

export class Nav {
  readonly rts = new Map<string, Rt>();
  private agents = new Map<string, CrowdAgent>();
  private poiBusy = new Set<number>();
  private dead = false; // a frame can still arrive after destroy(); touching freed WASM memory crashes

  private constructor(private world: World, private navMesh: NavMesh, private crowd: Crowd, private query: NavMeshQuery) {}

  static async create(world: World, bots: BotView[]) {
    await init();
    const meshes: Mesh[] = [];
    const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new Mesh(new BoxGeometry(w, h, d));
      m.position.set(x, y, z);
      m.updateMatrixWorld();
      meshes.push(m);
    };
    add(world.w + 8, 0.2, world.d + 8, 0, -0.1, 0); // floor, top at y=0
    for (const b of world.boxes) add(b.w, Math.max(b.h, 0.6), b.d, b.x, Math.max(b.h, 0.6) / 2, b.z);
    const res = threeToSoloNavMesh(meshes, { cs: 0.1, ch: 0.05, walkableRadius: 4, walkableHeight: 30, walkableClimb: 4, walkableSlopeAngle: 40, maxEdgeLen: 40 });
    meshes.forEach(m => m.geometry.dispose());
    if (!res.success) throw new Error("สร้าง navmesh ไม่สำเร็จ: " + res.error);
    const crowd = new Crowd(res.navMesh, { maxAgents: Math.max(64, bots.length + 8), maxAgentRadius: 0.6 });
    const nav = new Nav(world, res.navMesh, crowd, new NavMeshQuery(res.navMesh));
    const now = performance.now();
    for (const b of bots) {
      const seat = world.seats.get(b.id);
      if (!seat) continue;
      const p = nav.snap(seat.x, seat.z);
      nav.agents.set(b.id, crowd.addAgent(p, AGENT));
      nav.rts.set(b.id, {
        x: seat.x, z: seat.z, yaw: seat.yaw, speed: 0, arrived: true, goal: { x: seat.x, z: seat.z, yaw: seat.yaw, kind: "desk" },
        until: 0, nextWander: now + 8000 + Math.random() * 60000, lastWork: 0, stuck: 0,
      });
    }
    return nav;
  }

  private snap(x: number, z: number) {
    const r = this.query.findClosestPoint({ x, y: 0, z }, { halfExtents: { x: 2, y: 2, z: 2 } });
    return r.success ? r.point : { x, y: 0, z };
  }

  private setGoal(id: string, goal: Goal) {
    const rt = this.rts.get(id), agent = this.agents.get(id);
    if (!rt || !agent) return;
    if (rt.goal.poi != null) this.poiBusy.delete(rt.goal.poi);
    if (goal.poi != null) this.poiBusy.add(goal.poi);
    rt.goal = goal;
    rt.arrived = false;
    agent.requestMoveTarget(this.snap(goal.x, goal.z));
  }

  // decide where every bot wants to be (called a few times per second)
  think(now: number, bots: BotView[], groups: GroupView[], feed: Activity[]) {
    if (this.dead) return;
    const meet = new Map<string, number>();
    const wall = Date.now();
    const attendees = new Set<string>();
    for (const g of groups)
      if (feed.some(a => a.groupId === g.id && wall - a.at < 45000)) g.members.forEach(id => attendees.add(id));
    // spread evenly around the table instead of bunching on one side
    [...attendees].forEach((id, i) => meet.set(id, Math.floor((i * this.world.meeting.length) / attendees.size)));
    let wanderers = [...this.rts.values()].filter(r => r.goal.kind === "poi").length;

    for (const b of bots) {
      const rt = this.rts.get(b.id), seat = this.world.seats.get(b.id);
      if (!rt || !seat) continue;
      const desk: Goal = { x: seat.x, z: seat.z, yaw: seat.yaw, kind: "desk" };
      if (b.working) rt.lastWork = now;
      const m = meet.get(b.id);
      let want: Goal | null = null;
      if (m != null && this.world.meeting.length) want = { ...this.world.meeting[m % this.world.meeting.length], kind: "meet" };
      else if (b.working) want = desk;
      else if (rt.goal.kind === "poi" && now < rt.until) want = null; // on the way or taking a break
      else if (rt.goal.kind !== "desk") want = desk;
      else if (rt.arrived && now > rt.nextWander && wanderers < MAX_WANDERERS && now - rt.lastWork > 20000) {
        const free = this.world.pois.map((_, i) => i).filter(i => !this.poiBusy.has(i));
        if (free.length) {
          const i = free[Math.floor(Math.random() * free.length)], p = this.world.pois[i];
          want = { x: p.x, z: p.z, yaw: p.yaw, kind: "poi", label: p.label, emoji: p.emoji, poi: i };
          rt.until = now + (Math.hypot(p.x - rt.x, p.z - rt.z) / 1.1) * 1000 + 8000 + Math.random() * 10000;
          wanderers++;
        }
        rt.nextWander = now + 45000 + Math.random() * 90000;
      }
      if (want && (want.kind !== rt.goal.kind || Math.hypot(want.x - rt.goal.x, want.z - rt.goal.z) > 0.05)) this.setGoal(b.id, want);
    }
  }

  update(dt: number) {
    if (this.dead) return;
    this.crowd.update(1 / 30, Math.min(dt, 0.25)); // fixed steps + interpolation (the 1-arg form never interpolates)
    for (const [id, agent] of this.agents) {
      const rt = this.rts.get(id)!, p = agent.interpolatedPosition, v = agent.velocity();
      rt.speed = Math.hypot(v.x, v.z);
      const d = Math.hypot(p.x - rt.goal.x, p.z - rt.goal.z);
      // snap the agent onto the spot too: others steer around the agent, so it must sit where the body is drawn
      if (!rt.arrived && d < 0.35 && rt.speed < 0.4) { rt.arrived = true; agent.teleport(this.snap(rt.goal.x, rt.goal.z)); }
      if (rt.arrived && d > 0.8) { rt.arrived = false; agent.requestMoveTarget(this.snap(rt.goal.x, rt.goal.z)); } // pushed away: walk back
      // jammed against other bots in an aisle: replan (Detour picks a new corridor/ordering) instead of freezing
      rt.stuck = !rt.arrived && rt.speed < 0.1 ? rt.stuck + dt : 0;
      if (rt.stuck > 2.5) { rt.stuck = 0; agent.requestMoveTarget(this.snap(rt.goal.x, rt.goal.z)); }
      // at the goal the visual eases onto the exact spot; the agent stays nearby as an obstacle for others
      const tx = rt.arrived ? rt.goal.x : p.x, tz = rt.arrived ? rt.goal.z : p.z, k = rt.arrived ? Math.min(1, dt * 4) : 1;
      rt.x += (tx - rt.x) * k;
      rt.z += (tz - rt.z) * k;
      const yaw = rt.speed > 0.15 ? Math.atan2(v.x, v.z) : rt.arrived ? rt.goal.yaw : rt.yaw;
      rt.yaw += Math.atan2(Math.sin(yaw - rt.yaw), Math.cos(yaw - rt.yaw)) * Math.min(1, dt * 8);
    }
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.crowd.destroy();
    this.query.destroy();
    this.navMesh.destroy();
  }
}
