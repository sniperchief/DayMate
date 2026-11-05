/**
 * Clean-up for SPOKEN questions (speech-to-text transcripts) before they go to
 * the normal Ask DayMate router. Deterministic, no AI:
 *
 *  - drops fillers ("um", "erm", "you know") and a leading wake phrase
 *    ("hey DayMate");
 *  - collapses stutters and restarts ("who who is", "who is who is my daughter");
 *  - corrects misheard family first names ("Ellen" → "Helen") when exactly one
 *    saved name is a close match (1 edit for short words, 2 for 5+ letters)
 *    and the word is not ordinary vocabulary.
 *
 * Typed questions never pass through this, so Phase 3A behaviour is unchanged.
 */

const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "er", "erm", "err", "ah", "ahh", "hmm", "hm", "mm", "mmm", "eh"]);
const FILLER_PHRASES = [/\byou know\b/gi, /\bi mean\b/gi, /\bkind of\b/gi, /\bsort of\b/gi];
const WAKE = /^(hey|hi|hello|ok|okay)?[\s,]*day ?mate[\s,.!?]*/i;

/**
 * Ordinary words that must never be "corrected" into a name, even if they are
 * one letter away (e.g. "when"→"Wren", "mark"→"Mark" is fine but "make" is not).
 */
const VOCABULARY = new Set(
  (
    "a about after again all am an and any are as at back be because been before being best birthday both brother brothers but by call called came can carer come comes coming could cousin " +
    "dad daughter daughters day days did do does doing done down each evening family father favourite food for friend friends from garden gave get go goes going good grandchild grandchildren " +
    "granddaughter grandson grandsons had has have he hear help her here him his home house how husband i if in into is it its just know last later like likes live lives love lunch made make " +
    "many may me meet met mine month more morning most mother much mum music must my name near neighbour nephew new next niece night no not now of off often on once one only or other our " +
    "out over partner people person play played please remember said same saw say see seeing should show sister sisters so some something son sons soon still story sunday monday tuesday " +
    "wednesday thursday friday saturday take tea tell than that the their them then there these they thing things think this those time times to today tomorrow told too took up us very " +
    "visit visited visiting visits want was way we week weekend well went were what when where which while who whom whose why wife will with would year years yes yesterday you your"
  ).split(" "),
);

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

function tokens(text: string): string[] {
  return text
    .replace(/[“”"]/g, " ")
    .replace(/[,.!?;:]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const CONTRACTIONS: [RegExp, string][] = [
  [/\bwho's\b/gi, "who is"],
  [/\bwhat's\b/gi, "what is"],
  [/\bwhen's\b/gi, "when is"],
  [/\bwhere's\b/gi, "where is"],
  [/\bi'm\b/gi, "I am"],
];

/** Remove fillers, wake phrase, stutters and repeated restarts ("who's… who is"). */
export function cleanSpoken(transcript: string): string {
  let t = transcript.trim().replace(/[’‘]/g, "'").replace(WAKE, "");
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  for (const re of FILLER_PHRASES) t = t.replace(re, " ");
  let w = tokens(t).filter((x) => !FILLERS.has(x.toLowerCase()));
  // collapse immediate repeats of 1–3 word phrases: "who who is", "who is who is"
  for (let n = 3; n >= 1; n--) {
    const out: string[] = [];
    for (let i = 0; i < w.length; i++) {
      out.push(w[i]!);
      if (out.length >= 2 * n) {
        const a = out.slice(-2 * n, -n).join(" ").toLowerCase();
        const b = out.slice(-n).join(" ").toLowerCase();
        if (a === b) out.splice(-n, n);
      }
    }
    w = out;
  }
  return w.join(" ").trim();
}

/** Replace a misheard word with a saved first name when exactly one name is a close match. */
export function fixNames(text: string, firstNames: readonly string[]): string {
  const names = [...new Set(firstNames.map((n) => n.trim()).filter((n) => n.length >= 3))];
  if (!names.length) return text;
  return tokens(text)
    .map((word) => {
      const lw = word.toLowerCase().replace(/'s$/, "");
      if (lw.length < 3 || VOCABULARY.has(lw)) return word;
      if (names.some((n) => n.toLowerCase() === lw)) return word;
      const max = lw.length >= 5 ? 2 : 1;
      const close = names.filter((n) => editDistance(lw, n.toLowerCase()) <= max);
      if (close.length !== 1) return word;
      return word.toLowerCase().endsWith("'s") ? `${close[0]}'s` : close[0]!;
    })
    .join(" ");
}

/** Full pipeline for a spoken question. Returns "" when nothing meaningful was said. */
export function prepareSpokenQuestion(transcript: string, familyFirstNames: readonly string[]): string {
  const cleaned = fixNames(cleanSpoken(transcript), familyFirstNames);
  if (!cleaned) return "";
  const q = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return /[?.!]$/.test(q) ? q : `${q}?`;
}
