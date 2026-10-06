# Autolab: a lab that keeps the reasons behind its results

*A case study in using a memory service to run a synthetic biotech laboratory.
Everything here is synthetic. No real lab, strain, target, binder, vector,
instrument or product is described, and the repository contains no sequences.*

## Summary

Autolab is a simulated laboratory with two connected halves: a fermentation
that produces a protein, and a discovery campaign that screens engineered
binders for that protein. Eight instruments stream live readings from the
fermentation. Every screening round streams its readings the same way. The lab's own record, its earlier campaigns and every reading they
produced, is seeded into a memory service so that an agent can reason from it.

The case is a campaign that has stalled, and the question is where the next
plate should go. Answering it means connecting facts that no single reading
shows. This whitepaper reports what the lab found, what was measured, what was
not, and how the memory service was used.

## The question

> Our binder campaign has stalled: the tightest binders melt too low, and the
> library built to fix that would not express at all. We have five plates left.
> Where should the next one go, and what has to change for it to work?

## The lab

**The fermentation** is one fed-batch culture with eight instruments: a
bioreactor, a feed pump, a chiller, an off-gas analyser, a liquid handler, an
HPLC, a plate reader and a flow cytometer. The instruments share one simulated
process, so a fault in one shows up in the others: a cavitating pump produces
pressure ripple, glucose pulses, overflow acid, a rising respiratory quotient,
and acetate a sample later. Cause reaches the stream before effect.

**The campaign** screens 240 variants in three libraries against one target and
one close relative. A variant must meet a four-part profile at once: tight
binding, a melting temperature above a floor, selectivity over the relative, and
a soluble yield above a floor. The four limits are set in one file and nowhere
else. A melt reads in three wells, so a whole library fits on one plate. A
binding measurement is a dose-response curve in replicate, so one plate holds
fifteen variants. Choosing which fifteen is the work.

## Findings

### 1. The fermentation: a protocol that a bulk-titre loop could not reach

The starting protocol makes 2.36 g/L of soluble protein under the lab's
guardrails. An earlier campaign of twenty trials changed one idea at a time.
Its record explains each failure: a faster feed overflowed into acetate, more
oxygen alone did nothing, a stronger inducer killed the culture.

A search over the same harness with 20,000 trials, from three starts, reached
6.64, 6.73 and 6.90 g/L with every guardrail held. The best protocol moves
many knobs at once. Moving two of them together for a stated reason is how the
lab's memory says the next gain is reached. A blind search with no model and no
memory, forty trials from five seeds, averaged 2.55 g/L, a gain of about 8%.

### 2. The campaign: no variant meets the profile under the old conditions

The second campaign screened seven rounds: the parent library, the matured
library, and the repaired library, on expression and binding and melting. It
found no variant meeting the whole profile.

Under the standard vector and induction, no variant of any library meets the
profile. Under two changes, a fusion vector or a colder, gentler induction,
the repaired library expresses: 75 of its 80 variants in the fusion vector and
69 under the colder induction clear the yield floor. Twenty-two variants in
total meet the whole profile once expression is accounted for.

### 3. The connection: the rescue is a trade the fermentation loop would reject

The induction that rescues the repaired library lowers bulk titre from 2.36 to
1.56 g/L, far below the loop's keep rule. A lab run by the bulk metric alone
would never find the candidate. A lab run by the campaign alone would quietly
give up a third of its output. The change therefore has to go through a person:
the agent recommends it with a forecast, a person approves it at a terminal, and
the lab applies it only if the approval is signed and the change is in bounds.

### 4. The plate budget: a candidate is reachable in the remaining plates

Five plates remained. Four of them, spent on express, bind, melt and counter-
screen for the repaired library in the fusion vector, produced six variants that
meet the whole profile, with one plate to spare.

### 5. Control path: the forecast was right, and a forgery was refused

In an end-to-end run, a stream was running, a proposal was made at hour nine, a
person-equivalent approval was signed, and the change was applied at hour ten.
The forecast made at approval was within 0.15 g/L of where the culture finished.
A forged approval placed beside the real one was refused and logged. An
approval attempted with no terminal was refused with exit code 3.

## Predictions, registered before the runs

| | prediction | result |
|---|---|---|
| P1 | a variant meets the whole profile | held: 22 of 240 |
| P2 | none meets it under the last campaign's conditions | held: 0 of 240 |
| P3 | the fusion vector, or a colder induction, brings at least 50 of the repaired library's 80 above the yield floor | held: 75 and 69 |
| P4 | four of the five remaining plates produce a candidate | held: six candidates, one plate spare |
| P5 | the rescuing induction is one the fermentation loop would discard | held: 2.36 to 1.56 g/L |
| P6 | an agent with memory finds a candidate inside the budget in at least two of three runs; without memory, in at most one | **failed**: three of three in both arms |

Two predictions failed.

The fermentation control arm was predicted to average 3.0 to 3.8 g/L and
averaged 2.55. The estimate came from an exploratory run on a different starting
protocol.

**P6 failed, and it is the one the lab was built for.** Six runs, three per arm,
the same model and brief, five plates each. Every run found candidates, and
every run used four plates. The arm with memory found 9, 9 and 3 qualifying
variants; the arm without found 4, 15 and 6.

### 6. Why the comparison did not discriminate

The reason is in the lab, not the agents. **A lab's mechanism is legible from
its own equipment.** The read-only source that defines the library is not
opaque: it states what the library was built to do, and each vector's entry says
what that vector is for — a screening tool has to say what a vector does. Two of
the three runs without memory reported reading it, and that it decided their
first plate.

The arm with memory had a second route as well. Its space held a passage of the
thesis, and one run quoted that passage rather than assembling the answer from
the facts.

So both arms could read the answer as prose. They differed only in where they
read it, which is not the question.

**One difference did appear, and it was not predicted.** Two of the three runs
without memory changed the induction to a colder, gentler setting on judgement,
without running a fermentation trial — the change that costs about a third of
the bulk titre. Neither knew the cost, because the cost is in the record they
did not have. Both runs said in their own words that they had made a single
untested bet. The runs with memory left the protocol alone. On *"did you find a
candidate"* the arms tie. On *"did you know what your change would cost"* they
do not. That is a sharper claim than the one registered, and it has not been
measured.

## How the memory service was used

The lab's record was seeded into a Cortex space as typed facts. It holds about
760 facts: knowledge, covering the mechanisms, the libraries, the vectors, the
assays and the profile, and history, from two replayed campaigns and every
round since.

Four properties of the record mattered:

- **Facts are typed**, so a symptom is joined to its cause and its cause to its
  fix. *Position-7 substitution causes aggregation; aggregation is remedied by a
  cold shift or by the fusion vector.*
- **Every measured variant has its own fact.** A round writes one fact per
  variant it touched, not only the notable ones. Nothing measured exists only in
  a file on the user's machine.
- **Readings join the record as they arrive.** A plate's reading is tagged with
  the variant, its library and the round, so it lands next to what is already
  known about all three.
- **Alarms ask the space what a reading means.** A round that turns up a
  candidate fires an alarm whose question asks what should be confirmed before
  believing it.

The discovery tools do not use the memory service to decide anything. Their
filters and forecasts are deterministic and run on the lab's own readings. The
memory is what an agent reads before it chooses. That separation is deliberate:
the tools answer exactly what was asked, and the reasoning is left to the agent,
which can be checked.

## What was measured

| check | result |
|---|---|
| the lab's own checks | 18 of 18 |


## What this cannot show

- **P6 was run and did not discriminate**, for the reason in section 6. The lab
  shows that its record is sufficient to find a candidate. It has not shown that
  an agent using the record finds one faster than an agent reading the lab's
  source, because both arms could reach the answer as prose. A valid re-run needs
  a lab whose mechanism is not readable from its source, and a space with no
  write-up in it.
- **The library and the culture are models.** The trade-off between binding and
  stability, the cost of a repair in aggregation, and the way a gentle induction
  rescues a difficult construct are real patterns. The numbers are generated and
  were tuned until each lesson existed.
- **The answer is reachable two ways**, so a run that finds it has not shown
  which route a real laboratory should prefer. The lab has no cost model that
  would say.
- **An assay here is one draw with noise on it.** A real campaign repeats, and
  it disagrees with itself more than this one does.
- **The approval gate is not a security boundary.** An agent that can read the
  approval key, or run its own script, can approve. The agent's policy must
  confirm the approve command, and that was not configured or tested here.

## How a valid re-run would be set up

1. Make the latent model unreadable to both arms: the mechanism must exist only
   in the record, not in a comment or a vector note an arm can open.
2. Start from a space that has never held a write-up; the space these runs used
   held a passage of the thesis.
3. Register the sharper prediction as well: that the arm without the record makes
   equipment changes whose cost it cannot state.
4. Score by the campaign ledger and the profile query, never by the agent's own
   account of what it did.

## Reproducing this

It runs on Node.js 22 with no dependencies. `npm run setup` regenerates both campaigns and
the catalogue; `npm test` runs the lab's checks; the README has the commands for
the stream, the campaign, the fermentation loop and the approval path.
