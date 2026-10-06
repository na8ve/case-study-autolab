# Case study: a lab that remembers why its last campaign stalled (synthetic)

A small biotech lab with two jobs. It is looking for a binder against one target
that meets a four-part profile at once — tight, stable, selective, and makeable.
And it runs the fermentation that makes the protein to screen. Eight instruments
watch the culture and stream what they read, live, into your Cortex. Every plate
the lab spends streams in the same way.

The last campaign screened 160 variants and stopped. Its tightest binders melt
too low. The library built to fix that would not express at all, so it was never
assayed further. Five plates are left, and the lab's whole record — both past
campaigns, every reading, and what it knows about why things fail — is in your
memory to reason from.

Everything here is synthetic. The culture and the library are models; no real
lab, strain, target, binder, vector or instrument is described, and there are no
sequences anywhere, real or invented.

## The question

> Our binder campaign has stalled: the tightest binders melt too low, and the
> library built to fix that would not express at all. We have five plates left.
> Where should the next one go, and what has to change for it to work?

The answer is in memory, in pieces, and no single fact holds it.

## Run it

You need Node.js 22.19 or newer, and na8ve agent signed in.

```bash
git clone https://github.com/na8ve/case-study-autolab
cd case-study-autolab
npm run setup                  # optional: regenerates both campaigns and the catalogue
```

**With na8ve agent**

```bash
na8ve-agent                    # then: /login (once), and /demo autolab
```

`/demo autolab` seeds the lab's record (about 760 facts) into a space of its own, after you confirm. Then ask the question above. Run it again after any round to put what the round wrote back into memory; it writes only what changed.

## The live lab

Both halves of the lab send with one ingest key:

```bash
na8ve-agent ingest-key create autolab --alarms daemon/alarms.jsonc

node daemon/lab-daemon.mjs                      # a 30-hour culture in 30 minutes
node daemon/lab-daemon.mjs --speed 0.25 --for 120   # slow enough to decide things
node daemon/lab-daemon.mjs --dry-run            # prints the windows, sends nothing
node daemon/lab-daemon.mjs --fault cavitation   # wear the protocol did not cause
```

The culture's eight instruments send a window every 30 seconds. A screening
round sends one reading per variant per measurement, with the same key,
tagged with the variant and its library so it lands on what memory already holds
about both. The alarms ask your space what a reading means — including when a
round turns up something that meets the whole profile.

| instrument | reports |
|---|---|
| Bioreactor R-1 | pH, temperature, dissolved oxygen, agitation |
| Feed Pump FP-1 | feed rate, line pressure, pressure ripple |
| Chiller CH-1 | jacket temperature, chiller load |
| Off-gas Analyzer MS-1 | exhaust O2 and CO2, respiratory quotient |
| Liquid Handler LH-1 | dispense CV, aspirate pressure, and the expression blocks |
| HPLC H-1 | titre, acetate, retention time, column pressure |
| Plate Reader PR-1 | OD600, reporter fluorescence, and every assay plate |
| Flow Cytometer FC-1 | viability, cell density |

`--fault` is `cavitation`, `chiller`, `column` or `tips`. The scenarios in
`scenarios/` are protocols that go wrong on purpose.

## The campaign

```bash
npm run screen -- --plan                        # what a plate holds, what is left
npm run screen -- --assay express --library <L-1|L-2|L-3> --vector <pEX-01…pEX-04>
npm run screen -- --assay binding --library <library> --include ExpressionValidated --limit 15
npm run query  -- --profile                     # who meets all four, and what the rest miss
npm run query  -- --fields                      # what can be filtered, and the profile
```

A binding assay is a dose-response curve in replicate, so one plate holds
fifteen variants and the library holds 240. Choosing which fifteen is the work.

`tools/query.mjs` lists exact sets from what the lab has measured — *"the ones
that bind under 5 nM and have not been through the melt yet"* is one filter. It
is how you get a precise list once you know what you are after; memory is where
you work out what to be after.

## The fermentation

```bash
npm run trial -- "what you changed, and why"    # run it, keep or discard, log it
npm run report
npm run auto -- --trials 40 --seed 1            # a control: no model, no memory
```

One editable file, `protocol.json`; a read-only harness; a fixed budget and one
number. The two loops can want different things — the induction that rescues a
difficult construct makes less protein overall — and that is the point.

## Changing the running lab

Start it slow (`--speed 0.25`), then:

```bash
npm run propose -- --set <knob>=<value> --because "why, citing a fact" --cite "<concept>"
npm run approve -- ADJ-001       # a person, at a terminal, reads a forecast and types "approve"
npm run outcome -- ADJ-001       # later: what the readings did, recorded as facts
npm run screen  -- --assay express --library <library> --using live
```

A proposal changes nothing. The controller applies a change only if a person
approved it, the approval's signature verifies, and it is still within bounds.
See [`.agents/skills/lab-control/SKILL.md`](.agents/skills/lab-control/SKILL.md).

## Guides

- [Run a full autoresearch experiment](docs/guide-autoresearch.md): the control arm, the agent with memory and the agent without, and how to score them.
- [Use the live stream daemon](docs/guide-live-daemon.md): make an ingest key, stream the culture, read an alarm's answer, change the running lab.

## What is where

| | |
|---|---|
| `protocol.json` | the one file the fermentation loop edits |
| `lab/` | the culture, the library, the instruments, the rules, the catalogue, the control path and the one way the lab sends a reading. Read-only to the loops |
| `tools/` | `screen`, `query`, `trial`, `experiment`, `auto`, `report`, `propose`, `approve`, `outcome`, `campaign` |
| `daemon/` | the live culture, and its alarms |
| `discovery/catalogue.json` | what the lab has measured, as columns |
| `memory/` | the lab's record: mechanisms, both campaigns, and every round since |
| `program.md`, `THESIS.md` | the agent's brief, and what is being tested |
| `.agents/skills/` | `binder-campaign`, `research-loop`, `lab-control` |

```bash
npm test     # the culture, the library, the catalogue, both loops and the control path
```

## What is seeded, and what is not

Seeding puts the lab's **record** in your memory. This repository's own files stay out: the README, the licence, the thesis, the guides, and `docs/whitepaper.md`, which reports what the case study found and would hand you the answer before you start.

If you want one of them in memory anyway, ask na8ve agent to remember it.

Licensed under Apache-2.0.
