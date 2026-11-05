// Person page logic — pure, no network.
import { describe, expect, it } from "vitest";
import type { FamilyMember, Memory, Routine } from "../../src/lib/domain/types";
import { buildPerson, memoriesWith } from "../../src/lib/elder/person";

const stamp = "2026-10-01T00:00:00Z";
const helen: FamilyMember = { id: "h", caregiver_id: "c", elder_id: "e", full_name: "Helen Example", relationship: "Daughter", description: "Lives nearby", photo_path: null, created_at: stamp, updated_at: stamp };
const raj: FamilyMember = { ...helen, id: "r", full_name: "Raj Patel", relationship: "Grandson", description: "" };
const routine = (over: Partial<Routine>): Routine => ({ id: `r-${over.title}`, caregiver_id: "c", elder_id: "e", title: "x", description: "", recurrence: "weekly", activity_date: null, weekday: 4, time_of_day: "15:00:00", is_active: true, created_at: stamp, updated_at: stamp, ...over });
const memory = (over: Partial<Memory>): Memory => ({ id: `m-${over.title}`, caregiver_id: "c", elder_id: "e", title: "x", description: "y", event_date: null, related_person_id: null, category: "visit", created_at: stamp, updated_at: stamp, ...over });
const NOW = new Date("2026-11-05T10:30:00Z"); // Thursday, London

describe("person page", () => {
  it("introduces the person and says when they're next coming", () => {
    const v = buildPerson({ member: helen, routines: [routine({ title: "Helen visits" })], memories: [], timezone: "Europe/London", now: NOW });
    expect(v.intro).toBe("This is Helen Example, your daughter.");
    expect(v.about).toBe("Lives nearby.");
    expect(v.next).toEqual({ title: "Helen visits", when: "today at 3:00 PM" });
    expect(v.speech).toBe("This is Helen Example, your daughter. Lives nearby. Next: Helen visits, today at 3:00 PM.");
  });

  it("names the weekday for a visit later this week, and ignores paused routines", () => {
    const routines = [routine({ title: "Helen visits", weekday: 1 }), routine({ title: "Helen paused", weekday: 5, is_active: false })];
    const v = buildPerson({ member: helen, routines, memories: [], timezone: "Europe/London", now: NOW });
    expect(v.next).toEqual({ title: "Helen visits", when: "on Monday at 3:00 PM" });
  });

  it("lists recent memories linked to or naming them, newest first, never future ones", () => {
    const memories = [
      memory({ title: "Old tea", event_date: "2026-09-01", related_person_id: "h" }),
      memory({ title: "Sunday lunch", event_date: "2026-11-01", description: "Helen cooked." }),
      memory({ title: "Raj's concert", event_date: "2026-11-02", related_person_id: "r" }),
      memory({ title: "Planned trip with Helen", event_date: "2026-12-01" }),
    ];
    const v = buildPerson({ member: helen, routines: [], memories, timezone: "Europe/London", now: NOW });
    expect(v.memories.map((m) => [m.title, m.when])).toEqual([["Sunday lunch", "on Sunday"], ["Old tea", "on 1 September"]]);
    expect(v.speech).toContain("A memory with Helen: Sunday lunch. That was on Sunday.");
  });

  it("first-name matching is whole-word only", () => {
    expect(memoriesWith(raj, [memory({ title: "Rajasthan film night" })])).toEqual([]);
    expect(memoriesWith(raj, [memory({ title: "Tea", description: "Raj came by" })])).toHaveLength(1);
  });

  it("with no plans or memories, just the introduction", () => {
    const v = buildPerson({ member: raj, routines: [], memories: [], timezone: "Europe/London", now: NOW });
    expect(v.speech).toBe("This is Raj Patel, your grandson.");
    expect(v.next).toBeNull();
  });
});
