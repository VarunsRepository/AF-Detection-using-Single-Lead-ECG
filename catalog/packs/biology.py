# ---------------------------------------------------------------------------
# catalog/packs/biology.py
#
# Biological processes. The electron transport chain first; photosynthesis,
# transcription and translation are the natural neighbours.
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer

dsp("ets_chain",
    entrypoint="/static/shorts/filters/ets_chain_filter.js",
    label="Electron transport chain",
    description="Redox cascade, proton pumping and ATP yield from deltaG = -nFdeltaE",
    requires = {"fields": ["meta.entryPoint"], "fs_required": False,
                "domains": ["biology.metabolism"]},
    provides = {"fields": ["interimOutputs", "finalOutput.steps",
                           "finalOutput.totalProtons", "finalOutput.atpYield"],
                "fs": None, "domain": "biology.metabolism"})

renderer("ets_cascade_view",
    entrypoint="/static/shorts/renderers/ets_cascade_view.js",
    label="ETS cascade",
    description="Energy staircase with protons crossing the membrane",
    requires = {"fields": ["finalOutput.steps"]})


dsp("photosynthesis",
    entrypoint="/static/shorts/filters/photosynthesis_filter.js",
    label="Photosynthesis pathways",
    description="C3/C4/CAM cost model: photorespiration, ATP and water per CO2",
    requires = {"fields": ["meta.pathway"], "fs_required": False,
                "domains": ["biology.photosynthesis"]},
    provides = {"fields": ["interimOutputs", "finalOutput.steps",
                           "finalOutput.atpPerCO2", "finalOutput.waterPerCO2",
                           "finalOutput.photorespirationLoss"],
                "fs": None, "domain": "biology.photosynthesis"})

renderer("leaf_section_view",
    entrypoint="/static/shorts/renderers/leaf_section_view.js",
    label="Leaf cross-section",
    description="Compartments, stomata and gas traffic, by pathway and condition",
    requires = {"fields": ["finalOutput.steps"]})


# GENERIC: the pathway is data, not code. TCA, glycolysis and the Calvin
# cycle are three JSON documents against one implementation.
dsp("pathway",
    entrypoint="/static/shorts/filters/pathway_filter.js",
    label="Pathway walker",
    description="Orders reactions by shared species, detects cycles, checks atom balance",
    requires = {"fields": ["meta.pathway"], "fs_required": False,
                "domains": ["biology.pathway"]},
    provides = {"fields": ["interimOutputs", "finalOutput.steps",
                           "finalOutput.cyclic", "finalOutput.balance"],
                "fs": None, "domain": "biology.pathway"})

renderer("pathway_view",
    entrypoint="/static/shorts/renderers/pathway_view.js",
    label="Pathway map",
    description="Ring for a cycle, chain for a linear path -- chosen from the topology",
    requires = {"fields": ["finalOutput.steps"]})


# The same pathway as NAVIGATION rather than map: five slots with the
# current reaction centred, and a HUD carrying the shape the window
# cannot show. Reads the tape (move/push/pop) that pathway_filter emits.
renderer("pathway_nav_view",
    entrypoint="/static/shorts/renderers/pathway_nav_view.js",
    label="Pathway navigator",
    description="Windowed walk with a ring/chain HUD and branch indentation",
    requires = {"fields": ["finalOutput.tape"]})
