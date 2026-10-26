# ---------------------------------------------------------------------------
# catalog/packs/ecg_primer.py
#
# Registers the primer's one DSPE and one RE.
#
# Deliberately a pack of its own rather than two more lines in the ECG
# pack: the primer is the only thing in the app that GENERATES its own
# signal, and keeping it separate means "what does this journey read?"
# has an honest answer -- stages 1 to 4 read nothing.
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer


 

# ── The DSPE ────────────────────────────────────────────────────────────
#
# WHAT IT REQUIRES, AND WHY SO LITTLE
#   y and fs are declared because stage 5 shows a real recording, and
#   fs_required is True because the bpm arithmetic in stages 2 and 4 is
#   meaningless without a sample rate. Stages 1 to 4 would run with no
#   input at all -- the generator does not look at y -- but declaring
#   that would be declaring a contract this journey does not use.
#
# WHAT IT PROVIDES
#   Five named series plus the measured intervals. Note what is NOT in
#   the list: peakIndices. The last stage asks the viewer where the
#   beats are, and a renderer that received the answer could not be
#   trusted not to draw it.
dsp("ecg_primer",
    entrypoint="/static/shorts/filters/ecg_primer_filter.js",
    label="ECG primer",
    description="Generates the simplest possible signal, a textbook beat "
                "and a two-beat pair, and passes a real recording through "
                "untouched. Stages 1-4 are DRAWN, not measured.",
    requires={"fields": ["y", "fs"], "fs_required": True,
              "domains": ["biomedical.ecg"]},
    provides={"fields": ["finalOutput.single", "finalOutput.train",
                         "finalOutput.beat", "finalOutput.pair",
                         "finalOutput.real", "finalOutput.measured",
                         "finalOutput.normal", "finalOutput.provenance"],
              "domain": "biomedical.ecg"
              }
              )


# ── The RE ──────────────────────────────────────────────────────────────
#
# One renderer, five views, chosen by renderingEngine.config.view. Five
# separate renderers would share ~200 lines of axis, callout and span
# drawing, and the lesson from chart_v1 / chart_v1_canvas / chart_v1_webgl
# is that copies of the same drawing code drift -- the WebGL one lost its
# peak markers entirely and nobody noticed for weeks.
renderer("primer_view",
    entrypoint="/static/shorts/renderers/primer_view.js",
    label="Primer",
    description="Five progressive explainer views: a single bump, a "
                "countable train, a labelled textbook beat, the R-to-R "
                "interval, and a real recording with no markers.",
    requires={"fields": ["finalOutput.single", "finalOutput.train",
                         "finalOutput.beat", "finalOutput.pair"]})
