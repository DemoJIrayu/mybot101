"use client";
// Chibi robot. Position/heading come from the crowd (Rt); a kinematic Rapier capsule follows it so thrown balls
// bounce off bots and bots shove balls out of the way.
import { Html, Outlines, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { memo, useRef } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import type { Activity, BotView } from "@/lib/hub";
import type { Rt } from "./crowd";
import { hash, setOffice, useOffice } from "./store";
import { sfx, speak, phrase } from "./sound";

const INK = "#2a2340";
const TTL: Record<Activity["kind"], number> = { start: 5000, tool: 7000, say: 10000, ask: 600000, done: 7000, fail: 12000 };

function bubbleOf(bot: BotView, rt: Rt | undefined, act: Activity | undefined, hit: { at: number; text: string } | undefined, now: number) {
  if (hit && now - hit.at < 2500) return { emoji: "😵", text: hit.text, tone: "hit" };
  if (act && now - act.at < TTL[act.kind] && (act.kind !== "ask" || bot.working))
    return { emoji: act.emoji, text: act.kind === "say" ? act.label.slice(0, 70) + (act.label.length > 70 ? "…" : "") : act.label, tone: act.kind };
  if (rt && rt.goal.kind === "poi" && rt.arrived) return { emoji: rt.goal.emoji!, text: rt.goal.label!, tone: "poi" };
  if (rt && rt.goal.kind === "meet" && rt.arrived) return { emoji: "🗣️", text: "ประชุมอยู่", tone: "poi" };
  if (bot.working) return { emoji: "⌨️", text: "กำลังทำงาน…", tone: "tool" };
  return null;
}

type Props = { bot: BotView; rt: Rt | undefined; act?: Activity; hit?: { at: number; text: string }; now: number; focused: boolean; selected: boolean; hovered: boolean };

export const Bot = memo(function Bot({ bot, rt, act, hit, now, focused, selected, hovered }: Props) {
  const body = useRef<RapierRigidBody>(null);
  const root = useRef<Group>(null), torso = useRef<Group>(null), head = useRef<Group>(null);
  const armL = useRef<Group>(null), armR = useRef<Group>(null), footL = useRef<Mesh>(null), footR = useRef<Mesh>(null);
  const eyes = useRef<Group>(null), eyeMat = useRef<MeshStandardMaterial>(null), bulb = useRef<MeshStandardMaterial>(null);
  const phase = useRef(hash(bot.id) % 100), seed = (hash(bot.id) % 1000) / 1000;

  useFrame(({ clock }, dt) => {
    if (!rt || !root.current) return;
    const t = clock.elapsedTime + seed * 10, wall = Date.now();
    body.current?.setNextKinematicTranslation({ x: rt.x, y: 0, z: rt.z });
    root.current.position.set(rt.x, 0, rt.z);
    root.current.rotation.y = rt.yaw;

    const walking = rt.speed > 0.15, working = bot.working && rt.arrived && rt.goal.kind === "desk";
    const a = act && wall - act.at < TTL[act.kind] ? act.kind : null;
    const hitAge = hit ? (wall - hit.at) / 1000 : 9;
    const sleepy = !bot.working && rt.arrived && rt.goal.kind === "desk" && wall - (act?.at ?? 0) > 5 * 60000;
    phase.current += dt * rt.speed * 7;
    const ph = phase.current;

    // body: walk bob / work bounce / breathing / celebration jump
    const jump = a === "done" ? Math.abs(Math.sin(t * 7)) * 0.22 : 0;
    const bob = walking ? Math.abs(Math.sin(ph)) * 0.05 : working ? Math.sin(t * 11) * 0.012 : Math.sin(t * 2) * 0.01;
    torso.current!.position.y = bob + jump;
    torso.current!.rotation.x = walking ? 0.08 : 0;
    footL.current!.position.set(-0.13, 0.08 + (walking ? Math.max(0, Math.sin(ph)) * 0.07 : 0), 0.02 + (walking ? Math.sin(ph) * 0.12 : 0));
    footR.current!.position.set(0.13, 0.08 + (walking ? Math.max(0, -Math.sin(ph)) * 0.07 : 0), 0.02 - (walking ? Math.sin(ph) * 0.12 : 0));

    // arms: typing / swinging / waving for approval / idle sway
    const L = armL.current!, R = armR.current!;
    if (a === "ask") { R.rotation.set(-2.7 + Math.sin(t * 8) * 0.25, 0, -0.2); L.rotation.set(0.1, 0, 0); }
    else if (working) { L.rotation.set(-1.15 + Math.sin(t * 18) * 0.22, 0, 0.1); R.rotation.set(-1.15 + Math.sin(t * 18 + 1.7) * 0.22, 0, -0.1); }
    else if (walking) { L.rotation.set(Math.sin(ph) * 0.7, 0, 0.12); R.rotation.set(-Math.sin(ph) * 0.7, 0, -0.12); }
    else { L.rotation.set(Math.sin(t * 1.3) * 0.08, 0, 0.12); R.rotation.set(-Math.sin(t * 1.3) * 0.08, 0, -0.12); }

    // head: wobble when hit, droop when sleepy/failed, curious tilt otherwise
    const H = head.current!;
    H.rotation.z = hitAge < 1.2 ? Math.sin(t * 30) * 0.35 * (1.2 - hitAge) : Math.sin(t * 0.7) * 0.05;
    H.rotation.x = sleepy || a === "fail" ? 0.18 : working ? 0.1 + Math.sin(t * 5) * 0.02 : 0;

    // eyes: blink, squint when sleepy/hit, glow cyan while working
    const blink = (t % 4.2) < 0.12;
    eyes.current!.scale.y = sleepy || hitAge < 1.2 ? 0.15 : blink ? 0.1 : 1;
    eyeMat.current!.emissiveIntensity = working ? 1.6 : 0.4;
    eyeMat.current!.color.set(working ? "#7ff3ff" : "#ffffff");
    bulb.current!.emissiveIntensity = bot.working ? 1.5 + Math.sin(t * 6) * 1.2 : a ? 1 : 0.15;
  });

  const bubble = bubbleOf(bot, rt, act, hit, now);
  const showName = hovered || selected || focused;
  const select = () => {
    setOffice({ selected: bot.id, manual: null });
    sfx("pop");
    speak(bot.id, phrase("hello"));
  };

  return (
    <>
      <RigidBody ref={body} type="kinematicPosition" colliders={false} userData={{ botId: bot.id }} position={[rt?.x ?? 0, 0, rt?.z ?? 0]}>
        <CapsuleCollider args={[0.4, 0.33]} position={[0, 0.73, 0]} />
      </RigidBody>
      <group ref={root}
        onClick={e => { e.stopPropagation(); select(); }}
        onPointerOver={e => { e.stopPropagation(); setOffice({ hovered: bot.id }); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setOffice(s => (s.hovered === bot.id ? { hovered: null } : {})); document.body.style.cursor = ""; }}>
        <mesh ref={footL} castShadow><sphereGeometry args={[0.09, 14, 10]} /><meshStandardMaterial color={INK} /></mesh>
        <mesh ref={footR} castShadow><sphereGeometry args={[0.09, 14, 10]} /><meshStandardMaterial color={INK} /></mesh>
        <group ref={torso}>
          <RoundedBox args={[0.56, 0.5, 0.42]} radius={0.16} smoothness={4} position={[0, 0.42, 0]} castShadow>
            <meshStandardMaterial color={bot.color} roughness={0.55} />
            <Outlines thickness={0.022} color={INK} />
          </RoundedBox>
          <mesh position={[0, 0.44, 0.215]}><circleGeometry args={[0.09, 24]} /><meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={0.3} /></mesh>
          {([[armL, -1], [armR, 1]] as const).map(([ref, s]) => (
            <group key={s} ref={ref} position={[s * 0.33, 0.58, 0]}>
              <mesh position={[0, -0.14, 0]} castShadow><capsuleGeometry args={[0.065, 0.18, 6, 12]} /><meshStandardMaterial color={bot.color} roughness={0.55} /></mesh>
              <mesh position={[0, -0.29, 0]}><sphereGeometry args={[0.075, 12, 10]} /><meshStandardMaterial color="#fff8ee" /></mesh>
            </group>
          ))}
          <group ref={head} position={[0, 0.72, 0]}>
            <RoundedBox args={[0.78, 0.62, 0.64]} radius={0.24} smoothness={4} position={[0, 0.3, 0]} castShadow>
              <meshStandardMaterial color="#fff8ee" roughness={0.5} />
              <Outlines thickness={0.022} color={INK} />
            </RoundedBox>
            <RoundedBox args={[0.62, 0.38, 0.04]} radius={0.12} smoothness={3} position={[0, 0.3, 0.315]}>
              <meshStandardMaterial color="#262a40" roughness={0.3} />
            </RoundedBox>
            <group ref={eyes} position={[0, 0.33, 0.34]}>
              {[-0.13, 0.13].map(x => (
                <mesh key={x} position={[x, 0, 0]}><capsuleGeometry args={[0.045, 0.07, 4, 10]} /><meshStandardMaterial ref={x < 0 ? eyeMat : undefined} color="#fff" emissive="#7ff3ff" emissiveIntensity={0.4} /></mesh>
              ))}
            </group>
            <mesh position={[0, 0.22, 0.34]} rotation-z={Math.PI}><torusGeometry args={[0.05, 0.013, 8, 16, Math.PI]} /><meshStandardMaterial color="#fff" /></mesh>
            {[-0.23, 0.23].map(x => <mesh key={x} position={[x, 0.24, 0.335]}><circleGeometry args={[0.04, 16]} /><meshStandardMaterial color="#ff8fb1" emissive="#ff8fb1" emissiveIntensity={0.5} /></mesh>)}
            {[-1, 1].map(s => <mesh key={s} position={[s * 0.41, 0.3, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.09, 0.09, 0.06, 16]} /><meshStandardMaterial color={bot.color} /></mesh>)}
            <mesh position={[0, 0.7, 0]}><cylinderGeometry args={[0.015, 0.015, 0.18, 8]} /><meshStandardMaterial color={INK} /></mesh>
            <mesh position={[0, 0.81, 0]}><sphereGeometry args={[0.06, 14, 10]} /><meshStandardMaterial ref={bulb} color={bot.color} emissive={bot.color} emissiveIntensity={0.15} /></mesh>
          </group>
        </group>
        {(bubble || showName) && (
          <Html position={[0, 1.85, 0]} center zIndexRange={[focused || selected ? 60 : 30, 0]} style={{ pointerEvents: "none" }}>
            <div className={`tag ${focused || selected ? "big" : ""}`}>
              {bubble && <div className={`bubble ${bubble.tone}`}><span className="em">{bubble.emoji}</span>{bubble.text}</div>}
              {showName && <div className="name" style={{ background: bot.color }}>{bot.name}</div>}
            </div>
          </Html>
        )}
      </group>
    </>
  );
});
