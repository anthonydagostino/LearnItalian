import { expect, test } from "vitest";
import { computeSkills } from "./skills";
import type { ConversationData } from "./types";
import type { Row } from "./db";

let n = 0;
const conv = (scenario: string, replies: number, level = 1, speakingSeconds = 300): Row<ConversationData> => ({
  id: String(n++),
  updated_at: 0,
  data: {
    scenario,
    scenarioLabel: scenario,
    week: 1,
    level,
    startedAt: 0,
    date: "2026-12-01",
    speakingSeconds,
    messages: Array.from({ length: replies * 2 }, (_, i) => ({ role: i % 2 ? "user" : "assistant", text: "ciao", ts: i })),
  },
});
const skill = (convs: Row<ConversationData>[], id: string) => computeSkills(convs).find((s) => s.id === id)!;

test("no conversations: every skill at 0 stars", () => {
  expect(computeSkills([]).every((s) => s.stars === 0)).toBe(true);
});

test("6 replies earns a star; 5 doesn't (but counts as tried)", () => {
  expect(skill([conv("hotel", 5)], "hotel")).toMatchObject({ stars: 0, detail: expect.stringMatching(/Tried/) });
  expect(skill([conv("hotel", 6)], "hotel").stars).toBe(1);
});

test("three solid sessions all at level 1 cap at two stars; one at level 2 unlocks the third", () => {
  expect(skill([conv("job", 8), conv("job", 8), conv("job", 8)], "job").stars).toBe(2);
  expect(skill([conv("job", 8), conv("job", 8), conv("job", 8, 2)], "job").stars).toBe(3);
  expect(skill(Array.from({ length: 10 }, () => conv("job", 8, 3)), "job").stars).toBe(3);
});

test("other scenarios don't count toward a skill", () => {
  expect(skill([conv("restaurant", 10)], "hotel").stars).toBe(0);
});

test("long conversation skill goes by the longest session's minutes", () => {
  expect(skill([conv("free", 2, 1, 9 * 60)], "long").stars).toBe(0);
  expect(skill([conv("free", 2, 1, 10 * 60)], "long").stars).toBe(1);
  expect(skill([conv("free", 2, 1, 20 * 60), conv("free", 2, 1, 5)], "long").stars).toBe(2);
  expect(skill([conv("free", 2, 1, 31 * 60)], "long").stars).toBe(3);
  const missing = conv("free", 2);
  delete missing.data.speakingSeconds;
  expect(skill([missing], "long").stars).toBe(0);
});
