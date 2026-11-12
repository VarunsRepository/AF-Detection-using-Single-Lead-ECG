# ---------------------------------------------------------------------------
# tests/_dump_recipe.py
#
# Dumps one journey's stage configuration to JSON on stdout, so the node
# checks can run the REAL recipe parameters through the REAL components.
#
#   python3 _dump_recipe.py ble_connect > _connect_recipe.json
#   python3 _dump_recipe.py ble_txpath  > _recipe.json
#
# Replaces the two per-journey dump scripts, which were the same file
# twice with one name changed.
# ---------------------------------------------------------------------------

import json
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _recipe_loader import load

name = sys.argv[1] if len(sys.argv) > 1 else "ble_connect"
_, registered = load(name)

if name not in registered:
    sys.exit(f"{name}: the recipe module did not register itself on import "
             f"(registered: {list(registered) or 'nothing'})")

r = registered[name]
print(json.dumps({
    "name": name,
    "version": r["version"],
    "category": r["category"],
    "stageCount": len(r["stages"]),
    "stages": [{
        "stageId": s["stageId"],
        "algorithm": s["dspEngine"]["availableAlgorithms"][0]["id"],
        "parameters": s["dspEngine"]["parameters"],
        "renderer": s["renderingEngine"]["availableRenderers"][0]["id"],
        "rendererConfig": s["renderingEngine"]["config"],
        "durationMs": s.get("baseDurationMs"),
        "title": s["uiFillers"]["title"],
        "caption": s["uiFillers"]["caption"],
        "description": s["uiFillers"]["description"],
        "hidden": sorted((s.get("choiceControls") or {}).keys()),
    } for s in r["stages"]],
}, indent=1))
