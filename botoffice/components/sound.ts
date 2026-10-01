// Procedural sound effects (ZzFX: synthesized, no audio files) and Thai speech via the browser's speechSynthesis,
// restricted to voices installed on this machine (e.g. Windows "Microsoft Pattara") so nothing leaves the PC.
import { ZZFX } from "zzfx";
import { hash, setOffice, useOffice } from "./store";

// ZzFX params: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, ...
const FX = {
  pop: [0.5, 0.05, 520, 0.01, 0.02, 0.08, 1, 1.6, , , 180, 0.03],
  start: [0.55, , 330, 0.02, 0.08, 0.18, 1, 1.4, , , 220, 0.06],
  tool: [0.22, 0.1, 900, , 0.01, 0.04, 1, 2],
  type: [0.1, 0.6, 1800, , 0.003, 0.012, 4],
  say: [0.35, , 640, 0.01, 0.05, 0.1, 1, 1.5, , , -120, 0.05],
  ask: [0.6, , 880, 0.01, 0.12, 0.22, 1, 0.8, , , 440, 0.08, 0.1],
  done: [0.7, , 523, 0.02, 0.22, 0.4, 1, 1.2, , , 262, 0.09, 0.1],
  fail: [0.5, , 220, 0.02, 0.15, 0.3, 2, 1, -3],
  boing: [0.6, , 150, 0.01, 0.08, 0.25, , 1.4, 12],
  thud: [0.35, 0.2, 90, , 0.02, 0.08, 4, 1.5],
  whoosh: [0.12, 0.2, 200, 0.1, 0.1, 0.25, 4, 1],
} satisfies Record<string, (number | undefined)[]>;
export type Fx = keyof typeof FX;

export function sfx(name: Fx, pan = 0, gain = 1) {
  if (!useOffice.getState().sound) return;
  try {
    const p = [...FX[name]];
    p[0] = (p[0] ?? 1) * gain;
    ZZFX.playSamples([ZZFX.buildSamples(...p)], 1, 1, Math.max(-1, Math.min(1, pan)));
  } catch { /* audio not unlocked yet */ }
}

export function unlockAudio() {
  void ZZFX.audioContext.resume();
  thaiVoice(); // voices load lazily in Chromium
}

let voice: SpeechSynthesisVoice | null = null;
export function thaiVoice() {
  if (!voice && typeof speechSynthesis !== "undefined")
    voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith("th") && v.localService) ?? null;
  return voice;
}

const PHRASES = {
  start: ["ได้เลยครับ ลุยงานเลย!", "รับทราบครับ เริ่มเลย!", "จัดให้ครับ!"],
  done: ["เสร็จแล้วครับลุงจืด!", "เรียบร้อยครับ!", "งานเสร็จแล้ว เย่!"],
  ask: ["ลุงจืดครับ ขออนุมัติหน่อยครับ", "รอคำตอบจากลุงจืดอยู่นะครับ"],
  fail: ["อุ๊ย งานพลาดครับ", "แย่แล้ว มีปัญหาครับ"],
  hit: ["โอ๊ย!", "อุ๊ย เจ็บนะ!", "ใครโยนเนี่ย!", "เฮ้ย ระวังหน่อย!"],
  hello: ["สวัสดีครับลุงจืด", "มีอะไรให้ช่วยไหมครับ", "ว่าไงครับ!"],
};
export const phrase = (k: keyof typeof PHRASES) => PHRASES[k][Math.floor(Math.random() * PHRASES[k].length)];

// speakable Thai: drop markdown, links and emoji; first sentence-ish chunk only
function clean(text: string) {
  return text.replace(/https?:\/\/\S+/g, "ลิงก์").replace(/[`*_#>|~\[\]()]/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim().slice(0, 140);
}

let pending = 0;
export function speak(botId: string, text: string) {
  const s = useOffice.getState(), v = thaiVoice();
  if (!s.sound || !s.voice || !v || pending >= 2) return;
  const line = clean(text);
  if (!line) return;
  const u = new SpeechSynthesisUtterance(line);
  u.voice = v; u.lang = v.lang; u.rate = 1.08; u.volume = 0.9;
  u.pitch = 0.85 + (hash(botId) % 90) / 100; // each bot gets its own pitch from one installed voice
  pending++;
  u.onstart = () => setOffice({ caption: { botId, text: line } });
  u.onend = u.onerror = () => { pending--; setOffice(st => (st.caption?.text === line ? { caption: null } : {})); };
  speechSynthesis.speak(u);
}
export function hush() { pending = 0; speechSynthesis?.cancel(); setOffice({ caption: null }); }
