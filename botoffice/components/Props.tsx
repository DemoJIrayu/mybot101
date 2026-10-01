"use client";
// Furniture drawn inside each layout box's footprint (x/z centre, w/d/h size). Colliders use the same box.
import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useRef } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import type { Box } from "./world";
import { useOffice } from "./store";

type P = { b: Box };
const R = ({ args, pos, color, r = 0.05, e, ei = 0, shadow = true }: {
  args: [number, number, number]; pos: [number, number, number]; color: string; r?: number; e?: string; ei?: number; shadow?: boolean;
}) => (
  <RoundedBox args={args} radius={Math.min(r, ...args.map(a => a / 2 - 0.001))} smoothness={3} position={pos} castShadow={shadow} receiveShadow>
    <meshStandardMaterial color={color} roughness={0.75} emissive={e ?? "#000"} emissiveIntensity={ei} />
  </RoundedBox>
);
const Cyl = ({ r, h, pos, color, rt = r, seg = 20 }: { r: number; h: number; pos: [number, number, number]; color: string; rt?: number; seg?: number }) => (
  <mesh position={pos} castShadow receiveShadow>
    <cylinderGeometry args={[rt, r, h, seg]} />
    <meshStandardMaterial color={color} roughness={0.7} />
  </mesh>
);

function Steam({ pos }: { pos: [number, number, number] }) {
  const g = useRef<Group>(null);
  useFrame(({ clock }) => g.current?.children.forEach((c, i) => {
    const t = (clock.elapsedTime * 0.6 + i / 3) % 1;
    c.position.set(Math.sin(t * 6 + i) * 0.05, t * 0.6, 0);
    c.scale.setScalar(0.05 + t * 0.09);
    ((c as Mesh).material as MeshStandardMaterial).opacity = 0.6 * (1 - t);
  }));
  return (
    <group ref={g} position={pos}>
      {[0, 1, 2].map(i => <mesh key={i}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color="#fff" transparent depthWrite={false} /></mesh>)}
    </group>
  );
}

function Desk({ b }: P) {
  const working = useOffice(s => !!b.owner && !!s.bots.find(x => x.id === b.owner)?.working);
  const top = b.h;
  return (
    <group position={[b.x, 0, b.z]}>
      <R args={[b.w, 0.07, b.d]} pos={[0, top - 0.035, 0]} color="#f3d7b0" r={0.03} />
      {[-1, 1].map(sx => <R key={sx} args={[0.08, top - 0.07, b.d - 0.1]} pos={[sx * (b.w / 2 - 0.08), (top - 0.07) / 2, 0]} color="#d9b98f" r={0.02} shadow={false} />)}
      {/* laptop: screen faces the bot (-z); the lid logo faces the camera and glows while its bot works */}
      <R args={[0.52, 0.03, 0.36]} pos={[0, top + 0.015, -0.05]} color="#c9ccd6" r={0.01} shadow={false} />
      <group position={[0, top + 0.03, 0.13]} rotation-x={0.25}>
        <R args={[0.52, 0.36, 0.025]} pos={[0, 0.18, 0]} color="#c9ccd6" r={0.01} shadow={false} />
        <mesh position={[0, 0.18, -0.014]} rotation-y={Math.PI}>
          <planeGeometry args={[0.46, 0.3]} />
          <meshStandardMaterial color={working ? "#9fe8ff" : "#2b2f45"} emissive={working ? "#6fd8ff" : "#000"} emissiveIntensity={working ? 1.2 : 0} />
        </mesh>
        <mesh position={[0, 0.18, 0.014]}>
          <circleGeometry args={[0.05, 20]} />
          <meshStandardMaterial color={b.accent} emissive={b.accent} emissiveIntensity={working ? 2 : 0.2} />
        </mesh>
      </group>
      <Cyl r={0.05} h={0.1} pos={[0.45, top + 0.05, 0.1]} color="#ff9fb2" />
    </group>
  );
}

function Counter({ b, kitchen }: P & { kitchen?: boolean }) {
  return (
    <group position={[b.x, 0, b.z]}>
      <R args={[b.w, b.h - 0.06, b.d]} pos={[0, (b.h - 0.06) / 2, 0]} color={kitchen ? "#dfe7ea" : "#ffd6a5"} />
      <R args={[b.w + 0.04, 0.06, b.d + 0.04]} pos={[0, b.h - 0.03, 0]} color={kitchen ? "#8fa3ad" : "#b98b64"} r={0.02} />
      {kitchen
        ? <><R args={[0.4, 0.03, 0.28]} pos={[-0.2, b.h + 0.015, 0]} color="#e0a870" r={0.01} shadow={false} /><Cyl r={0.07} h={0.07} pos={[-0.2, b.h + 0.07, 0]} color="#ff7b5c" /><Cyl r={0.05} h={0.05} pos={[0.35, b.h + 0.03, 0.1]} color="#8bd17c" /></>
        : <Cyl r={0.07} h={0.08} pos={[0.3, b.h + 0.04, 0]} color="#f7c948" rt={0.02} />}
    </group>
  );
}

function Wall({ b }: P) {
  const windows = Math.max(1, Math.floor(b.w / 4));
  return (
    <group position={[b.x, 0, b.z]}>
      <R args={[b.w, b.h, b.d]} pos={[0, b.h / 2, 0]} color="#fff4e6" r={0.06} />
      <R args={[b.w, 0.12, b.d + 0.04]} pos={[0, 0.06, 0]} color="#e8c9a3" r={0.03} shadow={false} />
      {Array.from({ length: windows }, (_, i) => (
        <mesh key={i} position={[-b.w / 2 + (b.w / windows) * (i + 0.5), b.h * 0.62, b.d / 2 + 0.005]}>
          <planeGeometry args={[1.3, 0.6]} />
          <meshStandardMaterial color="#bfe6ff" emissive="#9fd4ff" emissiveIntensity={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function Blinky({ pos, color, speed }: { pos: [number, number, number]; color: string; speed: number }) {
  const m = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => { if (m.current) m.current.emissiveIntensity = Math.sin(clock.elapsedTime * speed) > 0 ? 2.5 : 0.2; });
  return <mesh position={pos}><sphereGeometry args={[0.025, 8, 6]} /><meshStandardMaterial ref={m} color={color} emissive={color} /></mesh>;
}

function Prop({ b }: P) {
  const at: [number, number, number] = [b.x, 0, b.z];
  switch (b.kind) {
    case "desk": return <Desk b={b} />;
    case "counter": return <Counter b={b} kitchen />;
    case "register": return <Counter b={b} />;
    case "wall": return <Wall b={b} />;
    case "stove":
      return (
        <group position={at}>
          <R args={[b.w, b.h, b.d]} pos={[0, b.h / 2, 0]} color="#e9eef2" />
          <R args={[b.w - 0.1, 0.02, b.d - 0.1]} pos={[0, b.h + 0.01, 0]} color="#2f3440" r={0.01} shadow={false} />
          <Cyl r={0.2} h={0.26} pos={[-0.3, b.h + 0.14, 0]} color="#ff8a65" rt={0.22} />
          <Cyl r={0.16} h={0.12} pos={[0.32, b.h + 0.07, 0]} color="#7a8491" />
          <Steam pos={[-0.3, b.h + 0.3, 0]} />
        </group>
      );
    case "fridge":
      return <group position={at}><R args={[b.w, b.h, b.d]} pos={[0, b.h / 2, 0]} color="#bff0e0" r={0.1} /><R args={[0.05, 0.5, 0.05]} pos={[b.w / 2 - 0.15, b.h * 0.65, b.d / 2 + 0.03]} color="#8aa" r={0.02} /></group>;
    case "sofa":
      return (
        <group position={at}>
          <R args={[b.w, 0.4, b.d]} pos={[0, 0.2, 0]} color="#ff9fb8" r={0.12} />
          <R args={[b.w, 0.55, 0.25]} pos={[0, 0.55, -b.d / 2 + 0.12]} color="#ff8aa8" r={0.12} />
          {[-1, 1].map(s => <R key={s} args={[0.22, 0.55, b.d]} pos={[s * (b.w / 2 - 0.11), 0.35, 0]} color="#ff8aa8" r={0.1} />)}
        </group>
      );
    case "bookshelf": case "shelf": {
      const colors = ["#ff6b6b", "#ffd93d", "#6bcB77", "#4d96ff", "#c77dff"];
      const levels = Math.max(2, Math.round(b.h / 0.45));
      return (
        <group position={at}>
          <R args={[b.w, b.h, b.d]} pos={[0, b.h / 2, 0]} color="#c8a27a" r={0.03} />
          {Array.from({ length: levels - 1 }, (_, l) => Array.from({ length: 5 }, (_, i) => (
            <R key={`${l}-${i}`} args={[0.14, 0.3, b.d - 0.1]} pos={[-b.w / 2 + 0.2 + i * (b.w - 0.3) / 5, 0.3 + l * (b.h / levels), 0.03]}
              color={colors[(i + l * 2) % 5]} r={0.02} shadow={false} />
          )))}
        </group>
      );
    }
    case "tv":
      return (
        <group position={at}>
          <R args={[b.w, 0.5, b.d]} pos={[0, 0.25, 0]} color="#b08968" />
          <R args={[b.w - 0.1, 0.65, 0.06]} pos={[0, 0.85, 0]} color="#22263a" r={0.03} e="#5b8cff" ei={0.3} />
        </group>
      );
    case "plant":
      return (
        <group position={at}>
          <Cyl r={0.2} h={0.4} pos={[0, 0.2, 0]} color="#e07a5f" rt={0.25} />
          {[[0, 0.75, 0, 0.32], [0.14, 0.95, 0.05, 0.22], [-0.12, 1.0, -0.04, 0.2]].map(([x, y, z, r], i) => (
            <mesh key={i} position={[x, y, z]} castShadow><icosahedronGeometry args={[r, 1]} /><meshStandardMaterial color="#6cc47c" flatShading /></mesh>
          ))}
        </group>
      );
    case "table":
      return (
        <group position={at}>
          <Cyl r={b.w / 2} h={0.08} pos={[0, b.h - 0.04, 0]} color="#f2cc8f" seg={40} />
          <Cyl r={0.12} h={b.h - 0.08} pos={[0, (b.h - 0.08) / 2, 0]} color="#c9a26b" />
          <Cyl r={0.12} h={0.12} pos={[0, b.h + 0.06, 0]} color="#ff9fb2" />
        </group>
      );
    case "board": case "menu":
      return (
        <group position={at}>
          <R args={[b.w, b.h - 0.5, 0.08]} pos={[0, b.h / 2 + 0.25, 0]} color={b.kind === "menu" ? "#3d4a3d" : "#ffffff"} r={0.03} />
          {[0.3, 0.55, 0.42, 0.75].map((v, i) => (
            <R key={i} args={[0.18, v * 0.6, 0.02]} pos={[-b.w / 2 + 0.4 + i * 0.35, 0.55 + v * 0.3, 0.05]}
              color={["#ff6b6b", "#ffd93d", "#6bcB77", "#4d96ff"][i]} r={0.01} shadow={false} />
          ))}
          {[-1, 1].map(s => <R key={s} args={[0.06, 0.5, 0.06]} pos={[s * (b.w / 2 - 0.1), 0.25, 0]} color="#9aa" r={0.02} shadow={false} />)}
        </group>
      );
    case "coffee":
      return (
        <group position={at}>
          <R args={[b.w, b.h - 0.1, b.d]} pos={[0, (b.h - 0.1) / 2, 0]} color="#b08968" />
          <R args={[0.5, 0.55, 0.45]} pos={[-0.3, b.h + 0.18, 0]} color="#3a3f51" r={0.08} />
          <Cyl r={0.06} h={0.1} pos={[-0.3, b.h, 0.15]} color="#fff" />
          <Steam pos={[-0.3, b.h + 0.1, 0.15]} />
          <Cyl r={0.07} h={0.15} pos={[0.35, b.h + 0.02, 0]} color="#ffd6a5" />
        </group>
      );
    case "cooler":
      return (
        <group position={at}>
          <R args={[b.w, b.h - 0.4, b.d]} pos={[0, (b.h - 0.4) / 2, 0]} color="#f4f7fb" />
          <Cyl r={0.2} h={0.4} pos={[0, b.h - 0.2, 0]} color="#8fd3ff" rt={0.16} />
        </group>
      );
    case "rack":
      return (
        <group position={at}>
          <R args={[b.w, b.h, b.d]} pos={[0, b.h / 2, 0]} color="#3a3f51" />
          {Array.from({ length: 6 }, (_, i) => <Blinky key={i} pos={[-0.25 + (i % 3) * 0.12, 0.4 + Math.floor(i / 3) * 0.6 + (i % 2) * 0.2, b.d / 2 + 0.01]} color={i % 2 ? "#5dff9b" : "#5bc8ff"} speed={2 + i} />)}
        </group>
      );
    case "arcade":
      return (
        <group position={at}>
          <R args={[b.w, b.h, b.d]} pos={[0, b.h / 2, 0]} color="#8f5bff" r={0.08} />
          <R args={[b.w - 0.2, 0.5, 0.05]} pos={[0, b.h - 0.55, b.d / 2]} color="#141626" r={0.02} e="#ff5fd2" ei={0.9} />
          <Cyl r={0.04} h={0.15} pos={[-0.15, 0.95, b.d / 2 - 0.05]} color="#ff4d4d" />
        </group>
      );
  }
  return null;
}

export const Props = memo(function Props({ boxes }: { boxes: Box[] }) {
  return <>{boxes.map((b, i) => <Prop key={i} b={b} />)}</>;
});
