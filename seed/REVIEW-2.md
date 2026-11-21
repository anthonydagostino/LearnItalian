# Seed deck review 2

Files reviewed: home_routine, travel_transport, hotel, places_city, weather_nature, hobbies_leisure, adjectives, connectors_grammar, survival_phrases (628 items).

Overall these files were in good shape: I found no wrong articles, genders, plurals, accents or conjugations. The fixes below tighten misleading notes and make some English translations more natural.

## Fixes

| File | Item | Field | Before | After | Why |
|---|---|---|---|---|---|
| places_city.json | #2 in centro | notes | "no article: in centro, not nel centro" | "no article: in centro = downtown; with a modifier use the article: nel centro storico, nel centro di Roma" | The old note was misleading: *nel centro* is correct when modified, and the deck itself uses *nel centro storico* in #3. |
| connectors_grammar.json | #33 a | notes | "...often ad before a vowel (ad Assisi)" | "...ad before a word starting with a (ad Assisi)" | Current standard usage keeps the euphonic *d* mainly before the same vowel (*ad Assisi*, not *ad Ostia*), just as with *ed* in #0. |
| adjectives.json | #14 lì / là | notes | "li and la without accents are pronouns" | "without them, li is a pronoun and la is an article or pronoun" | *la* without an accent is mostly the article. |
| survival_phrases.json | #60 Si può…? | en | "Can one…? / Is it allowed to…?" | "Can one…? / Is it OK to…?" | "Is it allowed to" is ungrammatical English. |
| weather_nature.json | #7 fa bel tempo | ex_en | "The weather's nice tomorrow: ..." | "It's going to be nice tomorrow: ..." | Italian uses the present for the future here; English needs the future. |
| weather_nature.json | #20 la neve | ex_en | "snow on the Alps" | "snow in the Alps" | Natural American English. |
| hotel.json | #11 il check-in | ex_en | "Check-in is from two o'clock." | "Check-in starts at two." | Natural American English. |

## Flags added

| File | Item | Flag |
|---|---|---|
| hotel.json | #8 il wifi | Pronunciation varies: many Italians say 'uài-fai', others 'uì-fi'. Both are heard. |
| places_city.json | #27 la torre | 'È pendente' is correct but a bit textbook. Italians more often say 'La Torre di Pisa pende' or refer to 'la Torre pendente'. |
| survival_phrases.json | #28 Che cos'è? | Regional: arancino (m.) in Catania and eastern Sicily, arancina (f.) in Palermo. Both are correct. |

## Counts

| File | Fixes | Flags |
|---|---|---|
| home_routine.json | 0 | 0 |
| travel_transport.json | 0 | 0 |
| hotel.json | 1 | 1 |
| places_city.json | 1 | 1 |
| weather_nature.json | 2 | 0 |
| hobbies_leisure.json | 0 | 0 |
| adjectives.json | 1 | 0 |
| connectors_grammar.json | 1 | 0 |
| survival_phrases.json | 1 | 1 |
| **Total** | **7** | **3** |

Note: the changed files (hotel, places_city, weather_nature, adjectives, connectors_grammar, survival_phrases) were re-serialized with indent=2. Items that used to sit on one line are now expanded across several lines. All 9 files load as valid JSON with the same number of items as before.
