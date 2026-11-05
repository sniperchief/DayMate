import { describe, expect, it } from "vitest";
import { describeSchedule, formatTime, localNow, upcomingOccurrences } from "../../src/lib/domain/schedule";
import type { Routine } from "../../src/lib/domain/types";

function routine(p: Partial<Routine>): Routine {
  return {
    id: p.title ?? "r",
    caregiver_id: "c",
    elder_id: "e",
    title: "r",
    description: "",
    recurrence: "daily",
    activity_date: null,
    weekday: null,
    time_of_day: "09:00:00",
    is_active: true,
    created_at: "",
    updated_at: "",
    ...p,
  };
}

// Wednesday 4 November 2026, 08:30 in London (UTC+0 in November)
const NOW = new Date("2026-11-04T08:30:00Z");

describe("upcomingOccurrences", () => {
  it("lists daily routines for each day, skipping times already past today", () => {
    const occ = upcomingOccurrences([routine({ title: "Tea", time_of_day: "07:00:00" }), routine({ title: "Walk", time_of_day: "09:00:00" })], NOW, "Europe/London", 2);
    expect(occ.map((o) => `${o.date} ${o.time} ${o.routine.title}`)).toEqual(["2026-11-04 09:00 Walk", "2026-11-05 07:00 Tea", "2026-11-05 09:00 Walk"]);
  });

  it("places weekly routines on their weekday", () => {
    const occ = upcomingOccurrences([routine({ title: "Coffee morning", recurrence: "weekly", weekday: 3, time_of_day: "10:30" })], NOW, "Europe/London", 8);
    expect(occ.map((o) => o.date)).toEqual(["2026-11-04", "2026-11-11"]);
  });

  it("includes one-time activities only on their date", () => {
    const occ = upcomingOccurrences([routine({ title: "Leo visits", recurrence: "none", activity_date: "2026-11-07", time_of_day: "14:00" })], NOW, "Europe/London", 7);
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({ date: "2026-11-07", time: "14:00" });
    expect(upcomingOccurrences([routine({ recurrence: "none", activity_date: "2026-12-25" })], NOW, "Europe/London", 7)).toHaveLength(0);
  });

  it("ignores paused routines", () => {
    expect(upcomingOccurrences([routine({ is_active: false })], NOW, "Europe/London", 7)).toHaveLength(0);
  });

  it("uses the elder's time zone for 'today'", () => {
    // 12:30 UTC on the 4th is already 01:30 on the 5th in Auckland (UTC+13)
    const late = new Date("2026-11-04T12:30:00Z");
    expect(localNow(late, "Pacific/Auckland")).toMatchObject({ date: "2026-11-05", time: "01:30" });
    expect(localNow(late, "Europe/London").date).toBe("2026-11-04");
    const oneOff = [routine({ recurrence: "none", activity_date: "2026-11-04", time_of_day: "23:00" })];
    expect(upcomingOccurrences(oneOff, late, "Pacific/Auckland", 3)).toHaveLength(0);
    expect(upcomingOccurrences(oneOff, late, "Europe/London", 3)).toHaveLength(1);
  });
});

describe("formatting", () => {
  it("formats times and schedules for people", () => {
    expect(formatTime("07:00:00")).toBe("7:00 AM");
    expect(formatTime("00:05")).toBe("12:05 AM");
    expect(formatTime("14:30")).toBe("2:30 PM");
    expect(describeSchedule(routine({ recurrence: "weekly", weekday: 3, time_of_day: "10:30" }))).toBe("Every Wednesday at 10:30 AM");
    expect(describeSchedule(routine({ recurrence: "none", activity_date: "2026-11-14", time_of_day: "14:00" }))).toBe("Saturday 14 November 2026 at 2:00 PM");
  });
});
