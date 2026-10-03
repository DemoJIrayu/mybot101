"use client";

import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const ORDER: ThemePref[] = ["system", "light", "dark"];
const LABEL: Record<ThemePref, string> = { system: "ตามระบบ", light: "สว่าง", dark: "มืด" };
const KEY = "office-theme";

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePref = pref;
}

function readPref(): ThemePref {
  const p = typeof document === "undefined" ? "system" : document.documentElement.dataset.themePref;
  return p === "light" || p === "dark" ? p : "system";
}

export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>("system");

  // Read what the inline script in layout.tsx chose before React loaded.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPref(readPref()), []);

  // While following the system, react live to Windows switching light/dark.
  useEffect(() => {
    if (pref !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);

  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
  const choose = () => {
    setPref(next);
    apply(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private window or blocked storage: the choice just isn't remembered */
    }
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={choose}
      aria-label={`ธีม: ${LABEL[pref]} (กดเพื่อเปลี่ยนเป็น${LABEL[next]})`}
      title={`ธีม: ${LABEL[pref]}`}
      data-pref={pref}
    >
      {pref === "system" && (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      )}
      {pref === "light" && (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
      {pref === "dark" && (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}
