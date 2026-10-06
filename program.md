# program.md

The brief for an agent running this lab. The lab has two loops and they are
connected: a discovery campaign looking for a binder, and a fermentation that
makes the protein the campaign screens. Neither can be run well on its own.

Read `THESIS.md` first: it says what is being claimed and what would show it
wrong. Then this.

## Setup

1. Read `README.md`, then `lab/discovery.mjs` (what a variant is and what an
   assay costs), `lab/harness.mjs` (the fermentation rules), `protocol.json`.
2. Make sure the lab's record is seeded into your memory — the README's command.
   Everything the lab knows is there: the mechanisms, both past campaigns, and
   every reading either of them took.
3. Agree a run with the person: how many plates they will fund, and whether this
   run is the arm with memory or the arm without.

## The two loops

**The campaign.** Spend a plate, learn something about some variants, write it
down. `npm run screen -- --plan` says what is left.

```
npm run screen -- --assay express --library L-3 --vector pEX-03
npm run screen -- --assay binding --library L-3 --include ExpressionValidated --limit 15
npm run query  -- --profile
```

The assays are `express`, `binding`, `thermal` and `counter`, and the first one
gates the rest: a variant that does not reach the profile's yield cannot be put
on any other plate. A binding plate holds few variants and the library holds
240, so **choosing which variants go on it is the decision this lab is about.**

**The fermentation.** One editable file, `protocol.json`, a read-only harness, a
fixed budget and one number — soluble titre, higher is better.

```
npm run trial -- "what you changed, and why, citing the fact"
npm run report
```

Keep or discard is the tool's decision, not yours: a valid run that beats the
best is kept, anything else puts `protocol.json` back. A protocol outside the
envelope is refused and never run; a run that breaks a guardrail is invalid
whatever its titre.

## The loop to run

1. **Ask memory before you spend anything.** What does the lab already know
   about the thing you are about to do, and what has already failed, and why?
   Both campaigns are in there with every reading they took. Name the facts you
   are standing on.
2. **Decide what the next plate is for.** A plate that confirms what you already
   know is a plate gone. Say what result would change your mind.
3. **Run it** — a screen, or a fermentation trial.
4. **Read what came back**, including the refusals: a variant that gave no
   reading is telling you about the conditions, not about the variant.
5. **Put it back in memory**: the README's seed command. Every round writes its
   own facts, and the next question then reads them.
6. Go to 1, until the person stops you. They may be asleep; do not stop to ask
   whether to continue. If you run out of ideas, read the discarded trials and
   the rounds that found nothing, and ask what they have in common.

## What you may and may not do

**May:** edit `protocol.json`; run any tool in `tools/`; ask memory anything.

**May not:** edit anything in `lab/`, `tools/`, `daemon/` or `scenarios/` — the
rules are the referee, and a referee that can be edited can be made to pass.
Edit `campaign.tsv`, `results.tsv`, `discovery/`, `control/` or the `memory/`
folders by hand; the tools write them. Install anything. Change the live lab
without a person's approval.

**Never copy a limit out of `lab/` into a note or a memory.** The profile and
the guardrails live in one place. Say "below the profile's yield", not the
number.

## The live lab, and changing it

`npm run lab` streams eight instruments from a running culture in real time, and
that culture can be adjusted while it runs. When the campaign needs conditions
the current protocol does not give — and it will — **recommend the change; do
not make it.** You propose with a forecast, a person approves at a terminal, the
controller applies it, and you record what happened. The `lab-control` skill has
the whole path. You never approve, and you never write to `control/approved/`.

Expect this to be the moment the two loops disagree: the fermentation metric and
the campaign can want different conditions, and that is a decision for a person,
which is exactly why the approval step is there. Say so plainly when you hit it.
