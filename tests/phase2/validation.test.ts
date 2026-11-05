import { describe, expect, it } from "vitest";
import { credentialsSchema, elderSchema, familyMemberSchema, memorySchema, parseForm, registerSchema, routineSchema, validatePhoto } from "../../src/lib/domain/validation";

describe("elderSchema", () => {
  it("accepts a minimal profile and normalises optional fields", () => {
    const r = parseForm(elderSchema, { full_name: "  Margaret Ellison ", description: "Loves gardening." });
    expect(r).toEqual({ ok: true, data: { full_name: "Margaret Ellison", description: "Loves gardening.", date_of_birth: null, notes: "", timezone: "UTC" } });
  });
  it("requires a name and description", () => {
    const r = parseForm(elderSchema, { full_name: " ", description: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(["description", "full_name"]);
  });
  it("rejects impossible and future dates of birth", () => {
    expect(parseForm(elderSchema, { full_name: "A", description: "B", date_of_birth: "1944-02-30" }).ok).toBe(false);
    expect(parseForm(elderSchema, { full_name: "A", description: "B", date_of_birth: "2999-01-01" }).ok).toBe(false);
  });
  it("falls back to UTC for an unknown time zone", () => {
    const r = parseForm(elderSchema, { full_name: "A", description: "B", timezone: "Mars/Olympus" });
    expect(r.ok && r.data.timezone).toBe("UTC");
    const ok = parseForm(elderSchema, { full_name: "A", description: "B", timezone: "Europe/London" });
    expect(ok.ok && ok.data.timezone).toBe("Europe/London");
  });
  it("enforces length limits", () => {
    expect(parseForm(elderSchema, { full_name: "x".repeat(121), description: "B" }).ok).toBe(false);
  });
});

describe("familyMemberSchema", () => {
  it("requires name and relationship", () => {
    expect(parseForm(familyMemberSchema, { full_name: "Clara", relationship: "Daughter" }).ok).toBe(true);
    const r = parseForm(familyMemberSchema, { full_name: "Clara", relationship: "" });
    expect(!r.ok && r.fieldErrors.relationship).toBeTruthy();
  });
});

describe("routineSchema", () => {
  const base = { title: "Morning tea", time_of_day: "07:00", is_active: "on" };
  it("accepts a daily routine and clears date/weekday", () => {
    const r = parseForm(routineSchema, { ...base, recurrence: "daily", activity_date: "2026-11-14", weekday: "3" });
    expect(r.ok && r.data).toMatchObject({ recurrence: "daily", activity_date: null, weekday: null, is_active: true });
  });
  it("requires a weekday for weekly routines", () => {
    const r = parseForm(routineSchema, { ...base, recurrence: "weekly" });
    expect(!r.ok && r.fieldErrors.weekday).toBeTruthy();
    const ok = parseForm(routineSchema, { ...base, recurrence: "weekly", weekday: "3" });
    expect(ok.ok && ok.data.weekday).toBe(3);
  });
  it("requires a date for one-time activities", () => {
    const r = parseForm(routineSchema, { ...base, recurrence: "none" });
    expect(!r.ok && r.fieldErrors.activity_date).toBeTruthy();
    expect(parseForm(routineSchema, { ...base, recurrence: "none", activity_date: "2026-11-14" }).ok).toBe(true);
  });
  it("validates time and recurrence", () => {
    expect(parseForm(routineSchema, { ...base, recurrence: "daily", time_of_day: "25:00" }).ok).toBe(false);
    expect(parseForm(routineSchema, { ...base, recurrence: "hourly" }).ok).toBe(false);
    expect(parseForm(routineSchema, { ...base, recurrence: "weekly", weekday: "7" }).ok).toBe(false);
  });
  it("treats an unchecked active box as inactive", () => {
    const r = parseForm(routineSchema, { title: "Walk", time_of_day: "09:00", recurrence: "daily" });
    expect(r.ok && r.data.is_active).toBe(false);
  });
});

describe("memorySchema", () => {
  it("accepts a memory with optional person and date", () => {
    const r = parseForm(memorySchema, { title: "Engagement", description: "Sophie got engaged.", category: "celebration", event_date: "", related_person_id: "" });
    expect(r.ok && r.data).toMatchObject({ event_date: null, related_person_id: null });
  });
  it("rejects unknown categories and malformed person ids", () => {
    expect(parseForm(memorySchema, { title: "t", description: "d", category: "medical" }).ok).toBe(false);
    expect(parseForm(memorySchema, { title: "t", description: "d", category: "family", related_person_id: "1; drop table" }).ok).toBe(false);
  });
});

describe("credentials", () => {
  it("normalises email and enforces password length", () => {
    expect(parseForm(credentialsSchema, { email: " Care@Example.COM ", password: "longenough" })).toEqual({ ok: true, data: { email: "care@example.com", password: "longenough" } });
    expect(parseForm(credentialsSchema, { email: "nope", password: "short" }).ok).toBe(false);
    expect(parseForm(registerSchema, { email: "a@b.co", password: "longenough" }).ok).toBe(true);
  });
});

describe("validatePhoto", () => {
  it("accepts small images and rejects others", () => {
    expect(validatePhoto(null)).toEqual({ file: null });
    expect(validatePhoto(new File([], "empty.png", { type: "image/png" }))).toEqual({ file: null });
    expect(validatePhoto(new File(["x"], "a.png", { type: "image/png" })).file).not.toBeNull();
    expect(validatePhoto(new File(["x"], "a.gif", { type: "image/gif" })).error).toBeTruthy();
    expect(validatePhoto(new File([new Uint8Array(5 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" })).error).toBeTruthy();
  });
});
