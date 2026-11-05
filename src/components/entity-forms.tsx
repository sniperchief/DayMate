"use client";

import { useEffect, useState } from "react";
import { CATEGORY_LABELS, MEMORY_CATEGORIES, RELATIONSHIP_SUGGESTIONS, WEEKDAYS, type FormState } from "@/lib/domain/types";
import { Checkbox, FileField, FormShell, Hidden, SelectField, TextArea, TextField, useFieldValue } from "./form";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;
type Defaults = Record<string, string | null | undefined>;

export function ProfileForm({ action, defaults, hasPhoto, isNew }: { action: Action; defaults: Defaults; hasPhoto: boolean; isNew: boolean }) {
  const [timezone, setTimezone] = useState(defaults.timezone ?? "UTC");
  useEffect(() => {
    // New profiles take the caregiver's browser time zone for "upcoming" times.
    if (isNew) setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, [isNew]);

  return (
    <FormShell action={action} defaults={defaults} submitLabel={isNew ? "Create profile" : "Save profile"} multipart>
      <TextField name="full_name" label="Full name" required maxLength={120} autoComplete="off" />
      <TextArea
        name="description"
        label="Short description"
        required
        maxLength={1000}
        hint="A few friendly sentences: who they are, what they enjoy, what matters to them. This is saved to Walrus Memory."
      />
      <div className="row">
        <TextField name="date_of_birth" label="Date of birth" type="date" hint="Kept private — not saved to Walrus." />
        <FileField name="photo" label="Photo" hint="JPEG, PNG or WebP, up to 4 MB." />
      </div>
      {hasPhoto && <Checkbox name="remove_photo" label="Remove the current photo" />}
      <TextArea name="notes" label="Additional notes" maxLength={2000} hint="Private notes for caregivers. Not saved to Walrus. Please don't record medical details here." />
      <Hidden name="timezone" value={timezone} />
    </FormShell>
  );
}

export function FamilyForm({ action, defaults = {}, hasPhoto = false, submitLabel }: { action: Action; defaults?: Defaults; hasPhoto?: boolean; submitLabel: string }) {
  return (
    <FormShell action={action} defaults={defaults} submitLabel={submitLabel} multipart>
      <div className="row">
        <TextField name="full_name" label="Full name" required maxLength={120} autoComplete="off" />
        <TextField name="relationship" label="Relationship" required maxLength={40} list="relationship-options" hint="For example: Daughter, Grandson, Friend." />
      </div>
      <datalist id="relationship-options">
        {RELATIONSHIP_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <TextArea name="description" label="Short description" maxLength={1000} hint="What they look like, where they live, what they share with your loved one." />
      <FileField name="photo" label="Photo" hint="JPEG, PNG or WebP, up to 4 MB." />
      {hasPhoto && <Checkbox name="remove_photo" label="Remove the current photo" />}
    </FormShell>
  );
}

function RoutineFields() {
  const [recurrence, setRecurrence] = useState(useFieldValue("recurrence") || "daily");
  const activeDefault = useFieldValue("is_active");
  return (
    <>
      <TextField name="title" label="Activity" required maxLength={120} hint="For example: Morning tea, Daily walk, Coffee morning." />
      <TextArea name="description" label="Description" maxLength={1000} rows={3} />
      <fieldset className="field">
        <legend>How often?</legend>
        <div className="row" style={{ gap: "0.25rem 1rem" }}>
          {[
            { value: "daily", label: "Every day" },
            { value: "weekly", label: "Every week" },
            { value: "none", label: "Just once" },
          ].map((o) => (
            <label key={o.value} className="check">
              <input type="radio" name="recurrence" value={o.value} checked={recurrence === o.value} onChange={() => setRecurrence(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row">
        {recurrence === "none" && <TextField name="activity_date" label="Date" type="date" required />}
        {recurrence === "weekly" && (
          <SelectField name="weekday" label="Day of the week" required placeholder="Choose a day" options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
        )}
        <TextField name="time_of_day" label="Time" type="time" required />
      </div>
      <Checkbox name="is_active" label="Active (show on the dashboard)" defaultChecked={activeDefault !== "false"} />
    </>
  );
}

export function RoutineForm({ action, defaults = {}, submitLabel }: { action: Action; defaults?: Defaults; submitLabel: string }) {
  return (
    <FormShell action={action} defaults={defaults} submitLabel={submitLabel}>
      <RoutineFields />
    </FormShell>
  );
}

export function MemoryForm({
  action,
  defaults = {},
  people,
  submitLabel,
  hasPhoto = false,
}: {
  action: Action;
  defaults?: Defaults;
  people: { id: string; label: string }[];
  submitLabel: string;
  hasPhoto?: boolean;
}) {
  return (
    <FormShell action={action} defaults={defaults} submitLabel={submitLabel} multipart>
      <TextField name="title" label="Title" required maxLength={120} hint="For example: Sophie got engaged." />
      <TextArea name="description" label="What happened?" required maxLength={2000} hint="Describe it simply, the way you'd remind them of it." />
      <div className="row">
        <SelectField name="category" label="Category" required placeholder="Choose a category" options={MEMORY_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
        <TextField name="event_date" label="When did it happen?" type="date" />
      </div>
      <SelectField name="related_person_id" label="Who was involved?" placeholder="No one in particular" options={people.map((p) => ({ value: p.id, label: p.label }))} />
      <FileField name="photo" label="Photo (optional)" hint="A picture helps them remember. JPEG, PNG or WebP, up to 4 MB." />
      {hasPhoto && <Checkbox name="remove_photo" label="Remove the current photo" />}
    </FormShell>
  );
}
