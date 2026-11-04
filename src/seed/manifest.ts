/**
 * Deterministic Phase 1 seed manifest. All people, places and events are
 * FICTIONAL demonstration data — no real person is described.
 *
 * Fictional subject: Margaret Ellison, 82, of Ashford Green.
 *
 * Changing an entry's text creates a NEW memory on Walrus (content-addressed
 * deduplication); bump MANIFEST_VERSION when doing so deliberately.
 */
export const MANIFEST_VERSION = "phase1-v1";

export type SeedCategory =
  | "family-relationship"
  | "family-description"
  | "recent-visit"
  | "upcoming-visit"
  | "morning-routine"
  | "favourite-activity"
  | "favourite-music"
  | "milestone"
  | "social-activity"
  | "family-event"
  | "neighbour";

export interface SeedMemory {
  id: string;
  category: SeedCategory;
  text: string;
}

export const SEED_MEMORIES: readonly SeedMemory[] = [
  {
    id: "daughter-relationship",
    category: "family-relationship",
    text: "Margaret Ellison's daughter is Clara Moore. Clara is Margaret's only daughter and lives twenty minutes away in Ashford Green with her husband Tom.",
  },
  {
    id: "daughter-description",
    category: "family-description",
    text: "Clara Moore, Margaret's daughter, is 54, has short curly red hair and wears round glasses. She is a primary school teacher and always brings Margaret a homemade lemon drizzle cake.",
  },
  {
    id: "grandson-relationship",
    category: "family-relationship",
    text: "Leo Moore is Margaret Ellison's grandson, Clara's son. He is 19, tall with dark hair, and studies marine biology at university in Plymouth.",
  },
  {
    id: "recent-visit-clara",
    category: "recent-visit",
    text: "On Sunday 1 November 2026, Margaret's daughter Clara visited for lunch. They ate roast chicken together and looked through old photo albums from Margaret's wedding.",
  },
  {
    id: "upcoming-visit-leo",
    category: "upcoming-visit",
    text: "Margaret's grandson Leo is expected to visit on Saturday 14 November 2026 at around 2pm, after his university exams. He plans to stay for tea and help set up her new digital radio.",
  },
  {
    id: "morning-routine",
    category: "morning-routine",
    text: "Margaret's morning routine: she wakes around 7am, opens the bedroom curtains, makes a pot of Earl Grey tea, eats porridge with honey, and then does the newspaper crossword at the kitchen table.",
  },
  {
    id: "favourite-activity-gardening",
    category: "favourite-activity",
    text: "Margaret's favourite activity is gardening. She looks after a bed of pink roses and some tomato plants in her back garden and likes to water them in the late afternoon.",
  },
  {
    id: "favourite-music",
    category: "favourite-music",
    text: "Margaret loves big band and swing music, especially Glenn Miller. The song 'In the Mood' always makes her smile, and she enjoys listening to swing on the radio after lunch.",
  },
  {
    id: "milestone-wedding-career",
    category: "milestone",
    text: "Margaret married her late husband Arthur Ellison on 12 June 1965 at St Mary's Church in Ashford Green. She worked as a librarian at the Ashford Green town library for 35 years and retired in 2003.",
  },
  {
    id: "social-coffee-morning",
    category: "social-activity",
    text: "Every Wednesday at 10:30am Margaret goes to the coffee morning at the Ashford Green community centre, where she plays bridge with her friends Doris and Ken.",
  },
  {
    id: "family-event-birthday",
    category: "family-event",
    text: "At Margaret's 82nd birthday party in her garden on 20 September 2026, her granddaughter Sophie announced her engagement to her partner Daniel, and the whole family raised a toast with elderflower cordial.",
  },
  {
    id: "neighbour-raj",
    category: "neighbour",
    text: "Margaret's next-door neighbour Raj Patel, at number 14, keeps a spare key to her house and usually pops in to say hello around 6pm most evenings.",
  },
];

export interface RecallCheck {
  question: string;
  /** Seed entry the answer should come from (used only to grade results). */
  expectSeedId: string;
  /** Lowercase phrases that must appear in a top result for the check to pass. */
  mustContain: string[];
}

export const RECALL_CHECKS: readonly RecallCheck[] = [
  { question: "Who is Margaret's daughter?", expectSeedId: "daughter-relationship", mustContain: ["clara"] },
  { question: "What does Clara look like?", expectSeedId: "daughter-description", mustContain: ["red hair"] },
  { question: "Who visited Margaret recently?", expectSeedId: "recent-visit-clara", mustContain: ["1 november", "clara"] },
  { question: "When is the grandson expected to visit?", expectSeedId: "upcoming-visit-leo", mustContain: ["14 november"] },
  { question: "What is Margaret's morning routine?", expectSeedId: "morning-routine", mustContain: ["porridge"] },
  { question: "What music does Margaret enjoy?", expectSeedId: "favourite-music", mustContain: ["glenn miller"] },
  { question: "What important family event was recorded?", expectSeedId: "family-event-birthday", mustContain: ["engagement"] },
  { question: "What does Margaret do on Wednesdays?", expectSeedId: "social-coffee-morning", mustContain: ["bridge"] },
  { question: "When did Margaret get married and to whom?", expectSeedId: "milestone-wedding-career", mustContain: ["arthur"] },
];
