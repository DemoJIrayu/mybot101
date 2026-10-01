"use client";
import { useEffect, useState } from "react";
import { addBall, setOffice, useOffice, botById } from "./store";
import { hush, sfx, speak, thaiVoice, unlockAudio } from "./sound";

const ago = (at: number) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 60 ? `${s} วิ` : `${Math.round(s / 60)} นาที`; };

// theme: system (follows Windows) -> light -> dark; layout.tsx applies the saved choice before the first paint
const THEMES = [["system", "🖥", "ธีม: ระบบ"], ["light", "☀️", "ธีม: สว่าง"], ["dark", "🌙", "ธีม: มืด"]] as const;
const applyTheme = (c: string) => {
  document.documentElement.dataset.theme = c === "dark" || (c === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
};
function ThemeButton() {
  const [choice, setChoice] = useState<string | null>(null); // null until the browser's saved choice is read (no SSR mismatch)
  useEffect(() => setChoice(localStorage.getItem("office.theme") || "system"), []);
  useEffect(() => {
    if (!choice) return;
    applyTheme(choice);
    const mq = matchMedia("(prefers-color-scheme: dark)"), on = () => applyTheme(choice);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [choice]);
  const i = Math.max(0, THEMES.findIndex(t => t[0] === choice)), [, em, label] = THEMES[i];
  const next = () => { const c = THEMES[(i + 1) % THEMES.length][0]; localStorage.setItem("office.theme", c); setChoice(c); };
  return <button className="theme-btn" onClick={next} title={`${label} — กดเพื่อสลับ (ระบบ = ตาม Windows)`} aria-label={label} data-theme-btn={choice ?? ""}>{em}</button>;
}

function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return <span>{t.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })} น.</span>;
}

function Panel() {
  const id = useOffice(s => s.selected), bot = useOffice(s => s.bots.find(b => b.id === id)), act = useOffice(s => (id ? s.live[id] : undefined));
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  if (!bot) return null;
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr("");
    const r = await fetch("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ botId: bot.id, text }) })
      .then(r => r.json()).catch(e => ({ error: String(e) }));
    setBusy(false);
    if (r.error) { setErr(r.error); sfx("fail"); } else { setText(""); sfx("pop"); speak(bot.id, "รับทราบครับ!"); }
  };
  return (
    <div className="panel card">
      <div className="panel-head">
        <span className="dot" style={{ background: bot.color }} />
        <div className="grow"><b>{bot.name}</b><div className="muted">{bot.title}</div></div>
        <button className="icon" onClick={() => setOffice({ selected: null })} aria-label="ปิด">✕</button>
      </div>
      <div className={`state ${bot.working ? "on" : ""}`}>{bot.working ? "🟢 กำลังทำงาน" : "😴 ว่างอยู่"}{act ? ` · ${act.emoji} ${act.label.slice(0, 60)}` : ""}</div>
      {bot.preview && <div className="preview">{bot.preview}</div>}
      <div className="send">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder={`สั่งงาน ${bot.name}…`} maxLength={4000} />
        <button onClick={send} disabled={busy || !text.trim()}>{busy ? "…" : "ส่ง"}</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

export default function Hud() {
  const s = useOffice();
  const working = s.bots.filter(b => b.working).length;
  const waiting = s.bots.filter(b => b.working && s.live[b.id]?.kind === "ask").length;
  const [voiceOk, setVoiceOk] = useState(true);
  useEffect(() => {
    const check = () => setVoiceOk(!!thaiVoice());
    check();
    speechSynthesis?.addEventListener?.("voiceschanged", check);
    return () => speechSynthesis?.removeEventListener?.("voiceschanged", check);
  }, []);
  const toggle = (k: "sound" | "voice" | "auto" | "throwMode") => { setOffice({ [k]: !s[k] }); if (k === "sound" && s.sound) hush(); sfx("pop"); };
  const rain = () => {
    const f = s.focus ? botById(s.focus) : null;
    for (let i = 0; i < 6; i++) setTimeout(() => addBall([(Math.random() - 0.5) * 6, 9 + i, (Math.random() - 0.5) * 6], [0, 0, 0]), i * 120);
    sfx("boing"); if (f) speak(f.id, "ฝนบอลตกแล้ว!");
  };
  const caption = s.caption && botById(s.caption.botId);

  if (!s.entered)
    return (
      <div className="gate" onClick={() => { unlockAudio(); setOffice({ entered: true }); sfx("start"); }}>
        <div className="gate-card">
          <div className="gate-emoji">🏢🤖</div>
          <h1>ออฟฟิศบอทของลุงจืด</h1>
          <p>บอท {s.bots.length || "…"} ตัวกำลังรออยู่ แตะเพื่อเข้าออฟฟิศ (เปิดเสียง 🔊)</p>
          <button>เข้าออฟฟิศ</button>
        </div>
      </div>
    );

  return (
    <>
      <div className="brand card">
        <div className="title">🏢 ออฟฟิศบอท</div>
        <ThemeButton />
        <div className="muted"><Clock /> · กรุงเทพฯ</div>
        <div className="stats">
          <span className="stat on">🟢 ทำงาน {working}</span>
          <span className="stat">😴 ว่าง {s.bots.length - working}</span>
          {waiting > 0 && <span className="stat warn">✋ รออนุมัติ {waiting}</span>}
        </div>
        {!s.connected && <div className="err">⚠️ ขาดการเชื่อมต่อกับเซิร์ฟเวอร์ กำลังต่อใหม่…</div>}
        {s.error && <div className="err">⚠️ {s.error}</div>}
      </div>

      <div className="tools">
        <button className={s.auto ? "on" : ""} onClick={() => toggle("auto")} title="กล้องซูม/แพนตามกิจกรรมของบอท">🎥 <span className="lbl">กล้องอัตโนมัติ</span></button>
        <button className={s.sound ? "on" : ""} onClick={() => toggle("sound")}>{s.sound ? "🔊" : "🔇"} <span className="lbl">เสียง</span></button>
        <button className={s.voice && voiceOk ? "on" : ""} onClick={() => toggle("voice")} disabled={!voiceOk}
          title={voiceOk ? "บอทพูดภาษาไทยด้วยเสียงในเครื่อง" : "ไม่พบเสียงภาษาไทยในเครื่อง"}>🗣️ <span className="lbl">บอทพูด</span></button>
        <button className={s.throwMode ? "on" : ""} onClick={() => toggle("throwMode")} title="คลิกพื้นเพื่อโยนบอล">🏀 <span className="lbl">โยนบอล</span></button>
        <button onClick={rain}>🎈 <span className="lbl">ฝนบอล</span></button>
        <button onClick={() => { setOffice({ manual: { kind: "overview" }, manualAt: Date.now(), selected: null }); sfx("whoosh"); }}>🗺️ <span className="lbl">ภาพรวม</span></button>
      </div>

      <div className="feed card">
        <div className="feed-title">⚡ กิจกรรมล่าสุด</div>
        {s.feed.length === 0 && <div className="muted">ยังเงียบอยู่… ลองสั่งงานบอทสักตัวสิ</div>}
        {s.feed.slice(0, 14).map((a, i) => {
          const b = s.bots.find(x => x.id === a.botId);
          return (
            <button key={a.at + a.botId + i} className={`feed-item ${a.kind}`} onClick={() => { setOffice({ selected: a.botId }); sfx("pop"); }}>
              <span className="em">{a.emoji}</span>
              <span className="grow"><b style={{ color: b?.color }}>{b?.name ?? "บอท"}</b> {a.label.slice(0, 80)}</span>
              <span className="muted">{ago(a.at)}</span>
            </button>
          );
        })}
      </div>

      <div className="zones">
        {s.sections.map(z => (
          <button key={z.id} onClick={() => { setOffice({ manual: { kind: "zone", id: z.id }, manualAt: Date.now(), selected: null }); sfx("whoosh"); }}>{z.name}</button>
        ))}
        <button onClick={() => setOffice({ manual: { kind: "zone", id: "meeting" }, manualAt: Date.now(), selected: null })}>🗣️ ห้องประชุม</button>
        <button onClick={() => setOffice({ manual: { kind: "zone", id: "lounge" }, manualAt: Date.now(), selected: null })}>☕ มุมพักผ่อน</button>
      </div>

      {caption && s.caption && <div className="caption"><b style={{ color: caption.color }}>{caption.name}:</b> {s.caption.text}</div>}
      {s.throwMode && <div className="hint">🏀 คลิกที่พื้นเพื่อโยนบอล — โดนบอทแล้วบอทจะร้อง!</div>}
      <Panel />
    </>
  );
}
