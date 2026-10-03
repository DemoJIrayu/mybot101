"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { bangkokClock, bangkokHour, lightingAt, PERIOD_LABEL } from "@/lib/sky";
import { ago, type OfficeStatus, pickFocus, ROLE_INFO, STATE_LABEL } from "@/lib/status";
import { COLORS } from "@/lib/layout";

import ThemeToggle from "./ThemeToggle";

// three.js needs the browser (WebGL), so the scene only renders on the client.
const OfficeScene = dynamic(() => import("./OfficeScene"), {
  ssr: false,
  loading: () => <div className="stage-message">กำลังจัดออฟฟิศ…</div>,
});

const POLL_MS = 2000;

export default function OfficeCard() {
  const [status, setStatus] = useState<OfficeStatus | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const [follow, setFollow] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isDemo = params.get("demo") === "1";
    // Optional ?hour=21.5 previews the lighting at another Bangkok time.
    const hourParam = params.get("hour");
    const offsetMs =
      hourParam !== null && Number.isFinite(Number(hourParam))
        ? ((Number(hourParam) - bangkokHour(new Date()) + 24) % 24) * 3600 * 1000
        : 0;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    /* eslint-disable react-hooks/set-state-in-effect */
    setDemo(isDemo);
    setReducedMotion(media.matches);
    setNow(new Date(Date.now() + offsetMs));
    /* eslint-enable react-hooks/set-state-in-effect */

    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/status${isDemo ? "?demo=1" : ""}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as OfficeStatus;
        if (!stopped) {
          setStatus(data);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    const pollTimer = setInterval(poll, POLL_MS);
    const clockTimer = setInterval(() => setNow(new Date(Date.now() + offsetMs)), 20_000);
    const onMotion = () => setReducedMotion(media.matches);
    media.addEventListener("change", onMotion);
    return () => {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
      media.removeEventListener("change", onMotion);
    };
  }, []);

  const lighting = now ? lightingAt(bangkokHour(now)) : null;
  const agents = status?.agents ?? [];
  const focus = pickFocus(agents);

  return (
    <section className="card" aria-labelledby="office-title">
      <header className="card-head">
        <div>
          <h1 id="office-title">ออฟฟิศบอท</h1>
          <p className="sub" aria-live="polite">
            {now && lighting ? `${bangkokClock(now)} น. ที่กรุงเทพฯ ตอน${PERIOD_LABEL[lighting.period]}` : " "}
            {demo && <span className="demo-tag">โหมดตัวอย่าง</span>}
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="stage" data-testid="stage">
        {lighting && <OfficeScene agents={agents} lighting={lighting} focus={follow ? focus : null} reducedMotion={reducedMotion} />}
        <button
          type="button"
          className="follow-toggle"
          aria-pressed={follow}
          onClick={() => setFollow((f) => !f)}
        >
          {follow ? "กล้องตามบอทที่ทำงาน" : "มุมกว้างทั้งออฟฟิศ"}
        </button>
      </div>

      <ul className="roster" aria-label="สถานะทีม">
        {agents.map((a) => (
          <li key={a.role} className="roster-row" data-state={a.state} data-role={a.role}>
            <span className="swatch" style={{ background: COLORS[a.role] }} aria-hidden="true" />
            <span className="who">
              <strong>{ROLE_INFO[a.role].name}</strong>
              <span className="muted">{ROLE_INFO[a.role].title}</span>
            </span>
            <span className={`chip chip-${a.state}`}>{STATE_LABEL[a.state]}</span>
            <span className="task">{a.task || (a.stale ? "ไม่ได้รายงานสถานะนานแล้ว" : "—")}</span>
            <span className="muted since">{status ? ago(status.now - a.since) : ""}</span>
          </li>
        ))}
      </ul>

      {error && <p className="note note-error">อ่านสถานะไม่ได้ ({error}) จะลองใหม่ทุก 2 วินาที</p>}
      {!error && status?.source === "missing" && !demo && (
        <p className="note">
          ยังไม่มีสถานะจากทีม เริ่มงานด้วย <code>python -m agent_team lead &quot;…&quot;</code> แล้วบอทจะขยับตามจริง
          หรือเปิด <a href="?demo=1">โหมดตัวอย่าง</a> เพื่อดูการทำงาน
        </p>
      )}
      {!error && status?.source === "invalid" && (
        <p className="note note-error">ไฟล์ runs/status.json อ่านไม่ได้ ระบบจะใช้ไฟล์ใหม่เมื่อ agent รายงานครั้งถัดไป</p>
      )}
    </section>
  );
}
