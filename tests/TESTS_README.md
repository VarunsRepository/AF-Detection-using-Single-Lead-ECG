# The check files — what they are and how to run them

Nine files. None of them ship; none are served. They all live in one
directory and run directly, the way `test_journey_store.py` does.

## Where they go

```
Python_Site/
  tests/
    _paths.js                     locates component files
    _recipe_loader.py             loads a recipe with catalog stubbed
    _dump_recipe.py               recipe -> JSON, for the node checks

    oracle_ble_txpath.py          independent derivation
    oracle_ble_connect.py         independent derivation

    _check_against_oracle.js      ble_txpath DSPEs vs its oracle
    _check_connect_oracle.js      ble_connect DSPE vs its oracle
    _check_copy.js                ble_txpath prose vs computed values
    _check_connect_copy.js        ble_connect prose vs computed values
    check_glossary.py             the glossary's own rule
    _smoke_renderers.js           every renderer, every stage
    _check_against_capture.js     journey vs a real sniffer capture
```

`_paths.js` walks up from itself looking for `static/shorts`, so the
checks run from anywhere — the repo root, this directory, an editor's run
button. They also still work with every file in one folder, which is how
they were drafted.

## How to run them

```bash
cd Python_Site

# the two oracles print their own tables
python3 tests/oracle_ble_txpath.py
python3 tests/oracle_ble_connect.py

# the prose checks need the recipe as JSON first
python3 tests/_dump_recipe.py ble_txpath  > tests/_recipe.json
python3 tests/_dump_recipe.py ble_connect > tests/_connect_recipe.json

python3 tests/check_glossary.py
node tests/_check_connect_oracle.js
node tests/_check_connect_copy.js
node tests/_check_against_oracle.js
node tests/_check_copy.js
node tests/_smoke_renderers.js
```

The glossary check is Python because the glossary itself is Python --
it lives in `catalog/glossaries/wireless.py`, which is domain content,
not engine code.

Every one exits 0 on success and non-zero on failure, so `&&` them
together or put them in a git hook. All six currently pass.

The capture check needs an input and is the only one that does:

```bash
node tests/_check_against_capture.js ~/Downloads/ble-capture.json
```

See its header for how to produce that file. It fails loudly if it parses
nothing, rather than reporting a clean run on zero matches.

## The three kinds

**Oracles** (`oracle_*.py`) derive every number a journey claims from
Bluetooth Core specification field widths, sharing no code with the
JavaScript. They are the ground truth the backlog's third filter demands.
Run one on its own and it prints a table you can read.

**Checks** (`_check_*.js`) run the real components and compare. Three
things they look at:

- *numbers*: does the DSPE compute what the oracle says
- *prose*: does the recipe's description quote the numbers the code
  actually produces
- *pixels*: does every renderer survive every stage without throwing, and
  draw something

The third is deliberately weak. Your master document is explicit that
"does this look right" has no oracle, so the smoke check only proves a
renderer ran and drew — a human still has to look.

**Plumbing** (`_paths.js`, `_recipe_loader.py`, `_dump_recipe.py`) exists
so the other files work regardless of where they sit.

## Why they exist

Because they caught six real bugs in these two journeys that would
otherwise have shipped:

| What | Found by |
|---|---|
| Stage 7 of `ble_txpath` was missing `batchCount=10`, so it was a pixel-identical duplicate of stage 6 while its prose claimed 41 bytes and a 5.6× saving | `_check_copy.js` |
| A 7.5 ms duty cycle quoted as 6% when it is 11.9% — the 15 ms row carried across by mistake | `_check_copy.js` |
| Two live definitions of "TX as a fraction of elapsed", so the card and the text would have disagreed on screen | `_check_copy.js` |
| `oracle_ble_txpath.py` wrapped ATT and L2CAP headers round an *empty* PDU, inflating the receive window by 56 µs. The animation was right and the reference was wrong | `_check_against_oracle.js` |
| `ATT_ERROR_RSP` drawn with no request in front of it — a client never receives an error unprompted | reading the oracle's own output |
| One journey-wide `unverified` list attached to all six stages, demanding that four of them disclose a limitation that is not theirs | `_check_connect_copy.js` |

Two of those are the exact failure your master document records from the
ITSM journey — a number stated in recipe prose that was estimated rather
than computed. Recipe copy is the easiest place in this codebase for a
wrong number to hide, because nothing else reads it.

## The one policy check worth keeping

`_check_connect_copy.js` enforces two rules nothing else does:

- a stage whose oracle lists something it **cannot** verify must admit it
  in its own description
- a stage whose gaps span more than an order of magnitude must say "not
  to scale"

Both come straight from the backlog's rule that a journey with no oracle
for a claim says so. They are the checks that stop an animation implying
certainty the arithmetic does not have.
