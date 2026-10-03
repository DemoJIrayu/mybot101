// Sky colour, sun and lights from the real time in Bangkok.

export const BANGKOK_TZ = "Asia/Bangkok";

/** Hour of day in Bangkok as a decimal, e.g. 13.5 for 13:30. */
export function bangkokHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") + get("minute") / 60 + get("second") / 3600;
}

export function bangkokClock(date: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

// Bangkok is close to the equator: sunrise ~06:10 and sunset ~18:20 all year.
export const SUNRISE = 6.2;
export const SUNSET = 18.35;

type RGB = [number, number, number];

// Sky colour keyframes (hour -> colour), looped over 24h.
const SKY_KEYS: [number, string][] = [
  [0, "#0b1733"],
  [5.3, "#16234a"],
  [6.0, "#e9906a"],
  [6.8, "#f6c58f"],
  [8.0, "#9fd0ef"],
  [12.0, "#79bff0"],
  [16.5, "#93c7ea"],
  [17.8, "#f2a36b"],
  [18.5, "#c4607a"],
  [19.2, "#3a3466"],
  [20.2, "#121d3d"],
  [24, "#0b1733"],
];

const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = ([r, g, b]: RGB) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;

export function skyColor(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const [h0, c0] = SKY_KEYS[i];
    const [h1, c1] = SKY_KEYS[i + 1];
    if (h >= h0 && h <= h1) {
      const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0);
      return rgbToHex(mix(hexToRgb(c0), hexToRgb(c1), t));
    }
  }
  return SKY_KEYS[0][1];
}

/** Sun elevation from -1 (midnight) to 1 (noon); > 0 between sunrise and sunset. */
export function sunElevation(hour: number): number {
  const day = SUNSET - SUNRISE;
  const h = ((hour % 24) + 24) % 24;
  if (h >= SUNRISE && h <= SUNSET) return Math.sin((Math.PI * (h - SUNRISE)) / day);
  const night = 24 - day;
  const sinceSunset = (h - SUNSET + 24) % 24;
  return -Math.sin((Math.PI * sinceSunset) / night);
}

export interface Lighting {
  sky: string;
  sunIntensity: number;
  sunColor: string;
  sunPosition: [number, number, number];
  ambient: number;
  lampsOn: boolean;
  stars: boolean;
  period: "night" | "dawn" | "day" | "dusk";
}

export function lightingAt(hour: number): Lighting {
  const elev = sunElevation(hour);
  const up = Math.max(0, elev);
  const h = ((hour % 24) + 24) % 24;
  // Sun travels east (+x) to west (-x) across the south side of the office.
  const dayProgress = Math.min(1, Math.max(0, (h - SUNRISE) / (SUNSET - SUNRISE)));
  const angle = Math.PI * dayProgress;
  const sunPosition: [number, number, number] = [
    Math.cos(angle) * 14,
    Math.max(1.5, up * 16),
    6 + (1 - up) * 4,
  ];
  const low = up < 0.35;
  let period: Lighting["period"] = "day";
  if (elev <= 0) period = "night";
  else if (low) period = h < 12 ? "dawn" : "dusk";

  return {
    sky: skyColor(h),
    sunIntensity: elev > 0 ? 0.35 + 1.6 * up : 0,
    sunColor: low ? "#ffb27a" : "#fff4e0",
    sunPosition,
    ambient: 0.3 + 0.75 * up,
    lampsOn: up < 0.25,
    stars: elev < -0.08,
    period,
  };
}

export const PERIOD_LABEL: Record<Lighting["period"], string> = {
  night: "กลางคืน",
  dawn: "เช้าตรู่",
  day: "กลางวัน",
  dusk: "พลบค่ำ",
};
