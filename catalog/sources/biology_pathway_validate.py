# ---------------------------------------------------------------------------
# catalog/sources/biology_pathway_validate.py
#
# The server-side gate for pathway models.
#
# WHY THIS EXISTS AT ALL
#
#   The builder already checks a model -- walk, unreached reactions, atom
#   balance -- but it does that in the BROWSER, in pathway_filter.js. That
#   is advice to an author, not enforcement. A POST does not have to come
#   from our page, so the moment /save exists, every check that only lives
#   in JS is a check an attacker (or a curl typo) walks straight past.
#
#   So this is the same walk, written again, on the side where the data
#   lands.
#
# WHAT IT DELIBERATELY DOES NOT DO
#
#   It does not reproduce pathway_filter.js's full output -- no tape, no
#   junctions, no cofactor ledger. Two implementations of a rich output
#   WILL drift, and a gate that drifts rejects good models. It checks only
#   things that are unambiguous and that make a card blank when wrong:
#
#     - the model is shaped like a model
#     - ids are unique                   <- the builder can mint duplicates
#     - every species named is declared
#     - `when` parses under the real grammar, including no parentheses
#     - the walk leaves the start
#     - every reaction is reached under SOME declared condition
#     - atoms balance wherever formulas exist
#
#   Anything subtler stays advisory and comes back as a warning.
#
# KEEPING IT IN STEP
#
#   This file and pathway_filter.js implement the same four rules:
#
#     index   species -> reactions that consume it
#     walk    follow shared names from `start`
#     cycle   the walk returned to where it began
#     fire    a reaction runs only if its reactants are present
#
#   If you change the walk in one, change it here. A disagreement shows up
#   as "saved fine, renders blank" -- the worst failure this gate exists to
#   prevent.
# ---------------------------------------------------------------------------

from __future__ import annotations

import itertools
import re

# Guards use the same grammar as evalWhen in pathway_filter.js: comparisons
# joined by && and ||, nothing else. NO PARENTHESES -- "a && (b || c)"
# splits wrongly, which is the `||` bug from session 8. A parser that fails
# to parse is safe; one that parses wrongly and stays quiet is not, so a
# paren is a hard error here rather than something we try to cope with.
_COMPARISON = re.compile(
    r"^\s*([A-Za-z_][\w.]*)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$")

_MAX_COMBOS = 64        # beyond this, vary one variable at a time


# ── helpers ──────────────────────────────────────────────────────────────

def _coerce(raw: str):
    """'yeast' -> str, 0 -> int. Quoted stays a string, bare numbers don't."""
    txt = raw.strip()
    if len(txt) >= 2 and txt[0] in "'\"" and txt[-1] == txt[0]:
        return txt[1:-1]
    try:
        return int(txt)
    except ValueError:
        pass
    try:
        return float(txt)
    except ValueError:
        return txt


def parse_when(expr: str) -> tuple[list[tuple[str, str, object]], str | None]:
    """
    Split a guard into comparisons. Returns (terms, error). `terms` carries
    every comparison regardless of && / ||, which is enough for the only
    question validation asks of a guard: which variables does it name, and
    are its values among those declared.
    """
    if "(" in expr or ")" in expr:
        return [], ("parentheses are not supported in `when` "
                    "(the parser splits on && and || only)")
    terms = []
    for part in re.split(r"&&|\|\|", expr):
        if not part.strip():
            return [], "empty term in `when`"
        m = _COMPARISON.match(part)
        if not m:
            return [], f'cannot parse condition "{part.strip()}"'
        terms.append((m.group(1), m.group(2), _coerce(m.group(3))))
    return terms, None


def eval_when(expr: str, conditions: dict) -> bool:
    """
    Evaluate a guard. Left to right, no precedence between && and || --
    same as the JS. Anything unparseable is False: a guard we cannot read
    must not fire.
    """
    if not expr:
        return True
    if "(" in expr or ")" in expr:
        return False
    tokens = re.split(r"(&&|\|\|)", expr)
    result = None
    op = None
    for tok in tokens:
        tok = tok.strip()
        if tok in ("&&", "||"):
            op = tok
            continue
        m = _COMPARISON.match(tok)
        if not m:
            return False
        key, cmp_op, want = m.group(1), m.group(2), _coerce(m.group(3))
        have = conditions.get(key)
        try:
            if   cmp_op == "==": val = have == want
            elif cmp_op == "!=": val = have != want
            elif cmp_op == ">":  val = have >  want
            elif cmp_op == "<":  val = have <  want
            elif cmp_op == ">=": val = have >= want
            else:                val = have <= want
        except TypeError:
            # Comparing a string to a number is an authoring mistake, not
            # a crash. The guard simply does not fire.
            val = False
        if result is None:   result = val
        elif op == "&&":     result = result and val
        else:                result = result or val
    return bool(result)


# ── the walk ─────────────────────────────────────────────────────────────

def walk(model: dict, conditions: dict | None = None,
         blocked: str | None = None) -> dict:
    """
    Follow shared species names from `start`. A reaction fires only when
    its guard passes and every non-boundary reactant is in hand -- which is
    where blocking, upstream stall and downstream starvation come from,
    with no code about poisons anywhere.
    """
    conditions = conditions or {}
    species   = model.get("species") or {}
    reactions = model.get("reactions") or []
    start     = model.get("start")

    boundary = {sid for sid, sp in species.items()
                if isinstance(sp, dict) and sp.get("boundary")}

    held: set[str] = {start} if start else set()
    used: set[str] = set()
    steps: list[str] = []
    cursor = start
    cyclic = False

    while cursor:
        chosen = None
        for rxn in reactions:
            rid = rxn.get("id")
            if rid in used or rid == blocked:
                continue
            reactants = rxn.get("reactants") or {}
            if cursor not in reactants:
                continue
            if not eval_when(rxn.get("when") or "", conditions):
                continue
            # Every tracked reactant must be in hand. Boundary species are
            # pools the model does not track -- water, NAD+, CoA -- so they
            # are always available and never gate a step.
            if any(sid not in held and sid not in boundary for sid in reactants):
                continue
            chosen = rxn
            break
        if chosen is None:
            break

        used.add(chosen["id"])
        steps.append(chosen["id"])
        products = chosen.get("products") or {}
        held |= set(products)

        nxt = next((sid for sid in products if sid not in boundary), None)
        if nxt is None:
            break
        if nxt == start:
            cyclic = True
            break
        cursor = nxt

    return {"steps": steps, "cyclic": cyclic, "reached": used}


def _condition_sets(model: dict) -> list[dict]:
    """
    Every assignment of declared conditions worth trying. A branch exists
    precisely so that different settings take different arms, so checking
    only the defaults would call every guarded reaction unreachable.

    Full cartesian while it is small; past that, vary one variable at a
    time against the defaults, which still covers each arm of each branch.
    """
    declared = model.get("conditions") or {}
    if not declared:
        return [{}]

    defaults = {k: spec.get("default") for k, spec in declared.items()}
    keys     = list(declared)
    values   = [list(declared[k].get("values") or [defaults[k]]) for k in keys]

    total = 1
    for v in values:
        total *= max(1, len(v))

    if total <= _MAX_COMBOS:
        return [dict(zip(keys, combo)) for combo in itertools.product(*values)]

    out = [dict(defaults)]
    for k, vals in zip(keys, values):
        for v in vals:
            trial = dict(defaults)
            trial[k] = v
            if trial not in out:
                out.append(trial)
    return out


# ── atom balance ─────────────────────────────────────────────────────────

_FORMULA = re.compile(r"([A-Z][a-z]?)(\d*)")


def _atoms(formula: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for el, num in _FORMULA.findall(formula or ""):
        counts[el] = counts.get(el, 0) + (int(num) if num else 1)
    return counts


def _balance(model: dict) -> tuple[int, int, list[str]]:
    """Checked, checkable, and the ones that do not add up."""
    species = model.get("species") or {}
    checked = 0
    checkable = 0
    bad: list[str] = []

    for rxn in model.get("reactions") or []:
        sides = list((rxn.get("reactants") or {}).items()) + \
                list((rxn.get("products") or {}).items())
        # Only reactions where EVERY participant carries a formula can be
        # checked. A partial check is worse than none: it reports an
        # imbalance that is really a missing formula.
        if not sides or not all(
                isinstance(species.get(sid), dict) and species[sid].get("formula")
                for sid, _ in sides):
            continue
        checkable += 1
        left: dict[str, int] = {}
        right: dict[str, int] = {}
        for sid, n in (rxn.get("reactants") or {}).items():
            for el, c in _atoms(species[sid]["formula"]).items():
                left[el] = left.get(el, 0) + c * n
        for sid, n in (rxn.get("products") or {}).items():
            for el, c in _atoms(species[sid]["formula"]).items():
                right[el] = right.get(el, 0) + c * n
        if left == right:
            checked += 1
        else:
            diff = sorted(set(left) | set(right))
            detail = ", ".join(
                f"{el} {left.get(el, 0)}->{right.get(el, 0)}"
                for el in diff if left.get(el, 0) != right.get(el, 0))
            bad.append(f'{rxn.get("id")} ({detail})')

    return checked, checkable, bad


# ── the gate ─────────────────────────────────────────────────────────────

def validate(model) -> dict:
    """
    {"ok": bool, "errors": [...], "warnings": [...], "walk": {...}}

    Errors block the save. Warnings do not -- a pathway with no formulas
    is perfectly legitimate (a compiler has no chemistry), and refusing it
    would make the gate a straitjacket rather than a gate.
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(model, dict):
        return {"ok": False, "errors": ["model must be a JSON object"],
                "warnings": [], "walk": None}

    name = model.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append("`name` is required")

    species = model.get("species")
    if not isinstance(species, dict) or not species:
        errors.append("`species` must be a non-empty object")
        species = {}

    reactions = model.get("reactions")
    if not isinstance(reactions, list) or not reactions:
        errors.append("`reactions` must be a non-empty list")
        reactions = []

    for sid, sp in species.items():
        if not isinstance(sp, dict):
            errors.append(f'species "{sid}" must be an object')
        elif not sp.get("name"):
            errors.append(f'species "{sid}" has no name')

    # Duplicate ids are not pedantry: the console mints ids as
    # "<from>_<to>", so two branches between the same pair of nodes collide
    # silently. Blocking then targets an ambiguous reaction and the
    # unreached report double-counts.
    seen: set[str] = set()
    for i, rxn in enumerate(reactions):
        if not isinstance(rxn, dict):
            errors.append(f"reaction {i} must be an object")
            continue
        rid = rxn.get("id")
        if not isinstance(rid, str) or not rid.strip():
            errors.append(f"reaction {i} has no id")
            continue
        if rid in seen:
            errors.append(f'duplicate reaction id "{rid}" '
                          f"(rename one -- two branches between the same "
                          f"pair of nodes collide)")
        seen.add(rid)

        for side in ("reactants", "products"):
            amounts = rxn.get(side)
            if not isinstance(amounts, dict) or not amounts:
                errors.append(f'"{rid}" has no {side}')
                continue
            for sid, n in amounts.items():
                if sid not in species:
                    errors.append(f'"{rid}" names undeclared species "{sid}"')
                if not isinstance(n, (int, float)) or isinstance(n, bool) or n <= 0:
                    errors.append(f'"{rid}" {side}["{sid}"] must be a '
                                  f"positive number")

        guard = rxn.get("when")
        if guard:
            terms, err = parse_when(guard)
            if err:
                errors.append(f'"{rid}": {err}')
            else:
                declared = model.get("conditions") or {}
                for key, _op, val in terms:
                    if key not in declared:
                        errors.append(
                            f'"{rid}" is guarded on "{key}", which is not in '
                            f"`conditions` -- the guard can never be "
                            f"satisfied and the reaction vanishes")
                    elif val not in (declared[key].get("values") or []):
                        warnings.append(
                            f'"{rid}" compares {key} to {val!r}, which is not '
                            f"among its declared values")

    start = model.get("start")
    if not start:
        errors.append("`start` is required -- the walk has nowhere to begin")
    elif start not in species:
        errors.append(f'`start` is "{start}", which is not a declared species')

    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings, "walk": None}

    # ── the walk itself ──────────────────────────────────────────────────
    results = [walk(model, c) for c in _condition_sets(model)]
    best = max(results, key=lambda r: len(r["steps"]))
    reached: set[str] = set()
    for r in results:
        reached |= r["reached"]

    if not best["steps"]:
        errors.append(
            f'the walk never leaves "{start}" -- no reaction consumes it '
            f"under any declared condition")

    stranded = [r["id"] for r in reactions if r["id"] not in reached]
    if stranded:
        errors.append(
            "never reached under any condition: " + ", ".join(stranded) +
            " -- usually a species name that does not match")

    orphans = [sid for sid in species
               if not any(sid in (r.get("reactants") or {}) or
                          sid in (r.get("products") or {}) for r in reactions)]
    if orphans:
        warnings.append("declared but unused: " + ", ".join(orphans))

    checked, checkable, bad = _balance(model)
    if bad:
        errors.append("atoms do not balance: " + "; ".join(bad))
    elif checkable == 0:
        warnings.append("no reaction is atom-checkable "
                        '(add "formula" to species to enable it)')
    elif checked < len(reactions):
        warnings.append(f"atoms balance in {checked}/{len(reactions)}; "
                        f"the rest have no formulas")

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "walk": {"steps": best["steps"], "cyclic": best["cyclic"],
                 "stepCount": len(best["steps"]),
                 "conditionSets": len(results)},
    }
