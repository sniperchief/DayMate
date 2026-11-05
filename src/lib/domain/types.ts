export type Recurrence = "none" | "daily" | "weekly";

export const MEMORY_CATEGORIES = ["family", "visit", "celebration", "conversation", "preference", "activity", "milestone", "other"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  family: "Family",
  visit: "Visit",
  celebration: "Celebration",
  conversation: "Conversation",
  preference: "Likes & preferences",
  activity: "Activity",
  milestone: "Life milestone",
  other: "Other",
};

export const RELATIONSHIP_SUGGESTIONS = [
  "Daughter", "Son", "Granddaughter", "Grandson", "Wife", "Husband", "Partner",
  "Sister", "Brother", "Niece", "Nephew", "Friend", "Neighbour", "Carer",
];

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export interface Elder {
  id: string;
  caregiver_id: string;
  full_name: string;
  photo_path: string | null;
  date_of_birth: string | null;
  description: string;
  notes: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface FamilyMember {
  id: string;
  caregiver_id: string;
  elder_id: string;
  full_name: string;
  relationship: string;
  description: string;
  photo_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Routine {
  id: string;
  caregiver_id: string;
  elder_id: string;
  title: string;
  description: string;
  recurrence: Recurrence;
  activity_date: string | null;
  weekday: number | null;
  /** "HH:MM" or "HH:MM:SS" as returned by Postgres `time`. */
  time_of_day: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Memory {
  id: string;
  caregiver_id: string;
  elder_id: string;
  title: string;
  description: string;
  event_date: string | null;
  related_person_id: string | null;
  category: MemoryCategory;
  /** Optional photo (redesign M5); undefined before that migration is applied. */
  photo_path?: string | null;
  created_at: string;
  updated_at: string;
}

export type WalrusKind = "profile" | "family_member" | "routine" | "memory";
export type WalrusStatus = "pending" | "stored" | "failed";

export interface WalrusRecord {
  id: string;
  caregiver_id: string;
  elder_id: string;
  kind: WalrusKind;
  family_member_id: string | null;
  routine_id: string | null;
  memory_id: string | null;
  namespace: string;
  content_hash: string;
  status: WalrusStatus;
  job_id: string | null;
  blob_id: string | null;
  previous_blob_ids: string[];
  error: string | null;
  attempts: number;
  stored_at: string | null;
  created_at: string;
  updated_at: string;
}

/** State returned by every form server action. */
export interface FormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of submitted text values so the form can be re-filled after an error. */
  values?: Record<string, string>;
  /** Changes on every response so the form re-mounts with fresh defaults. */
  nonce?: string;
}

export const IDLE: FormState = { status: "idle" };
