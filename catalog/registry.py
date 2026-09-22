# ---------------------------------------------------------------------------
# catalog/registry.py
#
# One call per component. Registers the file AND declares its contract,
# so an id is written once instead of twice in two files that nothing
# keeps in sync.
#
# THE PROBLEM THIS SOLVES
#   Adding one algorithm used to mean editing four files:
#
#     filters/x.js              the code
#     catalog/components.py     dsp_store.register("x", entrypoint=...)
#     catalog/schemas.py        schema_registry.declare("x", requires=...)
#     catalog/journeys/y.py     add "x" to availableAlgorithms
#
#   Three of those are bookkeeping, and the id was repeated in each with
#   nothing checking they agreed. A typo in schemas.py did not fail -- it
#   silently left the component UNVALIDATED, because the schema registry
#   skips anything undeclared. The quietest possible failure.
#
#   Now: one register_dsp() call carries entrypoint and contract
#   together, and the id physically cannot disagree with itself.
#
# WHY NOT AUTO-DISCOVER FROM THE JS FILES
#   Considered: scan filters/*.js, parse out registerDspAlgorithm ids.
#   Rejected -- it means parsing JavaScript from Python, it cannot see
#   the contract (which exists only in the author's head until declared),
#   and a file that fails to parse would silently vanish from the
#   catalogue. Explicit registration is a few more keystrokes and fails
#   loudly.
# ---------------------------------------------------------------------------

from Services.Dsp_Store import DspAlgorithmStore
from Services.Rendering_Store import RenderingStore
from Services.data_source_store import data_source_store
from Services.Schema_Registry import schema_registry

dsp_store       = DspAlgorithmStore()
rendering_store = RenderingStore()

# Ids seen so far, so a duplicate registration fails loudly at import
# rather than silently overwriting -- two packs both claiming "chart_v1"
# would otherwise leave whichever imported last, with no warning.
_seen: dict[str, str] = {}


def _claim(kind: str, component_id: str) -> None:
    prev = _seen.get(component_id)
    if prev:
        raise ValueError(
            f'Component id "{component_id}" registered twice '
            f'(first as {prev}, now as {kind}). Ids are global.')
    _seen[component_id] = kind


def dsp(component_id: str, entrypoint: str, label: str = "",
        description: str = "", requires: dict | None = None,
        provides: dict | None = None) -> None:
    """
    A DSP algorithm: where its JS lives, and what it consumes/produces.

    requires / provides are optional -- omitting them leaves the
    component unvalidated, which is legitimate for test stubs but should
    be deliberate rather than accidental.
    """
    _claim("dsp", component_id)
    dsp_store.register(component_id, entrypoint=entrypoint,
                       label=label, description=description)
    if requires or provides:
        schema_registry.declare(component_id, requires=requires, provides=provides)


def renderer(component_id: str, entrypoint: str, label: str = "",
             description: str = "", requires: dict | None = None) -> None:
    """
    A renderer. Only `requires` -- a renderer's output is pixels, which
    nothing downstream consumes, so it has nothing to declare.
    """
    _claim("renderer", component_id)
    rendering_store.register(component_id, entrypoint=entrypoint,
                             label=label, description=description)
    if requires:
        schema_registry.declare(component_id, requires=requires)


def source(source_id: str, **kwargs) -> None:
    """
    A data source. Passes straight through to Data_Source_Store, which
    already takes its schema inline -- sources never had the two-file
    problem, so this exists only for symmetry at the call site.
    """
    _claim("source", source_id)
    data_source_store.register(source_id, **kwargs)


def undeclared() -> list[str]:
    """
    Components registered without a contract. Called at startup so an
    unvalidated component is visible rather than merely absent from the
    validation output -- "no errors" reads the same whether a pipeline is
    correct or simply unchecked.
    """
    declared = set(schema_registry.declared()["requires"]) | \
               set(schema_registry.declared()["provides"])
    return sorted(cid for cid, kind in _seen.items()
                  if kind in ("dsp", "renderer") and cid not in declared)
