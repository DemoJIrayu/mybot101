// Office layout as plain data. The same boxes drive rendering, Rapier colliders and the Recast navmesh,
// so what you see is exactly what bots walk around.
import type { BotView } from "@/lib/hub";

export type Theme = "home" | "exec" | "kitchen" | "front" | "support" | "lab" | "meeting" | "lounge";
export type Kind = "desk" | "counter" | "stove" | "wall" | "sofa" | "fridge" | "shelf" | "plant" | "table" | "board"
  | "coffee" | "cooler" | "register" | "rack" | "tv" | "arcade" | "bookshelf" | "menu";
export type Box = { kind: Kind; x: number; z: number; w: number; d: number; h: number; round?: boolean; accent?: string; owner?: string };
export type Spot = { x: number; z: number; yaw: number; label: string; emoji: string };
export type Seat = { x: number; z: number; yaw: number; zone: string };
export type Zone = { id: string; name: string; emoji: string; theme: Theme; x: number; z: number; w: number; d: number; floor: string };
export type World = { zones: Zone[]; boxes: Box[]; seats: Map<string, Seat>; pois: Spot[]; meeting: Spot[]; w: number; d: number };

const THEMES: { re: RegExp; theme: Theme; emoji: string; floor: string }[] = [
  { re: /ครัว/, theme: "kitchen", emoji: "🍳", floor: "#f6e7c8" },
  { re: /หน้าร้าน|ลูกค้า/, theme: "front", emoji: "🛎️", floor: "#f9dcdc" },
  { re: /ผู้บริหาร/, theme: "exec", emoji: "👔", floor: "#dedaf8" },
  { re: /สนับสนุน/, theme: "support", emoji: "🧰", floor: "#d6edf8" },
  { re: /ส่วนตัว/, theme: "home", emoji: "🏡", floor: "#e3f2d2" },
];
// back-wall furniture per theme: [kind, w, d, h, POI label, POI emoji]
const PROPS: Record<Theme, [Kind, number, number, number, string?, string?][]> = {
  home: [["sofa", 2.0, 0.9, 0.8, "นั่งพักบนโซฟา", "🛋️"], ["bookshelf", 1.2, 0.45, 1.8, "หยิบหนังสือ", "📚"], ["tv", 1.4, 0.4, 1.2], ["plant", 0.6, 0.6, 1.2]],
  kitchen: [["stove", 1.4, 0.8, 0.95, "ชิมซุป", "🍲"], ["fridge", 0.9, 0.8, 1.9, "เปิดตู้เย็น", "🧊"], ["counter", 1.6, 0.8, 0.95], ["shelf", 1.2, 0.45, 1.6]],
  front: [["register", 1.8, 0.8, 1.05, "นับเงินทอน", "🧾"], ["menu", 1.6, 0.25, 1.8], ["cooler", 0.6, 0.6, 1.3, "กดน้ำเย็น", "🚰"], ["plant", 0.6, 0.6, 1.2]],
  exec: [["board", 2.0, 0.25, 1.7, "ดูกราฟยอดขาย", "📈"], ["bookshelf", 1.2, 0.45, 1.8], ["plant", 0.6, 0.6, 1.2]],
  support: [["rack", 0.8, 0.8, 1.9, "เช็กเซิร์ฟเวอร์", "🖥️"], ["shelf", 1.2, 0.45, 1.6], ["cooler", 0.6, 0.6, 1.3, "กดน้ำเย็น", "🚰"]],
  lab: [["rack", 0.8, 0.8, 1.9, "เช็กเซิร์ฟเวอร์", "🖥️"], ["board", 1.6, 0.25, 1.7, "เขียนไอเดีย", "💡"], ["plant", 0.6, 0.6, 1.2]],
  meeting: [["board", 2.4, 0.25, 1.7], ["tv", 1.6, 0.4, 1.3], ["plant", 0.6, 0.6, 1.2]],
  lounge: [["coffee", 1.4, 0.7, 1.0, "ชงกาแฟ", "☕"], ["cooler", 0.6, 0.6, 1.3, "กดน้ำเย็น", "🚰"], ["arcade", 0.9, 0.8, 1.7, "เล่นเกมตู้", "🕹️"], ["bookshelf", 1.2, 0.45, 1.8, "อ่านการ์ตูน", "📖"]],
};
// seat pitch keeps ≥0.7 m walkable aisles between desks after the navmesh erodes 0.4 m around furniture
const SX = 2.8, SZ = 3.2, BACK = 2.6, DESK_W = 1.3; // BACK = depth of the furniture strip at the back wall
const DESK: Partial<Record<Theme, Kind>> = { kitchen: "counter", front: "counter" };

type Built = { w: number; d: number; boxes: Box[]; seats: [string, Seat][]; pois: Spot[]; meeting: Spot[] };

function backStrip(theme: Theme, w: number, d: number, out: Built) {
  out.boxes.push({ kind: "wall", x: 0, z: -d / 2 + 0.1, w, d: 0.2, h: 1.5 }); // low dollhouse wall: never hides the zone behind
  const props = [...PROPS[theme]];
  while (props.length > 1 && props.reduce((s, p) => s + p[1] + 0.3, 0) > w - 1) props.pop(); // narrow zone: fewer props
  const total = props.reduce((s, p) => s + p[1], 0), gap = (w - 1 - total) / (props.length + 1);
  let x = -w / 2 + 0.5 + gap;
  for (const [kind, pw, pd, ph, label, emoji] of props) {
    const cx = x + pw / 2, cz = -d / 2 + 0.2 + pd / 2;
    out.boxes.push({ kind, x: cx, z: cz, w: pw, d: pd, h: ph });
    if (label) out.pois.push({ x: cx, z: cz + pd / 2 + 0.55, yaw: Math.PI, label, emoji: emoji! });
    x += pw + gap;
  }
}

function gridZone(theme: Theme, id: string, bots: BotView[]): Built {
  const n = Math.max(bots.length, 1), cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.6))), rows = Math.ceil(n / cols);
  const w = cols * SX + 1.6, d = rows * SZ + BACK + 0.8;
  const out: Built = { w, d, boxes: [], seats: [], pois: [], meeting: [] };
  backStrip(theme, w, d, out);
  bots.forEach((b, i) => {
    const x = -w / 2 + 0.8 + SX / 2 + (i % cols) * SX, z = -d / 2 + BACK + 0.4 + Math.floor(i / cols) * SZ;
    out.seats.push([b.id, { x, z, yaw: 0, zone: id }]);
    out.boxes.push({ kind: DESK[theme] ?? "desk", x, z: z + 0.85, w: DESK_W, d: 0.8, h: 0.78, accent: b.color, owner: b.id });
  });
  return out;
}

function meetingRoom(): Built {
  const w = 10, d = 9.5, out: Built = { w, d, boxes: [], seats: [], pois: [], meeting: [] };
  backStrip("meeting", w, d, out);
  const cz = 1.0, r = 1.5;
  out.boxes.push({ kind: "table", x: 0, z: cz, w: r * 2, d: r * 2, h: 0.76, round: true });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, rr = r + 0.75;
    // face the table centre: yaw points +z at 0, so yaw = atan2(dx, dz) toward the centre
    out.meeting.push({ x: Math.sin(a) * rr, z: cz + Math.cos(a) * rr, yaw: a + Math.PI, label: "ประชุม", emoji: "🗣️" });
  }
  return out;
}

function lounge(): Built {
  const w = 10, d = 8, out: Built = { w, d, boxes: [], seats: [], pois: [], meeting: [] };
  backStrip("lounge", w, d, out);
  out.boxes.push({ kind: "sofa", x: -2.2, z: 1.6, w: 2.2, d: 0.9, h: 0.8 }, { kind: "sofa", x: 2.2, z: 1.6, w: 2.2, d: 0.9, h: 0.8 },
    { kind: "plant", x: 0, z: 1.6, w: 0.6, d: 0.6, h: 1.2 });
  out.pois.push({ x: -2.2, z: 2.6, yaw: Math.PI, label: "นั่งเล่นมือถือ", emoji: "📱" }, { x: 2.2, z: 2.6, yaw: Math.PI, label: "งีบพักสายตา", emoji: "😪" });
  return out;
}

export function buildWorld(bots: BotView[], sections: { id: string; name: string }[]): World {
  const specs: { id: string; name: string; emoji: string; theme: Theme; floor: string; built: Built }[] = [];
  const bySection = new Map<string | null, BotView[]>();
  for (const b of bots) {
    const key = sections.some(s => s.id === b.sectionId) ? b.sectionId : null;
    bySection.set(key, [...(bySection.get(key) ?? []), b]);
  }
  for (const s of sections) {
    const list = bySection.get(s.id);
    if (!list?.length) continue;
    const t = THEMES.find(t => t.re.test(s.name)) ?? { theme: "lab" as Theme, emoji: "🧪", floor: "#e6e6f2" };
    specs.push({ id: s.id, name: s.name, emoji: t.emoji, theme: t.theme, floor: t.floor, built: gridZone(t.theme, s.id, list) });
  }
  const loose = bySection.get(null);
  if (loose?.length) specs.push({ id: "lab", name: "ห้องทดลอง", emoji: "🧪", theme: "lab", floor: "#e6e6f2", built: gridZone("lab", "lab", loose) });
  specs.push({ id: "meeting", name: "ห้องประชุม", emoji: "🗣️", theme: "meeting", floor: "#fbe8c8", built: meetingRoom() });
  specs.push({ id: "lounge", name: "มุมพักผ่อน", emoji: "☕", theme: "lounge", floor: "#f5d9e8", built: lounge() });

  // shelf-pack zones into rows, 1.6 m corridors between them
  const GAP = 1.6, MAXW = 40;
  const rows: (typeof specs)[] = [[]];
  let rowW = 0;
  for (const s of specs) {
    if (rowW + s.built.w > MAXW && rows[rows.length - 1].length) { rows.push([]); rowW = 0; }
    rows[rows.length - 1].push(s);
    rowW += s.built.w + GAP;
  }
  const world: World = { zones: [], boxes: [], seats: new Map(), pois: [], meeting: [], w: 0, d: 0 };
  let z0 = 0;
  const placed: { s: (typeof specs)[number]; x: number; z: number }[] = [];
  for (const row of rows) {
    const depth = Math.max(...row.map(s => s.built.d));
    let x0 = 0;
    for (const s of row) { placed.push({ s, x: x0 + s.built.w / 2, z: z0 + depth - s.built.d / 2 }); x0 += s.built.w + GAP; }
    world.w = Math.max(world.w, x0 - GAP);
    z0 += depth + GAP;
  }
  world.d = z0 - GAP;
  for (const { s, x, z } of placed) {
    const cx = x - world.w / 2, cz = z - world.d / 2, b = s.built;
    world.zones.push({ id: s.id, name: s.name, emoji: s.emoji, theme: s.theme, x: cx, z: cz, w: b.w, d: b.d, floor: s.floor });
    for (const box of b.boxes) world.boxes.push({ ...box, x: box.x + cx, z: box.z + cz });
    for (const [id, seat] of b.seats) world.seats.set(id, { ...seat, x: seat.x + cx, z: seat.z + cz });
    for (const p of b.pois) world.pois.push({ ...p, x: p.x + cx, z: p.z + cz });
    for (const p of b.meeting) world.meeting.push({ ...p, x: p.x + cx, z: p.z + cz });
  }
  return world;
}
