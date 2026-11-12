# ---------------------------------------------------------------------------
# tests/check_glossary.py
#
# Enforces the glossary's own rule: a plain-English name must not lean on
# another acronym from the same file. If it does, the viewer has to look
# up the explanation of the explanation, and the third column has failed
# at the one job it exists for.
#
# Python now rather than Node, because the glossary moved from
# static/shorts/core/ to catalog/glossaries/ -- it is domain content, not
# engine code, and core/ is strictly app only.
#
# Run:  python3 tests/check_glossary.py
# ---------------------------------------------------------------------------

import importlib.util
import pathlib
import re
import sys

DOMAINS = ("wireless",)


def _find_root(start: pathlib.Path) -> pathlib.Path | None:
    d = start.resolve()
    for _ in range(8):
        if (d / "catalog" / "glossaries").is_dir():
            return d
        if d.parent == d:
            break
        d = d.parent
    return None


def _load(domain: str):
    here = pathlib.Path(__file__).parent
    root = _find_root(here)
    cands = []
    if root:
        cands.append(root / "catalog" / "glossaries" / f"{domain}.py")
    cands += [here / f"{domain}_glossary.py",
              pathlib.Path.cwd() / f"{domain}_glossary.py"]
    path = next((c for c in cands if c.exists()), None)
    if path is None:
        raise FileNotFoundError(
            f"check_glossary: cannot find the {domain} glossary.\n  looked for:\n"
            + "\n".join(f"    {c}" for c in cands))
    spec = importlib.util.spec_from_file_location(f"_gloss_{domain}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod, path


def main() -> int:
    fails = 0

    for domain in DOMAINS:
        mod, path = _load(domain)
        terms = mod.TERMS
        keys = list(terms)
        print(f"{domain}: {len(keys)} terms  ({path})\n")

        # ── shape ──────────────────────────────────────────────────────
        for k in keys:
            t = terms[k]
            if not t.get("full") or not t.get("plain"):
                print(f"  FAIL {k}: missing full or plain"); fails += 1
            elif t["plain"] == t["full"]:
                print(f"  FAIL {k}: plain is just the full name again"); fails += 1
            elif t["plain"][:1].isupper():
                print(f"  FAIL {k}: plain should read as a lowercase phrase"); fails += 1

        # ── the actual rule ────────────────────────────────────────────
        # Whole-word and case sensitive, so "SN" does not match "means"
        # and "handle" does not match "handles".
        print("plain names must not use another acronym")
        leaned_any = False
        for k in keys:
            plain = terms[k]["plain"]
            leaned = [o for o in keys
                      if o != k and re.search(rf"\b{re.escape(o)}\b", plain)]
            if leaned:
                print(f'  FAIL {k}: plain uses {", ".join(leaned)} -- "{plain}"')
                fails += 1
                leaned_any = True
        if not leaned_any:
            print("  ok   no plain name leans on another term")

        # ── terms_for() behaves ────────────────────────────────────────
        print("\nterms_for()")
        got = mod.terms_for([keys[0], keys[1]])
        if len(got) == 2 and got[0]["acronym"] == keys[0]:
            print("  ok   returns entries in the order asked")
        else:
            print("  FAIL ordering or shape wrong"); fails += 1

        # An unknown key must RAISE, not be skipped. This runs at app
        # import time, so a typo should fail startup rather than leave a
        # card silently undefined.
        try:
            mod.terms_for(["DEFINITELY_NOT_A_TERM"])
            print("  FAIL an unknown key was accepted silently"); fails += 1
        except KeyError:
            print("  ok   an unknown key raises")

        if mod.terms_for([]) == []:
            print("  ok   empty input returns empty")
        else:
            print("  FAIL empty input"); fails += 1

    print("\nGLOSSARY CLEAN\n" if fails == 0 else f"\n{fails} GLOSSARY FAILURE(S)\n")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
