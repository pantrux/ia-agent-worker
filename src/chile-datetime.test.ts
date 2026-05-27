import { describe, expect, it } from "vitest";
import { CHILE_TIMEZONE, formatChileDateTime } from "../src/chile-datetime.js";

describe("formatChileDateTime", () => {
  it("formatea en zona horaria Chile continental", () => {
    const formatted = formatChileDateTime(new Date("2026-05-27T12:00:00.000Z"));
    expect(CHILE_TIMEZONE).toBe("America/Santiago");
    expect(formatted.toLowerCase()).toContain("2026");
    expect(formatted.length).toBeGreaterThan(10);
  });
});
