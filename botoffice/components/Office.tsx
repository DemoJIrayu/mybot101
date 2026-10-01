"use client";
import { CameraControls, Html, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { CuboidCollider, CylinderCollider, Physics, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Color, Vector3 } from "three";
import { Bot } from "./Bot";
import { Nav } from "./crowd";
import { Props } from "./Props";
import { sfx, speak, phrase } from "./sound";
import { addBall, bangkokHour, onActivity, setOffice, useOffice, type Ball as BallT } from "./store";
import { buildWorld, type World } from "./world";

// ---------- light & sky follow the real time in Bangkok ----------
const SKY = {
  day: { bg: "#cfe9ff", sun: "#fff3dd", sunI: 2.4, hemi: 1.0, ground: "#e9dcc9" },
  golden: { bg: "#ffd9bd", sun: "#ffb27a", sunI: 1.8, hemi: 0.8, ground: "#e8c8b0" },
  night: { bg: "#232848", sun: "#9fb0ff", sunI: 0.55, hemi: 0.35, ground: "#3a3350" },
};
function useSky() {
  const [hour, setHour] = useState(() => bangkokHour());
  useEffect(() => { const t = setInterval(() => setHour(bangkokHour()), 60000); return () => clearInterval(t); }, []);
  return hour >= 7 && hour < 17 ? SKY.day : (hour >= 17 && hour < 19) || (hour >= 6 && hour < 7) ? SKY.golden : SKY.night;
}

function Lights({ world }: { world: World }) {
  const sky = useSky(), s = Math.max(world.w, world.d) / 2 + 4;
  const scene = useThree(st => st.scene);
  useEffect(() => { scene.background = new Color(sky.bg); }, [scene, sky]);
  return (
    <>
      <hemisphereLight args={["#ffffff", sky.ground, sky.hemi]} />
      <directionalLight position={[s * 0.6, s * 1.2, s * 0.8]} intensity={sky.sunI} color={sky.sun} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-s} shadow-camera-right={s} shadow-camera-top={s} shadow-camera-bottom={-s} shadow-camera-far={s * 4} />
    </>
  );
}

// ---------- static geometry: floor, zone rugs & signs, furniture colliders ----------
const Rooms = memo(function Rooms({ world }: { world: World }) {
  const throwAt = (e: ThreeEvent<MouseEvent>) => {
    if (!useOffice.getState().throwMode || e.delta > 4) return;
    e.stopPropagation();
    const from = e.camera.position.clone().add(new Vector3(0, -0.5, 0)), to = e.point;
    const T = Math.max(0.5, from.distanceTo(to) / 16); // flight time; exact ballistic arc under gravity
    addBall([from.x, from.y, from.z], [(to.x - from.x) / T, (to.y - from.y) / T + 0.5 * 9.81 * T, (to.z - from.z) / T]);
    sfx("whoosh");
  };
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[world.w / 2 + 6, 0.5, world.d / 2 + 6]} position={[0, -0.5, 0]} />
        {world.boxes.map((b, i) => b.round
          ? <CylinderCollider key={i} args={[b.h / 2, b.w / 2]} position={[b.x, b.h / 2, b.z]} />
          : <CuboidCollider key={i} args={[b.w / 2, b.h / 2, b.d / 2]} position={[b.x, b.h / 2, b.z]} />)}
      </RigidBody>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.001, 0]} receiveShadow onClick={throwAt}>
        <planeGeometry args={[world.w + 12, world.d + 12]} />
        <meshStandardMaterial color="#efe6da" roughness={1} />
      </mesh>
      {world.zones.map(z => (
        <group key={z.id}>
          <RoundedBox args={[z.w, 0.04, z.d]} radius={0.02} position={[z.x, 0.02, z.z]} receiveShadow onClick={throwAt}>
            <meshStandardMaterial color={z.floor} roughness={0.9} />
          </RoundedBox>
          <Html position={[z.x, 1.9, z.z - z.d / 2 + 0.2]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className="zone-sign">{z.emoji} {z.name}</div>
          </Html>
        </group>
      ))}
    </>
  );
});

// ---------- thrown balls: real rigid bodies ----------
function Ball({ b }: { b: BallT }) {
  const ref = useRef<RapierRigidBody>(null);
  const lastBoing = useRef(0);
  return (
    <RigidBody ref={ref} colliders="ball" position={b.pos} linearVelocity={b.vel} restitution={0.72} friction={0.6}
      linearDamping={0.15} angularDamping={0.3} mass={0.4} ccd
      onCollisionEnter={({ other }) => {
        const v = ref.current?.linvel(), speed = v ? Math.hypot(v.x, v.y, v.z) : 0, now = performance.now();
        const botId = (other.rigidBody?.userData as { botId?: string } | undefined)?.botId;
        if (botId && speed > 2) {
          const text = phrase("hit");
          setOffice(s => ({ hits: { ...s.hits, [botId]: { at: Date.now(), text } } }));
          sfx("boing"); speak(botId, text);
        } else if (speed > 2.5 && now - lastBoing.current > 150) { lastBoing.current = now; sfx("thud", 0, Math.min(1, speed / 10)); }
      }}>
      <mesh castShadow>
        <sphereGeometry args={[0.26, 24, 18]} />
        <meshStandardMaterial color={b.color} roughness={0.35} />
      </mesh>
    </RigidBody>
  );
}
function Balls() {
  const balls = useOffice(s => s.balls);
  return <>{balls.map(b => <Ball key={b.id} b={b} />)}</>;
}

function DevHandle() {
  const { world } = useRapier();
  useEffect(() => { Object.assign(window, { __rapier: world }); }, [world]);
  return null;
}

// ---------- bots + crowd ----------
function Crowd({ world, nav }: { world: World; nav: Nav | null }) {
  const bots = useOffice(s => s.bots), live = useOffice(s => s.live), hits = useOffice(s => s.hits);
  const focus = useOffice(s => s.focus), selected = useOffice(s => s.selected), hovered = useOffice(s => s.hovered);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const acc = useRef(0);
  useFrame((_, dt) => {
    if (!nav) return;
    acc.current += dt;
    if (acc.current > 0.4) { acc.current = 0; const s = useOffice.getState(); nav.think(performance.now(), s.bots, s.groups, s.feed); }
    nav.update(dt);
  });
  return (
    <>
      {bots.filter(b => world.seats.has(b.id)).map(b => (
        <Bot key={b.id} bot={b} rt={nav?.rts.get(b.id)} act={live[b.id]} hit={hits[b.id]} now={now}
          focused={focus === b.id} selected={selected === b.id} hovered={hovered === b.id} />
      ))}
    </>
  );
}

// ---------- camera director: zooms/pans to whoever is doing something ----------
function Director({ world, nav }: { world: World; nav: Nav | null }) {
  const cc = useRef<CameraControls>(null);
  const st = useRef({ focus: "" as string, since: 0, pausedUntil: 0, retarget: 0, rotate: 0 });
  useEffect(() => {
    const c = cc.current!;
    c.smoothTime = 0.6;
    const pause = () => { st.current.pausedUntil = performance.now() + 15000; };
    c.addEventListener("controlstart", pause);
    return () => c.removeEventListener("controlstart", pause);
  }, []);

  useFrame((_, dt) => {
    const c = cc.current, s = useOffice.getState(), now = performance.now(), wall = Date.now(), d = st.current;
    if (!c || !nav) return;
    if (now < d.pausedUntil && !s.selected) return; // the user is driving
    let want = "overview", closeness = 6;
    if (s.selected) { want = "bot:" + s.selected; closeness = 4.2; }
    else if (s.manual && wall - s.manualAt < 25000) want = s.manual.kind === "zone" ? "zone:" + s.manual.id : "overview";
    else if (s.auto) {
      const recent = s.feed.find(a => wall - a.at < 15000 && nav.rts.has(a.botId));
      const working = s.bots.filter(b => b.working && nav.rts.has(b.id));
      if (recent) { want = "bot:" + recent.botId; closeness = recent.kind === "say" || recent.kind === "ask" ? 3.8 : 5; }
      else if (working.length) want = "bot:" + working[Math.floor(wall / 10000) % working.length].id;
    } else return;
    // dwell: don't cut from one bot to another in under 6 s unless the user asked; leave the overview at once
    if (want !== d.focus && (!d.focus.startsWith("bot:") || now - d.since > 6000 || s.selected || want.startsWith("zone"))) {
      d.focus = want; d.since = now; d.retarget = 0;
      setOffice({ focus: want.startsWith("bot:") ? want.slice(4) : null });
      sfx("whoosh", 0, 0.6);
    }
    d.retarget -= dt;
    if (d.focus.startsWith("bot:")) {
      const rt = nav.rts.get(d.focus.slice(4));
      if (rt && d.retarget <= 0) { // follow walkers smoothly
        d.retarget = 0.5;
        // a bot in a meeting: frame the whole table so faces on the far side are visible
        const meet = rt.goal.kind === "meet" && rt.arrived && world.meeting.length;
        const x = meet ? world.meeting.reduce((a, m) => a + m.x, 0) / world.meeting.length : rt.x;
        const z = meet ? world.meeting.reduce((a, m) => a + m.z, 0) / world.meeting.length : rt.z;
        const k = meet ? 8 : closeness;
        void c.setLookAt(x + k * 0.35, 1.0 + k * 0.62, z + k * 0.9, x, meet ? 0.6 : 0.95, z, true);
      }
    } else if (d.focus.startsWith("zone:")) {
      const z = world.zones.find(z => "zone:" + z.id === d.focus);
      if (z && d.retarget <= 0) { d.retarget = 999; const k = Math.max(z.w, z.d) * 0.95; void c.setLookAt(z.x + k * 0.2, k * 0.75, z.z + k * 0.85, z.x, 0, z.z, true); }
    } else {
      if (d.retarget <= 0) { d.retarget = 999; const k = Math.max(world.w, world.d) * 0.9; void c.setLookAt(0, k * 0.8, k * 0.72, 0, 0, 0, true); }
      // slow sway around the front view (a full orbit would look at the back walls half the time)
      if (now - d.since > 2500) void c.rotateAzimuthTo(Math.sin((now - d.since - 2500) / 1000 * 0.07) * 0.6, false);
    }
  });
  return <CameraControls ref={cc} makeDefault maxPolarAngle={Math.PI * 0.46} minDistance={2.5} maxDistance={120} />;
}

// ---------- sounds & voice for live events, panned to where the bot is on screen ----------
function Reactor({ nav }: { nav: Nav | null }) {
  const camera = useThree(s => s.camera), size = useThree(s => s.size);
  const v = useMemo(() => new Vector3(), []);
  useEffect(() => onActivity(a => {
    const rt = nav?.rts.get(a.botId), s = useOffice.getState();
    const pan = rt ? v.set(rt.x, 1, rt.z).project(camera).x : 0;
    sfx(a.kind === "tool" ? "tool" : a.kind === "say" ? "say" : a.kind, pan * 0.8);
    const spotlight = a.botId === s.focus || a.botId === s.selected;
    if (a.kind === "say" && spotlight) speak(a.botId, a.label);
    else if (a.kind === "ask" || a.kind === "fail" || ((a.kind === "start" || a.kind === "done") && spotlight)) speak(a.botId, phrase(a.kind));
  }), [nav, camera, size, v]);
  // soft keyboard clicks from the bot in focus while it works
  const next = useRef(0);
  useFrame(({ clock }) => {
    const s = useOffice.getState(), b = s.focus ? s.bots.find(x => x.id === s.focus) : null;
    if (!b?.working || clock.elapsedTime < next.current) return;
    next.current = clock.elapsedTime + 0.08 + Math.random() * 0.22;
    sfx("type");
  });
  return null;
}

export default function Office() {
  const bots = useOffice(s => s.bots), sections = useOffice(s => s.sections);
  // rebuild the layout only when the set of bots or sections changes, not on every status update
  const key = JSON.stringify([bots.map(b => [b.id, b.sectionId, b.color]), sections]);
  const world = useMemo(() => buildWorld(bots, sections), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nav, setNav] = useState<Nav | null>(null);
  useEffect(() => {
    if (!bots.length) return;
    let dead = false, made: Nav | null = null;
    Nav.create(world, useOffice.getState().bots)
      .then(n => {
        made = n;
        if (dead) return n.destroy();
        setNav(n);
        if (process.env.NODE_ENV !== "production") Object.assign(window, { __nav: n, __world: world }); // dev-only test handles
      })
      .catch(e => setOffice({ error: String(e.message ?? e) }));
    return () => { dead = true; setNav(null); made?.destroy(); };
  }, [world]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 38, position: [0, 40, 40], near: 0.1, far: 400 }}
      onPointerMissed={() => setOffice({ selected: null })}>
      <Lights world={world} />
      <Physics gravity={[0, -9.81, 0]}>
        <Rooms world={world} />
        <Crowd world={world} nav={nav} />
        <Balls />
        {process.env.NODE_ENV !== "production" && <DevHandle />}
      </Physics>
      <Props boxes={world.boxes} />
      <Director world={world} nav={nav} />
      <Reactor nav={nav} />
    </Canvas>
  );
}
