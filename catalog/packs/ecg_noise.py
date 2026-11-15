# ---------------------------------------------------------------------------
# catalog/packs/ecg_noise.py
#
# Registers the artefact journey's one DSPE and one RE.
#
# A pack of its own rather than more lines in the primer's: this journey
# reads a different source, and the primer's pack says in its own comment
# that keeping them separate is what makes "what does this journey read?"
# answerable. Folding this in would make that comment false.
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer


# ── The DSPE ────────────────────────────────────────────────────────────
#
# WHAT IT REQUIRES
#   The seven named arrays, because the whole point is that the artefacts
#   arrive SEPARATELY and are mixed here rather than in the source. A
#   source that shipped one pre-corrupted trace could not be stepped
#   through one artefact at a time, and the severity control could not
#   exist at all.
#
#   fs_required is True: the bandpass corner frequencies and the 0.25s
#   zoom on the isolated strip are both meaningless without a rate.
#
# WHAT IT PROVIDES
#   finalOutput.clean is listed first because it is on EVERY card. It is
#   the reference the whole journey argues against, not a stage output.
#
#   Note what is NOT provided: peakIndices. truthR is passed through from
#   the source, which knows the beat positions because it generated them.
#   Nothing here detects anything, which is what lets the last card say
#   how many beats survive the filter without the claim being circular.
dsp("ecg_noise",
    entrypoint="/static/shorts/filters/ecg_noise_filter.js",
    label="Textbook to real",
    description="Mixes named artefacts onto a clean beat one at a time, "
                "at a severity the rail can change, and applies the "
                "5-15 Hz bandpass on the last stage. Detects nothing.",
    requires={"fields": ["clean", "wander", "mains", "emg", "motion",
                         "electrode", "emask"],
              "fs_required": True,
              "domains": ["biomedical.ecg"]},
    provides={"fields": ["finalOutput.clean", "finalOutput.y",
                         "finalOutput.filtered", "finalOutput.focus",
                         "finalOutput.active", "finalOutput.teaching",
                         "finalOutput.severity", "finalOutput.cost",
                         "finalOutput.truthR", "finalOutput.scenario",
                         "finalOutput.provenance"],
              "domain": "biomedical.ecg"})


# ── The RE ──────────────────────────────────────────────────────────────
#
# Three views on one renderer, chosen by renderingEngine.config.view.
#
# The shape -- a reference trace in grey, the actual trace over it, and
# optionally the difference drawn alone below -- is deliberately more
# general than this journey. The planned follow-up puts a real recording
# in the accent and a smoothed reconstruction in the grey, which is the
# same picture with the roles swapped. Building a second renderer for it
# would be building the drift between two copies.
renderer("artefact_view",
    entrypoint="/static/shorts/renderers/artefact_view.js",
    label="Trace and reference",
    description="A clean reference under a corrupted trace, with the "
                "artefact that separates them drawn alone underneath. "
                "Min/max decimated, so dense oscillations show their "
                "envelope rather than an alias.",
    requires={"fields": ["finalOutput.clean", "finalOutput.y"]})
