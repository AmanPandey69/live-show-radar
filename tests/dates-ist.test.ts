import { describe, expect, it } from "vitest";
import { formatIst, humanizeDuration, istToUtc, parseDoorsAndShow, parseIndianDate, parseTime, utcToIstDate } from "@/lib/text/dates-ist";

const REF = new Date("2026-10-12T06:00:00Z"); // Mon 12 Oct 2026, 11:30 IST

describe("IST ↔ UTC", () => {
  it("converts IST wall clock to UTC (+05:30)", () => {
    expect(istToUtc("2026-11-14", "19:00")).toBe("2026-11-14T13:30:00Z");
    expect(istToUtc("2026-11-15", "23:59")).toBe("2026-11-15T18:29:00Z");
  });
  it("crosses the date line correctly", () => {
    expect(istToUtc("2026-11-15", "02:00")).toBe("2026-11-14T20:30:00Z");
    expect(utcToIstDate("2026-11-14T20:30:00Z")).toBe("2026-11-15");
  });
  it("formats in IST", () => {
    expect(formatIst("2026-11-14T13:30:00Z")).toBe("Sat 14 Nov, 7:00pm IST");
    expect(formatIst(null)).toBe("date not stated");
  });
  it("humanizes durations", () => {
    expect(humanizeDuration((3 * 60 + 12) * 60_000)).toBe("3h 12m");
    expect(humanizeDuration(50 * 3_600_000)).toBe("2d 2h");
    expect(humanizeDuration(-5)).toBe("0m");
  });
});

describe("Indian date formats", () => {
  const cases: [string, string][] = [
    ["Early Bird till 15th Nov", "2026-11-15"],
    ["15 November 2026", "2026-11-15"],
    ["Sat, 14 Nov", "2026-11-14"],
    ["14-Nov-26", "2026-11-14"],
    ["Nov 14th, 2026", "2026-11-14"],
    ["14/11/2026", "2026-11-14"],
    ["14.11.2026", "2026-11-14"],
    ["14/11", "2026-11-14"],
    ["11/14/2026", "2026-11-14"], // clearly MM/DD
    ["2026-11-14", "2026-11-14"],
    ["5th of December", "2026-12-05"],
  ];
  it.each(cases)("%s → %s", (input, expected) => {
    expect(parseIndianDate(input, REF)?.date).toBe(expected);
  });

  it("rolls a past day-month into next year", () => {
    expect(parseIndianDate("10th Feb", REF)?.date).toBe("2027-02-10");
    expect(parseIndianDate("1st Oct", REF)?.date).toBe("2026-10-01"); // within 30 days: same year (just passed)
  });
  it("resolves relative weekdays", () => {
    expect(parseIndianDate("opens Saturday 10am", REF)).toMatchObject({ date: "2026-10-17", time: "10:00" });
    expect(parseIndianDate("tomorrow 6pm", REF)).toMatchObject({ date: "2026-10-13", time: "18:00" });
  });
  it("does not read times as dates", () => {
    expect(parseIndianDate("doors at 10.30", REF)).toBeNull();
  });
});

describe("times", () => {
  it.each([
    ["7 PM", "19:00"], ["7:30pm", "19:30"], ["19:00 hrs", "19:00"], ["10am", "10:00"],
    ["11.59pm", "23:59"], ["12 am", "00:00"], ["12pm", "12:00"], ["noon", "12:00"],
  ])("%s → %s", (i, o) => expect(parseTime(i)).toBe(o));

  it("separates doors from show time", () => {
    expect(parseDoorsAndShow("Doors open 6pm | Show 7:30pm")).toEqual({ doors: "18:00", show: "19:30" });
    expect(parseDoorsAndShow("Gates/doors at 5 PM")).toEqual({ doors: "17:00", show: null });
    expect(parseDoorsAndShow("8 PM onwards")).toEqual({ doors: null, show: "20:00" });
  });
});
