import { describe, expect, it } from "vitest";
import { assertValidNamespace } from "../../src/lib/memory";
import { contentHash, elderNamespace, familyMemberText, memoryText, profileText, routineText } from "../../src/lib/walrus-sync/text";

describe("Walrus memory text", () => {
  it("profile text uses only the name and description (no DOB, notes or photo)", () => {
    const text = profileText({ full_name: "Margaret Ellison", description: "Loves roses", ...({ date_of_birth: "1944-03-02", notes: "private" } as object) });
    expect(text).toBe("About Margaret Ellison: Loves roses.");
    expect(text).not.toMatch(/1944|private/);
    expect(profileText({ full_name: "M", description: "  " })).toBeNull();
  });

  it("family member text states the relationship", () => {
    expect(familyMemberText("Margaret", { full_name: "Clara Moore", relationship: "Daughter", description: "Has red hair" })).toBe("Clara Moore is Margaret's daughter. Has red hair.");
    expect(familyMemberText("James", { full_name: "Ann", relationship: "Wife", description: "" })).toBe("Ann is James' wife.");
  });

  it("routine text describes the schedule; paused routines produce nothing", () => {
    const r = { title: "Coffee morning", description: "", recurrence: "weekly" as const, activity_date: null, weekday: 3, time_of_day: "10:30", is_active: true };
    expect(routineText("Margaret", r)).toBe("Margaret's routine: Coffee morning — every Wednesday at 10:30 AM.");
    expect(routineText("Margaret", { ...r, recurrence: "none", activity_date: "2026-11-14", weekday: null })).toBe(
      "Margaret's planned activity: Coffee morning — on Saturday 14 November 2026 at 10:30 AM.",
    );
    expect(routineText("Margaret", { ...r, is_active: false })).toBeNull();
  });

  it("memory text includes date and related person", () => {
    expect(memoryText("Margaret", { title: "Sophie got engaged", description: "At the birthday party", event_date: "2026-09-20" }, { full_name: "Sophie", relationship: "Granddaughter" })).toBe(
      "Memory about Margaret (Sunday 20 September 2026): Sophie got engaged. At the birthday party. This involves Sophie, Margaret's granddaughter.",
    );
  });

  it("hash is stable and whitespace-insensitive at the ends", () => {
    expect(contentHash(" a ")).toBe(contentHash("a"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });

  it("elder namespace is opaque, valid, and separate from Phase 1", () => {
    const ns = elderNamespace("0B8C2F4A-1D2E-4F60-8A9B-0C1D2E3F4A5B");
    expect(ns).toBe("daymate-elder-0b8c2f4a-1d2e-4f60-8a9b-0c1d2e3f4a5b");
    expect(ns).not.toBe("daymate-phase1");
    expect(() => assertValidNamespace(ns)).not.toThrow();
  });
});
