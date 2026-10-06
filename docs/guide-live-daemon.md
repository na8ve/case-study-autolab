# Guide: use the live stream daemon

`daemon/lab-daemon.mjs` runs the lab's fermentation as if it were happening now
and streams it into your space. Eight instruments report, six alarms watch, and
each alarm that fires asks your space what the reading means. You watch it
arrive, read the answers, and, if you want, change the running culture.

You need Node.js 22.19 or newer and na8ve agent signed in. The daemon itself has
no dependencies.

## 1. Put the lab's record in a space

The alarms ask the space what a reading means, so the space has to hold the lab's
record first.

```bash
git clone https://github.com/na8ve/case-study-autolab
cd case-study-autolab
na8ve-agent                  # then: /login (once), and /demo autolab
```

`/demo autolab` seeds the record into a space named *Case study: autolab* and
switches to it. `/cortex status` shows the space in use, and `/cortex space` lets
you choose another from a list.

## 2. Make an ingest key

An ingest key lets a machine write readings into **one** space and nothing else.

```bash
na8ve-agent ingest-key create autolab --alarms daemon/alarms.jsonc
```

- The key belongs to the space in use when you make it. Pass `--space <ref>` to
  name another.
- `--alarms daemon/alarms.jsonc` registers this lab's six alarms with the key:
  respiratory quotient above its limit, dissolved oxygen too low, acetate
  climbing, pump pressure ripple, chiller load, and a screening round that finds
  a variant meeting the whole profile. They are data, in a file you can read and
  edit.
- The key is **not shown**. It is saved to `~/.na8ve/ingest/autolab.key`, outside
  the repository and readable only by you. The daemon reads it from there, or from
  `NA8VE_INGEST_KEY`.
- A key is never reused: if the file exists, the command stops and tells you to
  revoke it or choose another name.

```bash
na8ve-agent ingest-key list              # the keys this space has, and when each was last used
na8ve-agent ingest-key revoke autolab    # its next reading is refused
```

## 3. Look before you send

```bash
node daemon/lab-daemon.mjs --dry-run --windows 5
```

`--dry-run` prints the windows it would send and sends nothing, so it needs no
key. Each window is one summary (mean, minimum, maximum, last) of every online
instrument, plus a result from each sampling-line instrument whose sample came
due.

## 4. Stream

```bash
node daemon/lab-daemon.mjs
```

By default the 30-hour culture plays out in 30 minutes, with one batch every
30 seconds, and the daemon then stops by itself. Press Ctrl+C to stop sooner.

| option | what it does |
|---|---|
| `--for <minutes>` | how long the run lasts at the console (default 30) |
| `--speed <hours per minute>` | the pace of the culture. `--speed 0.25` is four minutes an hour |
| `--window <seconds>` | the time between batches (default 30) |
| `--fault cavitation\|chiller\|column\|tips` | wear the protocol did not cause: a pump that cavitates, a chiller that has lost capacity, a fouling column, worn tips |
| `--protocol <file>` | run a protocol other than `protocol.json` |
| `--once` | send one window and stop |
| `--key-name <name>` | use a key made under another name |
| `--url <address>` | send somewhere other than na8ve.com |

A slow pace leaves time to decide things: `node daemon/lab-daemon.mjs --speed 0.25 --for 120`.

## 5. Watch it, and read an alarm

- **On the board.** Open your space at na8ve.com/cortex. The **Live** view of the
  Cortex card shows what is being written to the space as it arrives, and the
  trace records each signal as it comes. Choose the space *Case study: autolab* first.
- **In the daemon's terminal.** When an alarm fires, the daemon prints its
  question and what the space answered:

  ```
  ALARM critical: Dissolved oxygen in Bioreactor R-1 fell to <value> % at <time> ...
    Cortex:
      ...
    (kept in the space as memory ...)
  ```

  The answer is kept in the space too, so you can ask about it afterwards.

Try a fault to see an alarm fire on purpose:

```bash
node daemon/lab-daemon.mjs --fault cavitation --speed 0.25 --for 60
```

## 6. Change the running lab

The daemon is also the lab's controller. A change reaches the running culture only
if a person approved it, the approval's signature verifies, and it is still inside
the lab's bounds.

```bash
npm run propose -- --set <knob>=<value> --because "why, citing a fact" --cite "<concept>"
npm run approve -- ADJ-001     # you, at a terminal: it reads a forecast, and you type "approve"
npm run outcome -- ADJ-001     # later: what the readings did, recorded as facts
```

A proposal changes nothing. Run the daemon slowly (`--speed 0.25`) so there is
time to read the forecast before the culture has moved on. What the daemon applied
is kept in `control/applied/`, and what it refused, and why, in `control/refused/`.
An approval attempted without a terminal is refused.

A screening round can use the culture as it is now:

```bash
npm run screen -- --assay express --library <library> --using live
```

## 7. When nothing arrives

| what you see | what it means |
|---|---|
| `No ingest key. Run: na8ve-agent ingest-key create ...` | there is no key file for that name; make one (step 2) or pass `--key-name` |
| `the key was refused; stopping` | the key was revoked, or belongs to a space that was deleted; revoke it, make a new one |
| the daemon runs but the board shows nothing | the board is watching another space: choose the one the key was made in |
| no alarm fires | an alarm waits out its cooldown between firings; try `--fault` |

## 8. Clean up

```bash
na8ve-agent ingest-key revoke autolab
```

Revoking the key ends what the daemon can write. Delete the space on the board if
you are done with it. The key file is removed with the revoke.
