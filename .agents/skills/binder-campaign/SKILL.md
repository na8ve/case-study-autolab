---
name: binder-campaign
description: "Use when asked which variants to screen next, why the campaign stalled, what a reading means, or to run an assay: how to ask memory first, how to turn a question into a catalogue filter, what each assay costs, and what every vector does to a reading."
---

# Choosing the next plate

Five plates is not many and the library is 240 variants. Everything the lab
knows is in memory, so the order is always: ask, decide, spend, record.

## 1. Ask memory first

The lab's record holds the mechanisms, both past campaigns, and every reading
either took. Before any plate, get the answer to these from memory, not from a
file:

- **Why did the campaign stall?** Ask what the last rounds found about each
  library, and what the readings have in common.
- **What does this library carry?** Each one is defined by what was changed in
  it, and what that change costs is a fact.
- **What have we already measured on this variant?** A plate that re-measures
  something is gone.
- **What does the vector do to the reading?** One of them leaves a tag on, and a
  tagged construct reads weaker than the binder is. A borderline binder is
  confirmed in the vector that cleaves it.

## 2. Then turn the question into a filter

`tools/query.mjs` lists exact sets from the lab's own readings. It is how you
get a precise list once you know what you are looking for — not where you learn
what to look for.

```
node tools/query.mjs --include ProteinVariant --where "kd_nm<5" --exclude ThermalScreened
node tools/query.mjs --include ProteinVariant,LowYield --where "library=L-3"
node tools/query.mjs --record V-332
node tools/query.mjs --profile          # who meets all four, and what the rest are missing
node tools/query.mjs --fields           # what can be filtered on, and the profile itself
```

`--include` is what a variant must have, `--exclude` what it must not, `--where`
a test on a reading, `--since` a date. A label like `ThermalScreened` means the
melt has been run; excluding it is how you find what has not.

## 3. Spend the plate

```
node tools/screen.mjs --plan
node tools/screen.mjs --assay express --library L-3 --vector pEX-03
node tools/screen.mjs --assay binding --library L-3 --include ExpressionValidated --limit 15
```

- **Expression gates everything.** A variant below the profile's yield cannot be
  assayed at all. If a whole library comes back low, that is about the
  conditions, not the variants.
- **A binding plate is the expensive one** — a dose-response curve in replicate.
  Thermal and expression are cheap. Order the work so the expensive plate is
  spent on variants you already have reason to believe in.
- **`--using live`** runs expression at the conditions of the culture that is
  running now, including anything a person has approved on it.

## 4. Record it, and say what it changed

Every round writes its own facts. Seed them (the README's command) and say, in
one line, whether the result was what you expected and what you will do next.

## Rules

- Ask memory before spending a plate; cite what you stood on.
- Never copy a limit out of `lab/` into a note. Say "above the profile's melting
  temperature", not the number.
- A variant that gave no reading is a result. Record what refused it and why.
- Do not re-measure something the record already holds.
- Do not edit `lab/`, `tools/`, `discovery/` or the `memory/` folders by hand.
