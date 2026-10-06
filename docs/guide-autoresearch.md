# Guide: run a full autoresearch experiment

This lab has two research loops that share one question. A **fermentation loop**
edits one file, `protocol.json`, and is scored on one number, soluble titre. A
**binder campaign** has five plates left and has to choose which variants go on
them. A full experiment runs the lab three ways and compares what each one
finds, using only the lab's own ledgers.

| arm | what runs | what it can use |
|---|---|---|
| **control** | `npm run auto`, no model | nothing: random one- and two-knob changes, kept when they beat the best |
| **agent with memory** | na8ve agent | the lab's record, seeded into a space of its own |
| **agent without memory** | the same agent and the same brief | no space to read; it does not open `memory/` |

You need Node.js 22.19 or newer, git, and na8ve agent for the two agent arms.
The control arm needs nothing else.

## 0. Before you run anything

1. **Write your predictions down.** What do you expect each arm to find, and by
   how much? Put them in a file and commit it, or at least date it. A prediction
   written after the result is a description.
2. **Do not read `THESIS.md` yet.** It states the claims the lab was built to
   test and reports the earlier runs, answer included. Read it after you have
   registered your own.
3. **Decide the budget and keep it equal across arms.** For example: 40
   fermentation trials and the five plates the lab has left.
4. **Use one clone per run.** The lab keeps its state in the folder (`results.tsv`,
   `campaign.tsv`, `.autolab/`, `control/`), so a second run in the same clone is
   not a fresh start.

```bash
git clone https://github.com/na8ve/case-study-autolab run-1
cd run-1
npm test                 # the lab's own checks: the culture, the library, both loops, the control path
```

Everything in the lab is deterministic. The same seed gives the same culture, so
a difference between two runs is a difference in what was chosen.

## 1. Look at the lab

```bash
npm run report                       # no trials yet
npm run screen -- --plan             # what a plate holds, and what is left
npm run query -- --profile           # who meets all four limits so far, and what the rest miss
```

The binder profile has four parts at once: tight, stable, selective and makeable.
`--profile` is how you check, from measurements and never from anyone's report,
whether a variant meets them.

## 2. The control arm

The control has no model and no memory. It never opens `memory/`.

```bash
npm run auto -- --trials 40 --seed 1
npm run report
```

Run it again with other seeds, each in its own clone (`--seed 2`, `--seed 3`, and
so on). The spread across seeds is what chance alone does with this budget. An
agent has to beat that spread, not one lucky seed.

The control only plays the fermentation loop. The binder campaign has no random
counterpart here, because choosing which fifteen variants go on a plate is the
point of the exercise.

## 3. The agent with memory

**Seed the lab's record into a fresh space.**

```bash
na8ve-agent                  # then: /login (once), and /demo autolab
```

`/demo autolab` asks you to confirm, makes a space named *Case study: autolab*,
seeds the lab's record, and switches to it. Check which space is in use with
`/cortex status`. You can also add it from the **Demos** tab on the board at
na8ve.com/cortex.

**Use a space that has never held this repository's write-up or an earlier
run's facts.** A space that has is not a fair start for the arm with memory.
Make a new one for every run that has memory.

**Brief the agent.** In the same session, in the clone:

> Follow `program.md`. You have 40 fermentation trials and the five plates the
> lab has left. Ask memory before you spend anything, say which facts you are
> standing on, and put each round back in memory. Do not stop to ask whether to
> continue.

What it does, and what you will see in the folder:

- **Fermentation:** `npm run trial -- "what you changed, and why"` runs the
  protocol, keeps it if it beats the best by the lab's margin and discards it
  otherwise, and appends a row to `results.tsv`. A protocol outside the lab's
  envelope is refused and never run, and a run that breaks a guardrail is
  invalid whatever its titre.
- **Campaign:** `npm run screen -- --assay <express|binding|thermal|counter> ...`
  spends plates and appends to `campaign.tsv`. The first assay gates the rest: a
  variant that has not reached the profile's yield cannot go on another plate.
- **Memory:** every trial and every round writes facts under `memory/`. Run
  `/demo autolab` again to put them in the space; it writes only what changed.
- **Changing the running lab:** the agent may *propose* a change
  (`npm run propose`), which changes nothing. Only you can approve it, at a
  terminal (`npm run approve -- ADJ-001`). If the two loops disagree, which they
  can, that is a decision for you and the agent is told to say so.

Stop it when it has spent the same budget as the control.

## 4. The agent without memory

Same agent, same model, same brief, a fresh clone, and nothing to read from:

```bash
git clone https://github.com/na8ve/case-study-autolab run-no-memory
cd run-no-memory
NA8VE_AGENT_HOME="$(mktemp -d)" NA8VE_TOKEN= na8ve-agent
```

An empty settings folder and no token mean the agent has no account and no
space, so its memory tools cannot reach anything. Do not run `/demo autolab`. Add
one line to the brief: *do not open `memory/`*. That folder holds the lab's record
as files, and an agent that reads it has memory by another route.

## 5. Score it, and only from the ledgers

| question | where the answer is |
|---|---|
| How good was the best protocol, and how many trials did it take? | `npm run report`, and `results.tsv` (id, titre in g/L, kept, discarded or refused, guardrails broken) |
| Did the campaign find a variant meeting the whole profile, and in how many plates? | `campaign.tsv` and `npm run query -- --profile` |
| Which guardrails did it break? | the last column of `results.tsv`, summarised by `npm run report` |

**Never score a run by what the agent says it found.** `--profile` recounts it
from the measurements.

## 6. Repeat, then compare

One run of each arm is an anecdote. Run each agent arm at least three times, and
the control across several seeds, then put the results side by side with the
predictions you wrote at the start:

| arm | run | best titre (g/L) | trials used | plates used | variants meeting the profile |
|---|---|---|---|---|---|
| control | seed 1 | | | | not run |
| agent with memory | 1 | | | | |
| agent without memory | 1 | | | | |

Report predictions that failed as failures.

## 7. What this experiment cannot show

- **The lab is a model.** The numbers are generated. They are patterns of the
  kind real laboratories see, but nothing here is measured from a real strain,
  target or instrument.
- **An agent can read the lab's own source.** `program.md` tells it to read
  `lab/discovery.mjs` and `lab/harness.mjs`, and a lab's equipment describes
  itself. Decide before you start whether both agent arms may, and say so when
  you report. If they may, the arms differ in what they remember, not in what
  they can see.
- **The brief points the agent at the answer's write-up.** `program.md` also
  tells it to read `THESIS.md`, which reports the earlier runs. An agent that
  follows the brief has read it. If you want a comparison that tests memory
  alone, take that line out of the brief for both agent arms and say so.
- **A model is not a mean.** Three runs per arm is a floor, not a sample size to
  generalise from.
- **Which way to the answer is not what you are measuring.** Finding a candidate
  and knowing what a change will cost are different results, and an agent can
  have one without the other. Register which you are scoring.

## 8. Clean up

Delete the spaces you made for the runs: on the board at na8ve.com/cortex, pick
the space and choose **Delete space**. If you also ran the live lab, revoke its
ingest key; the [live daemon guide](guide-live-daemon.md) says how.
