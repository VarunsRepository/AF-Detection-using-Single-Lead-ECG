# ---------------------------------------------------------------------------
# tests/_recipe_loader.py
#
# Loads a journey recipe BY FILE PATH, with `catalog` stubbed, so a check
# can read a recipe without standing up Services, the stores, and every
# other journey in the catalogue.
#
# WHY NOT JUST IMPORT IT
#   Two reasons, and both bit the first version.
#
#   1. The module name changes. These recipes were drafted as
#      ble_txpath_recipe.py and ship as catalog/journeys/ble_txpath.py,
#      so `from ble_txpath_recipe import ...` stops working the moment
#      the file is put where it belongs.
#
#   2. A recipe registers itself on import, via `import catalog`. Letting
#      that resolve to the real package would import the whole
#      catalogue -- stores, sources, every pack and every other recipe --
#      which is exactly the coupling these checks exist to avoid. Worse,
#      stubbing sys.modules["catalog"] makes `catalog.journeys.<name>`
#      unresolvable as a package member, so importing by dotted name
#      cannot work either way.
#
#   Loading by path with a stub in place sidesteps both.
#
# Returns (module, registered) where `registered` is {name: recipe dict},
# so a check can also assert the module actually registered itself.
# ---------------------------------------------------------------------------

import importlib.util
import pathlib
import sys
import types


def _find_root(start: pathlib.Path) -> pathlib.Path | None:
    """Walk up until a directory containing catalog/journeys appears."""
    d = start.resolve()
    for _ in range(8):
        if (d / "catalog" / "journeys").is_dir():
            return d
        if d.parent == d:
            break
        d = d.parent
    return None


def _candidates(name: str) -> list[pathlib.Path]:
    here = pathlib.Path(__file__).parent
    root = _find_root(here)
    out = []
    if root:
        out.append(root / "catalog" / "journeys" / f"{name}.py")
    # Drafting layouts: everything in one folder, under either the shipped
    # name or the _recipe suffix the drafts carry.
    for d in (here, pathlib.Path.cwd()):
        out += [d / f"{name}.py", d / f"{name}_recipe.py"]
    return out


def _install_glossaries(stub: types.SimpleNamespace) -> None:
    """
    Recipes import catalog.glossaries.<domain> for their term definitions.
    Those modules are standalone -- no Services, no stores -- so the REAL
    ones are loaded by path and hung off the stub. That matters: a check
    that stubbed the glossary too would be testing placeholder text and
    would never catch a typo'd key, which is the one thing terms_for()
    raises on.
    """
    here = pathlib.Path(__file__).parent
    root = _find_root(here)
    searched = []
    found = {}
    for domain in ("wireless",):
        cands = []
        if root:
            cands.append(root / "catalog" / "glossaries" / f"{domain}.py")
        cands += [here / f"{domain}_glossary.py", pathlib.Path.cwd() / f"{domain}_glossary.py"]
        searched += cands
        path = next((c for c in cands if c.exists()), None)
        if path is None:
            continue
        spec = importlib.util.spec_from_file_location(
            f"catalog.glossaries.{domain}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        sys.modules[f"catalog.glossaries.{domain}"] = mod
        found[domain] = mod

    if not found:
        raise FileNotFoundError(
            "_recipe_loader: no glossary modules found.\n  looked for:\n"
            + "\n".join(f"    {c}" for c in searched))

    pkg = types.ModuleType("catalog.glossaries")
    for domain, mod in found.items():
        setattr(pkg, domain, mod)
    sys.modules["catalog.glossaries"] = pkg
    stub.glossaries = pkg


def load(name: str):
    """
    `name` is the journey name as registered -- "ble_connect", "ble_txpath".
    """
    registered: dict = {}

    class _Store:
        def register_journey(self, journey_name, config):
            registered[journey_name] = config

    path = next((p for p in _candidates(name) if p.exists()), None)
    if path is None:
        raise FileNotFoundError(
            f"_recipe_loader: cannot find a recipe for \"{name}\".\n"
            + "  looked for:\n"
            + "\n".join(f"    {p}" for p in _candidates(name)))

    saved = sys.modules.get("catalog")
    saved_sub = {k: v for k, v in sys.modules.items()
                 if k.startswith("catalog.glossaries")}
    stub = types.SimpleNamespace(journey_store=_Store())
    sys.modules["catalog"] = stub
    _install_glossaries(stub)
    try:
        spec = importlib.util.spec_from_file_location(f"_recipe_{name}", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        # Restored rather than deleted, so a caller that had the real
        # catalog imported does not silently lose it.
        for k in [k for k in sys.modules if k.startswith("catalog.glossaries")]:
            sys.modules.pop(k, None)
        sys.modules.update(saved_sub)
        if saved is None:
            sys.modules.pop("catalog", None)
        else:
            sys.modules["catalog"] = saved

    return module, registered
