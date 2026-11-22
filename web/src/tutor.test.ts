import { expect, test } from "vitest";
import { parseWords } from "./screens/Tutor";

test("parses 'italiano = English' lines with several separators", () => {
  expect(parseWords("la scadenza = deadline\nfare una pausa – to take a break\nil capo: the boss\nla riunione - the meeting\n\n  ")).toEqual([
    { it: "la scadenza", en: "deadline" },
    { it: "fare una pausa", en: "to take a break" },
    { it: "il capo", en: "the boss" },
    { it: "la riunione", en: "the meeting" },
  ]);
});

test("ignores lines without a separator and keeps hyphenated words intact", () => {
  expect(parseWords("just a note\nil check-in = the check-in")).toEqual([{ it: "il check-in", en: "the check-in" }]);
});
