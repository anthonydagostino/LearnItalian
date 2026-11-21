# Deck review 1

Scope: greetings, numbers_time, people_family, feelings_opinions, food_drink, shopping_money, health_pharmacy, core_verbs, work_tech (758 items).

Checked every item for articles/gender, plurals, spelling, accents, apostrophes, conjugations, auxiliaries and past participles in notes, naturalness, English translations, register labels, and whether each example contains its item. Overall quality is high: I found no errors in Italian grammar, accents, articles or conjugations. The only fixes are in the English translations.

Formatting was preserved exactly. Expanded files keep 2-space indentation. Compact one-item-per-line files keep their layout, including the blank line between words and phrases. All 9 files were re-validated with `json.load`.

## Fixes (4)

| File | Item | Field | Before → After | Why |
|---|---|---|---|---|
| numbers_time.json | `zero` | ex_en | "It's zero degrees today." → "It's zero degrees (Celsius) today." | To an American, "zero degrees" means 0 °F. |
| feelings_opinions.json | `Penso di sì.` | ex_en | "Is it raining tomorrow? — I think so." → "Is it going to rain tomorrow? — I think so." | The original is unnatural English for a future forecast. |
| food_drink.json | `Siamo in…` | ex_en | "How many are you? — …" → "How many of you are there? — …" | "How many are you?" is a calque; the fix is natural American English. |
| health_pharmacy.json | `la gola` | ex_en | "My throat is irritated." → "My throat feels scratchy." | The original is unidiomatic English for "Ho la gola irritata". |

## Flags added (3)

| File | Item | Flag |
|---|---|---|
| greetings.json | `buongiorno` | When people switch to buonasera varies by region; in much of central/southern Italy it starts right after lunch (~1-2 p.m.). |
| numbers_time.json | `il fine settimana` | "Cosa fai il fine settimana?" can also mean "What do you do on weekends?"; "questo fine settimana" is unambiguous for this weekend. |
| food_drink.json | `il latte` | "Un tè con latte" is understood, but "un tè al latte" or "un tè con il latte" is more idiomatic; check which you prefer. |

## Per-file counts

| File | Fixes | Flags |
|---|---|---|
| greetings.json | 0 | 1 |
| numbers_time.json | 1 | 1 |
| people_family.json | 0 | 0 |
| feelings_opinions.json | 1 | 0 |
| food_drink.json | 1 | 1 |
| shopping_money.json | 0 | 0 |
| health_pharmacy.json | 1 | 0 |
| core_verbs.json | 0 | 0 |
| work_tech.json | 0 | 0 |
