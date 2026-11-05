import { z } from "zod";
import { MEMORY_CATEGORIES } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (label: string, max: number) =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`);
const optionalText = (label: string, max: number) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).default("");

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .default("")
    .refine((s) => s === "" || (DATE_RE.test(s) && isRealDate(s)), `${label} must be a valid date.`)
    .transform((s) => (s === "" ? null : s));

export const uuid = z.string().regex(UUID_RE, "Invalid identifier.");

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const elderSchema = z.object({
  full_name: text("Full name", 120),
  date_of_birth: optionalDate("Date of birth").refine((d) => d === null || (d >= "1900-01-01" && d <= new Date().toISOString().slice(0, 10)), "Date of birth must be in the past."),
  description: text("Short description", 1000),
  notes: optionalText("Notes", 2000),
  timezone: z
    .string()
    .trim()
    .default("UTC")
    .transform((tz) => (tz && isValidTimeZone(tz) ? tz : "UTC")),
});

export const familyMemberSchema = z.object({
  full_name: text("Full name", 120),
  relationship: text("Relationship", 40),
  description: optionalText("Description", 1000),
});

export const routineSchema = z
  .object({
    title: text("Activity", 120),
    description: optionalText("Description", 1000),
    recurrence: z.enum(["none", "daily", "weekly"], { error: "Choose how often this happens." }),
    activity_date: optionalDate("Date"),
    weekday: z
      .string()
      .trim()
      .default("")
      .transform((s, ctx) => {
        if (s === "") return null;
        const n = Number(s);
        if (!Number.isInteger(n) || n < 0 || n > 6) {
          ctx.addIssue({ code: "custom", message: "Choose a day of the week." });
          return z.NEVER;
        }
        return n;
      }),
    time_of_day: z.string({ error: "Time is required." }).trim().regex(TIME_RE, "Enter a time like 09:30."),
    is_active: z
      .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
      .optional()
      .transform((v) => v === "on" || v === "true"),
  })
  .superRefine((r, ctx) => {
    if (r.recurrence === "none" && !r.activity_date) ctx.addIssue({ code: "custom", path: ["activity_date"], message: "Choose the date for a one-time activity." });
    if (r.recurrence === "weekly" && r.weekday === null) ctx.addIssue({ code: "custom", path: ["weekday"], message: "Choose the day of the week." });
  })
  .transform((r) => ({
    ...r,
    // keep the stored shape consistent with the DB check constraint
    activity_date: r.recurrence === "none" ? r.activity_date : null,
    weekday: r.recurrence === "weekly" ? r.weekday : null,
  }));

export const memorySchema = z.object({
  title: text("Title", 120),
  description: text("Description", 2000),
  event_date: optionalDate("Event date"),
  related_person_id: z
    .string()
    .trim()
    .default("")
    .refine((s) => s === "" || UUID_RE.test(s), "Choose a person from the list.")
    .transform((s) => (s === "" ? null : s)),
  category: z.enum(MEMORY_CATEGORIES, { error: "Choose a category." }),
});

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Password must be at least 8 characters.").max(72, "Password must be 72 characters or fewer."),
});

export const registerSchema = credentialsSchema.extend({
  display_name: optionalText("Your name", 80),
});

export const forgotPasswordSchema = credentialsSchema.pick({ email: true });

export const newPasswordSchema = z
  .object({
    password: credentialsSchema.shape.password,
    confirm_password: z.string(),
  })
  .refine((v) => v.password === v.confirm_password, { message: "The two passwords don't match.", path: ["confirm_password"] });

export type ElderInput = z.output<typeof elderSchema>;
export type FamilyMemberInput = z.output<typeof familyMemberSchema>;
export type RoutineInput = z.output<typeof routineSchema>;
export type MemoryInput = z.output<typeof memorySchema>;

/** Text fields of a FormData as a plain object (files are skipped). */
export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) out[key] = value;
  }
  return out;
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: Record<string, string> };

export function parseForm<S extends z.ZodType>(schema: S, values: Record<string, string>): ParseResult<z.output<S>> {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Returns null when no photo was chosen, an error string, or the validated file. */
export function validatePhoto(value: FormDataEntryValue | null): { file: File | null; error?: string } {
  if (!value || typeof value === "string" || value.size === 0) return { file: null };
  if (!PHOTO_TYPES[value.type]) return { file: null, error: "Photo must be a JPEG, PNG or WebP image." };
  if (value.size > PHOTO_MAX_BYTES) return { file: null, error: "Photo must be 4 MB or smaller." };
  return { file: value };
}
