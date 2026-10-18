# ---------------------------------------------------------------------------
# catalog/packs/aero.py
#
# Vehicle aerodynamics. Domain "physics.aero" -- a car is not a signal,
# a cipher block or a chip record, and a schema that let any of those
# reach this DSPE would produce confident nonsense.
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer

dsp("fan_suction",
    entrypoint="/static/shorts/filters/suction_filter.js",
    label="Fan suction",
    description="Fan curve against skirt leakage; downforce, seal "
                "sensitivity, claim check and thruster budget",
    requires = {"fields": ["meta.mass_kg", "meta.sealedArea_m2",
                           "meta.sealPerimeter_m"],
                "fs_required": False, "domains": ["physics.aero"]},
    provides = {"fields": ["interimOutputs", "finalOutput.dP",
                           "finalOutput.fanForce", "finalOutput.sealSteps",
                           "finalOutput.claimSteps", "finalOutput.thrustSteps",
                           "finalOutput.requiredDP", "finalOutput.burnS"],
                "fs": None, "domain": "physics.aero"})

renderer("suction_view",
    entrypoint="/static/shorts/renderers/suction_view.js",
    label="Suction views",
    description="Speed crossover, skirt-gap collapse with section, "
                "pressure budget and thruster burn",
    requires = {"fields": ["interimOutputs", "finalOutput.weight"]})
