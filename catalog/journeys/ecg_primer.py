# ---------------------------------------------------------------------------
# catalog/journeys/ecg_primer.py
#
# THE JOURNEY BEFORE /journey/ecg.
#
# Shown to someone without a signals background, the ECG journey needed
# three things explained out loud before it made any sense: that a wiggly
# line is voltage against time, that the spikes are heartbeats, and that
# finding them is hard. This is that explanation, as five cards.
#
# A SEPARATE JOURNEY, NOT FIVE EXTRA STAGES ON /journey/ecg.
#   Prepending them would put forty seconds of primer in front of every
#   ECG card, for every viewer, every time -- including the ones who came
#   back for the detector. A primer is something you watch once.
#
# THE SHAPE: each stage is ONE sentence, and the stage after it is only
# possible because of the one before.
#
#   1  a signal is a number that changes over time
#   2  count the bumps -- you just did peak detection
#   3  a real beat is not a bump: P, QRS, T
#   4  R is the landmark, and R-to-R is the rate
#   5  here is a REAL recording. Now find the beats.
#
# Stage 5 ends on the PROBLEM. Pan-Tompkins then arrives in the next
# journey as the answer to something the viewer has just failed at,
# rather than as a solution to a difficulty they were told about.
#
# PROVENANCE, per section 34's oracle rule
#   Stages 1-4 are DRAWN. The renderer marks every one of them
#   "DRAWN - NOT A RECORDING" in the corner, because a synthetic beat and
#   a real one are indistinguishable to a viewer and the whole value of
#   the primer depends on not being confused for evidence.
#   Stage 5 is a real PhysioNet recording and says so.
#
#   The textbook beat's oracle is published clinical reference ranges --
#   PR 120-200ms, QRS 70-110ms, QT 350-440ms, P <= 110ms -- MEASURED back
#   off the generated samples rather than read from the constants that
#   drew them. A diagram that looks like a beat but has a 60ms PR
#   interval would teach something false, convincingly.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store


_SOURCE = {"mode": "HTTP_REST", "sourceId": "ecg_single"}

# Only ONE algorithm and ONE renderer per stage, so no Algorithm or
# Renderer button is declared -- a control that cycles to itself is worse
# than no control. Speed and Theme are the two that mean something here,
# and Share is added by the engine.
_RAIL = [
    {"ui": {"label": "Speed", "icon": "icon_speed"},
     "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
    {"ui": {"label": "Theme", "icon": "icon_theme"},
     "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
]


def _stage(stage_id, view, ms, title, caption, description):
    return {
        "stageId": stage_id,
        "dataSource": dict(_SOURCE),
        "dspEngine": {
            "availableAlgorithms": [{"id": "ecg_primer", "isDefault": True}],
            "parameters": {},
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "primer_view", "isDefault": True}],
            "config": {"view": view},
        },
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
        "railControls": list(_RAIL),
        "baseDurationMs": ms,
    }


journey_store.register_journey("ecg_primer", {
    "version": 1,
    "label": "What A Heartbeat Looks Like",
    "description": "Five steps from a flat line to a real ECG",
    "status": "stable",
    "category": "ecg",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/ecg_single/samples",

    "globalThemes": {
        "activeTheme": "clinical",
        "themes": [{"id": "clinical",
                    "palette": {"primary": "#5cc24a", "accent": "#eb7b2b"}}],
    },
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True,
                     "preloadNextStage": True},
    "uiShell": {"showProgressBar": True,
                "progressBar": {"position": "top",
                                "activeColor": "#5cc24a",
                                "inactiveColor": "rgba(255,255,255,0.2)"}},
    "playbackConfig": {"isPaused": False},
    "layout": {"title": "bottom", "caption": "bottom",
               "description": "bottom", "plot": "center",
               "railControls": "bottom"},

    "stages": [

        # Longer than it looks like it needs. The flat stretch has to be
        # on screen long enough to register AS flat, or "then something
        # happened" has nothing to happen against.
        _stage(
            "primer_signal", "what_is_signal", 7000,
            "A Line That Means Something",
            "Left to right is time. Up and down is voltage.",
            "This is all a signal is: one number, measured over and over, "
            "drawn left to right as time passes. Nothing is happening at "
            "the start, so the line is flat. Then something happens, and "
            "the line goes up. That is the entire idea, and everything "
            "else in this journey is a refinement of it."),

        # The hinge of the whole primer. The viewer does the task by eye
        # BEFORE being told it is a task, so stage 5 can take it away.
        _stage(
            "primer_count", "count_them", 9000,
            "Count Them",
            "Five bumps. No algorithm needed.",
            "Each bump is one heartbeat. Count them and you have the "
            "number of beats; measure the gap between them and you have "
            "the rate. Five beats, 833 milliseconds apart, is 72 beats a "
            "minute — a resting pulse.\n\nYou just did peak "
            "detection, with your eyes, and it was easy. Remember that "
            "it was easy."),

        _stage(
            "primer_anatomy", "anatomy", 12000,
            "One Beat, Up Close",
            "P, QRS and T — three things the heart does.",
            "A real heartbeat is not one bump, it is five deflections "
            "with names, and each is the heart doing a different job.\n\n"
            "P is the atria squeezing, pushing blood into the ventricles. "
            "QRS is the ventricles firing — the big spike, because "
            "it is the most muscle moving at once. T is the ventricles "
            "resetting, ready for the next beat.\n\nThe gaps matter too. "
            "PR is how long the signal takes to travel from the atria to "
            "the ventricles. QT is how long the ventricles stay "
            "contracted. Both have normal ranges, and both are drawn "
            "here inside them."),

        _stage(
            "primer_landmark", "the_landmark", 10000,
            "Why R",
            "The tallest, sharpest part is the one worth finding.",
            "Of the five parts, R is the one every beat detector looks "
            "for. Not because it matters most medically, but because it "
            "is the easiest to find the same way twice: it is tall, it is "
            "narrow, and it is steep.\n\nP is small enough to be lost in "
            "noise. T is broad, so pinning down exactly where it happened "
            "is a judgement call. R is neither.\n\nMeasure R to R and "
            "divide into 60,000 and you have the heart rate, beat by "
            "beat — which is where every reading in the next journey "
            "comes from."),

        # Ends on the question. The whole primer exists so that this card
        # lands as "oh" rather than as a wall of noise.
        _stage(
            "primer_real", "why_hard", 9000,
            "Now A Real One",
            "Same task. Much harder.",
            "Everything before this was drawn. This is an actual "
            "recording from an actual person, with nothing cleaned up.\n\n"
            "The baseline wanders as the patient breathes. The spikes are "
            "not all the same height. Electrical noise from muscles sits "
            "on top of everything. On some beats the T wave is nearly as "
            "tall as the R, so counting the tall things gives you twice "
            "the real answer.\n\nCounting by eye worked perfectly on five "
            "clean bumps. Try it on thirty seconds of this, then on "
            "8,528 recordings. That is the problem Pan-Tompkins solves, "
            "and the next journey is how."),
    ],
})
