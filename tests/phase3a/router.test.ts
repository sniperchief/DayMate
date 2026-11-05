import { describe, expect, it } from "vitest";
import { keywords, normalize, parseRange, relationshipMatches, routeQuestion, walrusQuery, type RouterContext } from "../../src/lib/ask/router";

const ctx: RouterContext = {
  elderName: "Rose Whitfield",
  family: [
    { id: "f-helen", full_name: "Helen Whitfield", relationship: "Daughter" },
    { id: "f-sam", full_name: "Sam Whitfield", relationship: "Grandson" },
    { id: "f-raj", full_name: "Raj Patel", relationship: "Neighbour" },
  ],
  routines: [
    { id: "r-walk", title: "Daily walk" },
    { id: "r-coffee", title: "Coffee morning" },
  ],
};
const route = (q: string) => routeQuestion(q, ctx);

describe("normalisation", () => {
  it("lower-cases, expands contractions and drops possessives/punctuation", () => {
    expect(normalize("What's my DAUGHTER'S name?!")).toBe("what is my daughter name");
    expect(normalize("Who’s coming — today?")).toBe("who is coming today");
  });
  it("extracts content keywords without the elder's own name", () => {
    expect(keywords("What music does Rose enjoy?", ["Rose Whitfield"])).toEqual(["music"]);
    expect(keywords("Who visited me recently?")).toEqual(["visit", "recently"]);
  });
  it("matches saved relationship labels to question words", () => {
    expect(relationshipMatches("Daughter", ["daughter"])).toBe(true);
    expect(relationshipMatches("Grandson", ["grandchildren"])).toBe(true);
    expect(relationshipMatches("Daughter-in-law", ["daughter"])).toBe(false);
    expect(relationshipMatches("Husband", ["spouse"])).toBe(true);
  });
});

describe("routing: structured (Supabase) questions", () => {
  it.each([
    ["Who is my daughter?", ["f-helen"]],
    ["who's my daughter", ["f-helen"]],
    ["What is my daughter's name?", ["f-helen"]],
    ["Who are my grandchildren?", ["f-sam"]],
    ["Who is Raj?", ["f-raj"]],
    ["Do I have a son?", []],
  ])("%s → family", (q, ids) => {
    const r = route(q);
    expect(r.kind).toBe("family");
    expect(r.kind === "family" && r.memberIds).toEqual(ids);
  });

  it("lists everyone for family-wide questions", () => {
    expect(route("Who is in my family?")).toMatchObject({ kind: "family", all: true });
  });

  it.each([
    ["What am I doing tomorrow?", { type: "day", offset: 1 }],
    ["What's on today?", { type: "day", offset: 0 }],
    ["What do I have on Wednesday?", { type: "weekday", weekday: 3 }],
    ["What do I do on Fridays?", { type: "weekday", weekday: 5 }],
    ["What is my next activity?", { type: "next" }],
    ["What are my plans this week?", { type: "week" }],
    ["What's my schedule?", { type: "week" }],
  ])("%s → schedule", (q, range) => {
    expect(route(q)).toEqual({ kind: "schedule", range });
  });

  it.each(["When is Helen coming?", "When will my daughter visit?", "When is my grandson coming to see me?", "Is Sam visiting this week?"])("%s → visit plan", (q) => {
    expect(route(q).kind).toBe("visit-plan");
  });

  it("keeps an unknown name from a visit question as a hint", () => {
    expect(route("When is Michael coming?")).toMatchObject({ kind: "visit-plan", memberIds: [], nameHint: "Michael" });
  });

  it("matches routine titles for time questions", () => {
    expect(route("What time is my walk?")).toEqual({ kind: "activity-time", routineIds: ["r-walk"] });
    expect(route("When is coffee morning?")).toEqual({ kind: "activity-time", routineIds: ["r-coffee"] });
  });

  it.each([
    ["What is my name?", "name"],
    ["How old am I?", "age"],
    ["When is my birthday?", "birthday"],
    ["Tell me about myself", "about"],
  ])("%s → profile", (q, field) => {
    expect(route(q)).toEqual({ kind: "profile", field });
  });
});

describe("routing: memories (Walrus) and mixed", () => {
  it.each([
    ["Who visited me recently?", "recent-visit"],
    ["Who came to see me last week?", "recent-visit"],
    ["What music do I enjoy?", "preference"],
    ["What's my favourite food?", "preference"],
    ["What happened at my birthday celebration?", "event"],
    ["Do you remember the garden party?", "event"],
  ])("%s → memory (%s)", (q, mode) => {
    expect(route(q)).toMatchObject({ kind: "memory", mode });
  });

  it("past questions about a person go to memories, filtered to that person", () => {
    expect(route("When did Helen last visit?")).toEqual({ kind: "memory", mode: "recent-visit", memberIds: ["f-helen"] });
  });

  it("'tell me about <name>' is a mixed question", () => {
    expect(route("Tell me about Helen")).toEqual({ kind: "person", memberIds: ["f-helen"] });
  });

  it("does not confuse a past visit with a future one", () => {
    expect(route("Who visited me yesterday?").kind).toBe("memory");
    expect(route("Who is visiting tomorrow?").kind).toBe("visit-plan");
  });

  it("unrecognised questions use a strict memory search, or are unknown", () => {
    expect(route("What's the weather like?")).toMatchObject({ kind: "memory", mode: "general" });
    expect(route("??")).toEqual({ kind: "unknown" });
  });

  it("parses day ranges", () => {
    expect(parseRange("the day after tomorrow")).toEqual({ type: "day", offset: 2 });
    expect(parseRange("nothing here")).toBeNull();
  });
});

describe("walrusQuery (first person → elder's name for recall)", () => {
  it.each([
    ["Who visited me recently?", "who visited rose recently"],
    ["What music do I enjoy?", "what music does rose enjoy"],
    ["What happened at my birthday?", "what happened at rose's birthday"],
    ["Where was I born?", "where was rose born"],
    ["Am I going out today?", "is rose going out today"],
    ["Have I been to Paris?", "has rose been to paris"],
  ])("%s → %s", (q, expected) => {
    expect(walrusQuery(q, "Rose Whitfield")).toBe(expected);
  });
});
