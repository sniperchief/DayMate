// Pure "Today" screen logic — no network.
import { describe, expect, it } from "vitest";
import type { FamilyMember, Routine } from "../../src/lib/domain/types";
import { buildToday, friendlyPast, partOfDay, peopleIn } from "../../src/lib/elder/today";

const stamp = "2026-11-01T00:00:00Z";
const routine = (over: Partial<Routine>): Routine => ({
  id: `r-${over.title}`,
  caregiver_id: "c",
  elder_id: "e",
  title: "Walk",
  description: "",
  recurrence: "daily",
  activity_date: null,
  weekday: null,
  time_of_day: "09:00:00",
  is_active: true,
  created_at: stamp,
  updated_at: stamp,
  ...over,
});
const member = (full_name: string, relationship: string): FamilyMember => ({
  id: `f-${full_name}`,
  caregiver_id: "c",
  elder_id: "e",
  full_name,
  relationship,
  description: "",
  photo_path: null,
  created_at: stamp,
  updated_at: stamp,
});

const elder = { full_name: "Rose Example", timezone: "Europe/London" };
const helen = member("Helen Example", "Daughter");
const raj = member("Raj Patel", "Grandson");
// Thursday 5 November 2026, 10:30 in London (UTC+0 in November)
const NOW = new Date("2026-11-05T10:30:00Z");

describe("Today screen", () => {
  it("greets by part of day and shows weekday + date in the elder's time zone", () => {
    const t = buildToday({ elder, routines: [], family: [], now: NOW });
    expect(t.greeting).toBe("Good morning, Rose");
    expect(t.weekday).toBe("Thursday");
    expect(t.dateLabel).toBe("5 November");
    expect(partOfDay("11:59")).toBe("morning");
    expect(partOfDay("12:00")).toBe("afternoon");
    expect(partOfDay("18:00")).toBe("evening");
  });

  it("uses the elder's time zone, not the server's", () => {
    const t = buildToday({ elder: { ...elder, timezone: "Asia/Tokyo" }, routines: [], family: [], now: NOW }); // 19:30 in Tokyo
    expect(t.greeting).toBe("Good evening, Rose");
  });

  it("lists the rest of today in order, skipping what already happened and paused routines", () => {
    const routines = [
      routine({ title: "Breakfast", time_of_day: "08:00:00" }),
      routine({ title: "Helen visits", recurrence: "weekly", weekday: 4, time_of_day: "15:00:00" }),
      routine({ title: "Lunch", time_of_day: "12:30:00" }),
      routine({ title: "Paused walk", time_of_day: "11:00:00", is_active: false }),
      routine({ title: "Dentist", recurrence: "none", activity_date: "2026-11-06", time_of_day: "10:00:00" }),
    ];
    const t = buildToday({ elder, routines, family: [helen, raj], now: NOW });
    expect(t.items.map((i) => `${i.time} ${i.title}`)).toEqual(["12:30 PM Lunch", "3:00 PM Helen visits"]);
    expect(t.items[1]!.people.map((p) => p.full_name)).toEqual(["Helen Example"]);
    expect(t.tomorrow).toBeNull();
    expect(t.speech).toBe("Good morning, Rose. Today is Thursday the 5th of November. Next, Lunch at 12:30 PM. Then Helen visits at 3:00 PM.");
  });

  it("when nothing is left today, says so and mentions tomorrow", () => {
    const routines = [routine({ title: "Dentist", recurrence: "none", activity_date: "2026-11-06", time_of_day: "10:00:00" })];
    const t = buildToday({ elder, routines, family: [], now: NOW });
    expect(t.items).toEqual([]);
    expect(t.tomorrow?.title).toBe("Dentist");
    expect(t.speech).toContain("You have nothing else planned for today. Tomorrow, Dentist at 10:00 AM.");
  });

  it("finds people by first name only as a whole word", () => {
    expect(peopleIn({ title: "Raj comes for tea", description: "" }, [helen, raj]).map((p) => p.full_name)).toEqual(["Raj Patel"]);
    expect(peopleIn({ title: "Rajasthan documentary", description: "" }, [raj])).toEqual([]);
    expect(peopleIn({ title: "Walk", description: "with Helen" }, [helen])).toHaveLength(1);
  });

  it("speech never includes IDs or photo paths", () => {
    const routines = [routine({ title: "Helen visits", time_of_day: "15:00:00" })];
    const t = buildToday({ elder, routines, family: [{ ...helen, photo_path: "c/e/family-x.png" }], now: NOW });
    expect(t.speech).not.toMatch(/f-Helen|r-|\.png/);
  });
});

describe("friendlyPast", () => {
  const today = "2026-11-05"; // Thursday
  it.each([
    ["2026-11-05", "today"],
    ["2026-11-04", "yesterday"],
    ["2026-11-01", "on Sunday"],
    ["2026-10-29", "on 29 October"],
    ["2025-12-25", "on 25 December 2025"],
    ["2026-11-06", "tomorrow"],
  ])("%s → %s", (date, expected) => {
    expect(friendlyPast(date, today)).toBe(expected);
  });
});
