"use client";

import { Html, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  APPROVAL_BOARD,
  COLORS,
  DESKS,
  facingFor,
  FLOOR,
  MEETING_TABLE,
  nextLoungeIndex,
  pathBetween,
  targetFor,
  type Vec2,
  WAITING_COLOR,
} from "@/lib/layout";
import type { Lighting } from "@/lib/sky";
import { type AgentView, ROLE_INFO, type Role, STATE_LABEL, type State } from "@/lib/status";

type Positions = Record<Role, THREE.Vector3>;

interface SceneProps {
  agents: AgentView[];
  lighting: Lighting;
  focus: Role | null;
  reducedMotion: boolean;
}

const WALK_SPEED = 1.7; // floor units per second
const WOOD = "#d8c3a0";
const WALL = "#eef1ec";

export default function OfficeScene({ agents, lighting, focus, reducedMotion }: SceneProps) {
  const positions = useMemo<Positions>(
    () => ({ lead: new THREE.Vector3(), dev: new THREE.Vector3(), qa: new THREE.Vector3() }),
    [],
  );
  const working = new Set(agents.filter((a) => a.state === "working").map((a) => a.role));

  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 2]}
      camera={{ position: [11, 12, 15], fov: 32, near: 0.1, far: 200 }}
      fallback={<div className="stage-message">เบราว์เซอร์นี้แสดง 3D (WebGL) ไม่ได้ ดูสถานะทีมได้ในรายการด้านล่าง</div>}
      aria-label="ออฟฟิศ 3D ของทีมบอท"
    >
      <color attach="background" args={[lighting.sky]} />
      <fog attach="fog" args={[lighting.sky, 34, 70]} />
      {lighting.stars && <Stars radius={70} depth={20} count={1400} factor={3} fade speed={reducedMotion ? 0 : 0.4} />}

      <hemisphereLight args={["#ffffff", "#8a7a62", lighting.ambient]} />
      <ambientLight color={lighting.sky} intensity={0.25} />
      <directionalLight
        castShadow
        position={lighting.sunPosition}
        intensity={lighting.sunIntensity}
        color={lighting.sunColor}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      <Lamps on={lighting.lampsOn} />

      <Room />
      {(Object.keys(DESKS) as Role[]).map((r) => (
        <Desk key={r} role={r} active={working.has(r)} lampOn={lighting.lampsOn} />
      ))}
      <MeetingTable />
      <ApprovalBoard />
      <Lounge />

      {agents.map((a) => (
        <Bot key={a.role} agent={a} positions={positions} reducedMotion={reducedMotion} />
      ))}
      <CameraRig focus={focus} positions={positions} reducedMotion={reducedMotion} />
    </Canvas>
  );
}

/* ----------------------------------------------------------------- the room */

function Room() {
  const w = FLOOR.width;
  const d = FLOOR.depth;
  // Back wall with three windows: solid pieces between the gaps.
  const back = [
    { x: -6.9, w: 2.2 },
    { x: -2.25, w: 1.5 },
    { x: 2.25, w: 1.5 },
    { x: 6.9, w: 2.2 },
  ];
  return (
    <group>
      {/* floor slab (the diorama plinth) */}
      <mesh receiveShadow position={[0, -0.2, 0]}>
        <boxGeometry args={[w, 0.4, d]} />
        <meshStandardMaterial color={WOOD} roughness={0.85} />
      </mesh>
      <mesh position={[0, -0.75, 0]}>
        <boxGeometry args={[w + 0.3, 0.7, d + 0.3]} />
        <meshStandardMaterial color="#6f7d86" roughness={1} />
      </mesh>
      {/* rug under the meeting table */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[MEETING_TABLE[0], 0.01, MEETING_TABLE[1]]}>
        <circleGeometry args={[2.4, 48]} />
        <meshStandardMaterial color="#c9d6dc" roughness={1} />
      </mesh>
      {/* back wall pieces + window sill and lintel */}
      {back.map((p) => (
        <mesh key={p.x} castShadow receiveShadow position={[p.x, 1.3, -d / 2 + 0.1]}>
          <boxGeometry args={[p.w, 2.6, 0.2]} />
          <meshStandardMaterial color={WALL} />
        </mesh>
      ))}
      <mesh position={[0, 0.35, -d / 2 + 0.1]} receiveShadow>
        <boxGeometry args={[w, 0.7, 0.22]} />
        <meshStandardMaterial color={WALL} />
      </mesh>
      <mesh position={[0, 2.45, -d / 2 + 0.1]}>
        <boxGeometry args={[w, 0.3, 0.22]} />
        <meshStandardMaterial color={WALL} />
      </mesh>
      {/* left wall with a doorway next to the approval board */}
      <mesh castShadow receiveShadow position={[-w / 2 + 0.1, 1.3, -2.3]}>
        <boxGeometry args={[0.2, 2.6, 6.4]} />
        <meshStandardMaterial color={WALL} />
      </mesh>
      <mesh castShadow receiveShadow position={[-w / 2 + 0.1, 1.3, 4.6]}>
        <boxGeometry args={[0.2, 2.6, 1.8]} />
        <meshStandardMaterial color={WALL} />
      </mesh>
      <mesh position={[-w / 2 + 0.1, 2.45, 2.25]}>
        <boxGeometry args={[0.2, 0.3, 2.9]} />
        <meshStandardMaterial color={WALL} />
      </mesh>
    </group>
  );
}

function Lamps({ on }: { on: boolean }) {
  // Invisible warm lights over the work areas; the visible lamps are on the desks.
  const spots: [number, number, number][] = [
    [-4.5, 2.4, -2.4],
    [0, 2.4, -2.4],
    [4.5, 2.4, -2.4],
    [MEETING_TABLE[0], 2.4, MEETING_TABLE[1]],
    [5.2, 2.4, 3.2],
  ];
  if (!on) return null;
  return (
    <group>
      {spots.map((p, i) => (
        <pointLight key={i} position={p} intensity={5} distance={7} decay={1.5} color="#ffd9a0" />
      ))}
    </group>
  );
}

function DeskLamp({ on }: { on: boolean }) {
  return (
    <group position={[-0.8, 0.82, -0.25]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.12, 0.14, 0.04, 16]} />
        <meshStandardMaterial color="#5b6770" />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.5, 8]} />
        <meshStandardMaterial color="#5b6770" />
      </mesh>
      <mesh position={[0.08, 0.5, 0]} rotation={[0, 0, -0.5]}>
        <coneGeometry args={[0.13, 0.18, 16, 1, true]} />
        <meshStandardMaterial color="#fff3d6" emissive="#ffd38a" emissiveIntensity={on ? 1.8 : 0.02} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Desk({ role, active, lampOn }: { role: Role; active: boolean; lampOn: boolean }) {
  const [x, z] = DESKS[role].desk;
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!screen.current) return;
    // Screens flicker gently while their owner is working.
    screen.current.emissiveIntensity = active ? 1.1 + Math.sin(clock.elapsedTime * 6) * 0.15 : 0.08;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh castShadow receiveShadow position={[0, 0.78, 0]}>
        <boxGeometry args={[2.2, 0.08, 1.0]} />
        <meshStandardMaterial color="#f4f1ea" roughness={0.6} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[s * 1.0, 0.39, 0]}>
          <boxGeometry args={[0.07, 0.78, 0.9]} />
          <meshStandardMaterial color="#5b6770" />
        </mesh>
      ))}
      {/* monitor */}
      <mesh castShadow position={[0, 1.22, -0.2]}>
        <boxGeometry args={[1.0, 0.62, 0.06]} />
        <meshStandardMaterial color="#26313a" />
      </mesh>
      <mesh position={[0, 1.22, -0.165]}>
        <planeGeometry args={[0.9, 0.52]} />
        <meshStandardMaterial ref={screen} color="#10161b" emissive={COLORS[role]} emissiveIntensity={0.08} />
      </mesh>
      <mesh position={[0, 0.88, -0.2]}>
        <boxGeometry args={[0.08, 0.2, 0.08]} />
        <meshStandardMaterial color="#26313a" />
      </mesh>
      <DeskLamp on={lampOn} />
      {/* name plate */}
      <mesh position={[0.75, 0.86, 0.3]}>
        <boxGeometry args={[0.4, 0.08, 0.14]} />
        <meshStandardMaterial color={COLORS[role]} />
      </mesh>
    </group>
  );
}

function MeetingTable() {
  return (
    <group position={[MEETING_TABLE[0], 0, MEETING_TABLE[1]]}>
      <mesh castShadow receiveShadow position={[0, 0.72, 0]}>
        <cylinderGeometry args={[1.0, 1.0, 0.08, 40]} />
        <meshStandardMaterial color="#f4f1ea" roughness={0.5} />
      </mesh>
      <mesh castShadow position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.1, 0.25, 0.72, 16]} />
        <meshStandardMaterial color="#5b6770" />
      </mesh>
    </group>
  );
}

function ApprovalBoard() {
  const [x, z] = APPROVAL_BOARD;
  return (
    <group>
      <group position={[x, 0, z]} rotation={[0, Math.PI / 2, 0]}>
        <mesh castShadow position={[0, 0.7, 0]}>
          <boxGeometry args={[0.08, 1.4, 0.08]} />
          <meshStandardMaterial color="#5b6770" />
        </mesh>
        <mesh castShadow position={[0, 1.55, 0]}>
          <boxGeometry args={[1.5, 0.8, 0.07]} />
          <meshStandardMaterial color={WAITING_COLOR} roughness={0.7} />
        </mesh>
        <SignFace text="รออนุมัติ" />
      </group>
    </group>
  );
}

/** Text painted onto the sign, drawn with the page's own (already loaded) Thai font. */
function SignFace({ text }: { text: string }) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    let alive = true;
    let made: THREE.CanvasTexture | null = null;
    const draw = () => {
      if (!alive) return;
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 272;
      const g = canvas.getContext("2d");
      if (!g) return;
      g.fillStyle = WAITING_COLOR;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = "#ffffff";
      g.font = '600 96px "IBM Plex Sans Thai", "Leelawadee UI", Tahoma, sans-serif';
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, canvas.width / 2, canvas.height / 2 + 6);
      made = new THREE.CanvasTexture(canvas);
      made.colorSpace = THREE.SRGBColorSpace;
      made.anisotropy = 4;
      setTexture(made);
    };
    document.fonts.load('600 96px "IBM Plex Sans Thai"').then(draw, draw);
    return () => {
      alive = false;
      made?.dispose();
    };
  }, [text]);
  if (!texture) return null;
  return (
    <mesh position={[0, 1.55, 0.037]}>
      <planeGeometry args={[1.42, 0.74]} />
      <meshStandardMaterial map={texture} roughness={0.7} />
    </mesh>
  );
}

function Lounge() {
  return (
    <group>
      {/* sofa */}
      <group position={[6.6, 0, 2.2]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh castShadow receiveShadow position={[0, 0.3, 0]}>
          <boxGeometry args={[2.2, 0.4, 0.8]} />
          <meshStandardMaterial color="#4f6d7a" roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0, 0.65, -0.32]}>
          <boxGeometry args={[2.2, 0.6, 0.18]} />
          <meshStandardMaterial color="#4f6d7a" roughness={0.9} />
        </mesh>
      </group>
      {/* coffee table */}
      <mesh castShadow receiveShadow position={[5.2, 0.32, 3.2]}>
        <cylinderGeometry args={[0.45, 0.45, 0.06, 24]} />
        <meshStandardMaterial color="#f4f1ea" />
      </mesh>
      <mesh position={[5.2, 0.16, 3.2]}>
        <cylinderGeometry args={[0.05, 0.05, 0.32, 8]} />
        <meshStandardMaterial color="#5b6770" />
      </mesh>
      {/* plants */}
      {[
        [7.2, 4.6],
        [-7.2, -4.6],
        [7.2, -4.6],
      ].map(([x, z]) => (
        <group key={`${x},${z}`} position={[x, 0, z]}>
          <mesh castShadow position={[0, 0.25, 0]}>
            <cylinderGeometry args={[0.28, 0.22, 0.5, 16]} />
            <meshStandardMaterial color="#b9785c" />
          </mesh>
          <mesh castShadow position={[0, 0.85, 0]}>
            <icosahedronGeometry args={[0.5, 0]} />
            <meshStandardMaterial color="#3f8f5a" flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* --------------------------------------------------------------------- bots */

const ANTENNA: Record<State, string> = {
  idle: "#9aa7ad",
  working: "#ffffff",
  waiting: WAITING_COLOR,
  meeting: "#ffe08a",
};

function Bot({ agent, positions, reducedMotion }: { agent: AgentView; positions: Positions; reducedMotion: boolean }) {
  const { role, state } = agent;
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const bubble = useRef<THREE.Group>(null);

  const offset = { lead: 0, dev: 2, qa: 4 }[role];
  const walk = useRef({
    pos: [...targetFor(role, state, offset)] as Vec2,
    path: [] as Vec2[],
    yaw: 0,
    lounge: offset,
    nextWander: 0,
    placed: false,
  });

  // New state: walk (or jump, with reduced motion) to the zone for it.
  useEffect(() => {
    const w = walk.current;
    const target = targetFor(role, state, w.lounge);
    if (!w.placed || reducedMotion) {
      w.pos = [...target];
      w.path = [];
      w.placed = true;
    } else {
      w.path = pathBetween(w.pos, target);
    }
  }, [role, state, reducedMotion]);

  useFrame(({ clock }, delta) => {
    const w = walk.current;
    const t = clock.elapsedTime;
    const dt = Math.min(delta, 0.1);

    // Idle bots stroll between lounge spots now and then.
    if (state === "idle" && w.path.length === 0 && t > w.nextWander) {
      if (w.nextWander > 0) {
        const others = (Object.keys(positions) as Role[])
          .filter((r) => r !== role)
          .map((r): Vec2 => [positions[r].x, positions[r].z]);
        w.lounge = nextLoungeIndex(w.lounge, 1 + (offset % 3), others);
        const target = targetFor(role, "idle", w.lounge);
        w.path = reducedMotion ? [] : pathBetween(w.pos, target);
        if (reducedMotion) w.pos = [...target];
      }
      w.nextWander = t + 7 + ((offset * 1.7) % 4);
    }

    let moving = false;
    if (w.path.length > 0) {
      const [tx, tz] = w.path[0];
      const dx = tx - w.pos[0];
      const dz = tz - w.pos[1];
      const dist = Math.hypot(dx, dz);
      const step = WALK_SPEED * dt;
      if (dist <= step) {
        w.pos = [tx, tz];
        w.path.shift();
      } else {
        w.pos = [w.pos[0] + (dx / dist) * step, w.pos[1] + (dz / dist) * step];
        w.yaw = turnToward(w.yaw, Math.atan2(dx, dz), dt * 8);
        moving = true;
      }
    } else {
      w.yaw = turnToward(w.yaw, facingFor(role, state, w.pos), dt * 5);
    }

    const g = group.current;
    if (g) {
      g.position.set(w.pos[0], 0, w.pos[1]);
      g.rotation.y = w.yaw;
    }
    positions[role].set(w.pos[0], 0, w.pos[1]);

    const swing = moving && !reducedMotion ? Math.sin(t * 11) * 0.6 : 0;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (body.current) {
      let bob = 0;
      if (reducedMotion) bob = 0;
      else if (moving) bob = Math.abs(Math.sin(t * 11)) * 0.06;
      else if (state === "working") bob = Math.sin(t * 14) * 0.015; // typing
      else if (state === "meeting") bob = Math.sin(t * 3 + offset) * 0.03; // nodding along
      else if (state === "waiting") bob = Math.abs(Math.sin(t * 4)) * 0.08; // impatient hop
      else bob = Math.sin(t * 1.6 + offset) * 0.02; // breathing
      body.current.position.y = bob;
    }
    if (bubble.current) {
      const s = reducedMotion ? 1 : 1 + Math.sin(t * 5) * 0.12;
      bubble.current.scale.setScalar(s);
    }
  });

  const color = COLORS[role];
  return (
    <group ref={group}>
      <group ref={body}>
        {/* legs */}
        <mesh ref={legL} castShadow position={[-0.14, 0.22, 0]}>
          <capsuleGeometry args={[0.08, 0.22, 4, 8]} />
          <meshStandardMaterial color="#2c3a44" />
        </mesh>
        <mesh ref={legR} castShadow position={[0.14, 0.22, 0]}>
          <capsuleGeometry args={[0.08, 0.22, 4, 8]} />
          <meshStandardMaterial color="#2c3a44" />
        </mesh>
        {/* body */}
        <mesh castShadow position={[0, 0.72, 0]}>
          <capsuleGeometry args={[0.3, 0.38, 8, 16]} />
          <meshStandardMaterial color={color} roughness={0.55} />
        </mesh>
        {/* head with a face screen */}
        <mesh castShadow position={[0, 1.3, 0]}>
          <sphereGeometry args={[0.3, 24, 24]} />
          <meshStandardMaterial color="#f7f7f2" roughness={0.4} />
        </mesh>
        <mesh position={[0, 1.31, 0.22]}>
          <boxGeometry args={[0.36, 0.2, 0.12]} />
          <meshStandardMaterial color="#1d2a33" />
        </mesh>
        {[-0.08, 0.08].map((x) => (
          <mesh key={x} position={[x, 1.32, 0.285]}>
            <sphereGeometry args={[0.035, 10, 10]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} />
          </mesh>
        ))}
        {/* antenna shows the state */}
        <mesh position={[0, 1.66, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.16, 6]} />
          <meshStandardMaterial color="#5b6770" />
        </mesh>
        <mesh position={[0, 1.77, 0]}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshStandardMaterial color={ANTENNA[state]} emissive={ANTENNA[state]} emissiveIntensity={state === "idle" ? 0.1 : 1.6} />
        </mesh>
        {state === "waiting" && (
          <group ref={bubble} position={[0.5, 1.55, 0]}>
            <mesh>
              <sphereGeometry args={[0.15, 16, 16]} />
              <meshStandardMaterial color={WAITING_COLOR} emissive={WAITING_COLOR} emissiveIntensity={0.8} />
            </mesh>
            <Html center position={[0, 0, 0.18]} pointerEvents="none">
              <span className="bang" aria-hidden="true">!</span>
            </Html>
          </group>
        )}
      </group>
      <Html center position={[0, 2.25, 0]} pointerEvents="none" zIndexRange={[20, 0]}>
        <div className={`bot-label bot-label-${state}`} style={{ borderColor: color }}>
          <b>{ROLE_INFO[role].name}</b>
          <span>{STATE_LABEL[state]}</span>
        </div>
      </Html>
    </group>
  );
}

function turnToward(current: number, target: number, maxStep: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + Math.max(-maxStep, Math.min(maxStep, diff));
}

/* ------------------------------------------------------------------- camera */

const OVERVIEW_TARGET = new THREE.Vector3(0, 0.4, 0.6);
const OVERVIEW_OFFSET = new THREE.Vector3(11, 12, 15);
const FOLLOW_OFFSET = new THREE.Vector3(6.8, 7.6, 10.0);
const FOLLOW_CONTEXT = 0.35; // pull the look-at point 35% toward the room centre

function CameraRig({ focus, positions, reducedMotion }: { focus: Role | null; positions: Positions; reducedMotion: boolean }) {
  const { camera } = useThree();
  const target = useRef(OVERVIEW_TARGET.clone());
  const wantTarget = useMemo(() => new THREE.Vector3(), []);
  const wantPos = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    if (focus) {
      wantTarget.copy(positions[focus]).add(new THREE.Vector3(0, 1.0, 0)).lerp(OVERVIEW_TARGET, FOLLOW_CONTEXT);
      wantPos.copy(wantTarget).add(FOLLOW_OFFSET);
    } else {
      wantTarget.copy(OVERVIEW_TARGET);
      wantPos.copy(OVERVIEW_TARGET).add(OVERVIEW_OFFSET);
    }
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 1.8);
    target.current.lerp(wantTarget, k);
    camera.position.lerp(wantPos, k);
    camera.lookAt(target.current);
  });
  return null;
}
