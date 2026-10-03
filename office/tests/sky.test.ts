import { describe, expect, it } from "vitest";

import { bangkokHour, lightingAt, skyColor, sunElevation } from "@/lib/sky";

describe("bangkokHour", () => {
  it("converts UTC to Bangkok time (UTC+7, no daylight saving)", () => {
    expect(bangkokHour(new Date("2026-10-03T09:30:00Z"))).toBeCloseTo(16.5);
    expect(bangkokHour(new Date("2026-01-15T20:00:00Z"))).toBeCloseTo(3);
  });
});

describe("sun and sky", () => {
  it("has the sun up by day and down at night", () => {
    expect(sunElevation(12.3)).toBeGreaterThan(0.95);
    expect(sunElevation(2)).toBeLessThan(0);
    expect(sunElevation(23)).toBeLessThan(0);
  });

  it("returns valid colours for every minute of the day", () => {
    for (let m = 0; m < 24 * 60; m += 7) {
      expect(skyColor(m / 60)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("is bright blue at noon and dark at midnight", () => {
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(skyColor(12))).toBeGreaterThan(lum(skyColor(0)) * 3);
  });

  it("turns lamps and stars on at night only", () => {
    const night = lightingAt(22);
    const noon = lightingAt(12);
    expect(night).toMatchObject({ lampsOn: true, stars: true, period: "night", sunIntensity: 0 });
    expect(noon).toMatchObject({ lampsOn: false, stars: false, period: "day" });
    expect(lightingAt(6.6).period).toBe("dawn");
    expect(lightingAt(18).period).toBe("dusk");
  });
});
