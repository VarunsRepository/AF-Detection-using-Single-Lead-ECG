# ---------------------------------------------------------------------------
# catalog/journeys/ecg_noise.py
#
# THE STEP THE PRIMER SKIPS.
#
# /journey/ecg_primer runs four stages of textbook beat and then, on
# stage 5, drops a real recording in front of the viewer with nothing in
# between. The viewer is asked to accept that the second thing is the
# first thing, and nothing on screen argues it. This journey is that
# argument, made one artefact at a time.
#
# THE SPINE
#   1  textbook    the primer's beat, unchanged. The reference.
#   2  wander      the chest moves. The whole trace rides up and down.
#   3  mains       the building leaks in, at one exact frequency.
#   4  emg         muscle. Broadband, and it overlaps the QRS.
#   5  motion      a lead is tugged. Transient, and QRS-shaped.
#   6  electrode   an electrode lifts. Not an error -- an absence.
#   7  all         the scenario's own mix. Everything at once.
#   8  recovered   the 5-15 Hz bandpass, and what it costs.
#
# The clean beat stays on screen as a grey ghost on every card, so each
# imperfection is read as a DIFFERENCE rather than as a new picture. That
# is the one thing the primer's stage 5 could not do.
#
# STAGES 2-6 DEMONSTRATE; STAGE 7 REPORTS.
#   The teaching stages show each artefact at a level chosen to be
#   legible, NOT at the selected scenario's level -- because "Ward bed,
#   poor earth" has no motion and no electrode disconnect in it, so a
#   card titled "Motion artefact" would have drawn a trace with no motion
#   in it. Stage 7 is where the scenario's own mix arrives, and that is
#   where it means something: you have now seen all five, here is how
#   much of each this situation actually has. Every card says which of
#   the two it is showing.
#
# THE ORACLE
#   catalog/sources/ecg_noise.py asserts AT IMPORT, by band power, that
#   the 5-15 Hz bandpass removes the wander and the mains line while
#   keeping the QRS, and prints the numbers. Stage 8's caption reports
#   that same measurement. A future edit that breaks the claim is a
#   startup warning, not a card quietly lying.
#
#   The beat count on stage 8 is ground truth, not detection: the source
#   generated the beats and therefore knows where they are. No peak
#   detector runs anywhere in this journey, which is what keeps "9 beats
#   survive" from being a claim about the detector instead of the filter.
#
# WHAT THIS JOURNEY DOES NOT CLAIM
#   The signal is SYNTHETIC and every card says so. Artefact amplitudes
#   and bands follow the MIT-BIH Noise Stress Test Database (bw, em, ma)
#   characterisation, but these are generated, not recorded. The trade is
#   deliberate: a real noise record would be honest about amplitude and
#   useless about ground truth, and this journey needs to be able to say
#   exactly how many beats are really there.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

# NO SEVERITY BUTTON HERE, deliberately. The interpreter asks the DSPE
# for its choices() and builds that control itself; a recipe can only
# hide or rename it via stage["choiceControls"]. Declaring it by hand was
# the bug -- "target": "dsp" is not a dispatcher target (the three are
# dspEngine, renderingEngine, journey) and "cycleParam" is not one of its
# verbs, so the button logged to the console and did nothing.
_RAIL = [
    {"ui": {"label": "Speed"},
     "action": {"target": "journey", "method": "cycleSpeed",
                "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
    {"ui": {"label": "Theme", "icon": "icon_theme"},
     "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
]


def _stage(stage_id, view, params, title, caption, description, ms):
    return {
        "stageId": stage_id,
        "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_noise"},
        "dspEngine": {
            "availableAlgorithms": [{"id": "ecg_noise", "isDefault": True}],
            "parameters": params,
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "artefact_view", "isDefault": True}],
            "config": {"view": view},
        },
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("ecg_noise", {
    "version": 2,   # v2: severity control fixed
    "label": "From Textbook To Real",
    "description": "The textbook beat, and the six things the world does "
                   "to it before it reaches you.",
    "status": "stable",
    "category": "biomedical",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/ecg_noise/samples",
    "globalThemes": {"activeTheme": "ecg",
                     "themes": [{"id": "ecg",
                                 "palette": {"primary": "#2edac4",
                                             "accent": "#2edac4"}}]},
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True,
                     "preloadNextStage": True},
    "uiShell": {"showProgressBar": True,
                "progressBar": {"position": "top", "activeColor": "#2edac4",
                                "inactiveColor": "rgba(255,255,255,0.2)"}},
    "playbackConfig": {"isPaused": False},
    "layout": {"title": "bottom", "caption": "bottom", "description": "bottom",
               "plot": "center", "railControls": "bottom"},

    "stages": [
        _stage("textbook", "artefact", {},
               "The beat you were shown",
               "Textbook geometry. Nothing has happened to it yet.",
               "This is the beat the primer drew: P, QRS and T, at "
               "intervals taken from published clinical ranges. The grey "
               "line underneath is the same signal, and it will stay "
               "there on every card from here on. Watch what separates "
               "the two. Nothing in the rest of this journey changes the "
               "heart -- the heart does exactly this, eight seconds "
               "long, the whole way through. Everything you are about to "
               "see is the recording, not the patient.",
               9000),

        _stage("wander", "artefact", {"upTo": "wander"},
               "Baseline wander",
               "The chest moves, and the electrodes move with it.",
               "The beats are unchanged. The LINE they sit on is not: it "
               "rides up and down at roughly the breathing rate, with a "
               "slower drift under it as the gel settles and the skin "
               "warms. This is why an automatic ST-segment measurement "
               "taken off a raw trace is worthless -- ST is defined "
               "relative to the baseline, and here the baseline is a "
               "moving target. It is also the easiest artefact to "
               "remove, because nothing the heart does is this slow.",
               12000),

        _stage("mains", "artefact", {"upTo": "mains"},
               "Mains interference",
               "The building's wiring, couples straight into the leads.",
               "One exact frequency, plus a weak third harmonic -- the "
               "zoomed strip below shows a quarter second of it so you "
               "can see the sinusoid rather than a smear. It is the "
               "easiest artefact to IDENTIFY, because it is the only one "
               "with a frequency you can name before you look, and in a "
               "building with poor earthing it can rival the QRS in "
               "amplitude. Notice it does not move the baseline and does "
               "not hide the beats; it just makes everything furry.",
               12000),

        _stage("emg", "artefact", {"upTo": "emg"},
               "Muscle noise",
               "Skeletal muscle firing near the electrode.",
               "Broadband, mostly above 20 Hz, and this is the first one "
               "that is genuinely hard. Wander is slower than the heart "
               "and mains is a single line, so both can be filtered out "
               "with something that leaves the QRS alone. EMG overlaps "
               "the QRS in frequency. There is no filter that removes it "
               "and keeps the beat intact -- anything that takes out the "
               "muscle takes out some of the beat with it. That is the "
               "trade the last card measures.",
               13000),

        _stage("motion", "artefact", {"upTo": "motion"},
               "Motion artefact",
               "A lead is tugged. The worst one, and here is why.",
               "Transient, large, and below 2 Hz -- but look at the "
               "shape. A motion artefact has a fast edge, which means it "
               "has energy where the QRS has energy, and it is often "
               "TALLER than a real beat. A peak detector looking for "
               "'tall and fast' will take it. This single artefact is "
               "responsible for most false alarms on real monitors, and "
               "it is the reason Pan-Tompkins has an entire adaptive "
               "threshold stage rather than a fixed one.",
               13000),

        _stage("electrode", "artefact", {"upTo": "electrode"},
               "Electrode disconnect",
               "An electrode lifts. Not a small error.",
               "Everything else on this journey ADDS something to the "
               "signal. This one takes it away. The amplifier sees an "
               "open input, saturates against its rail, and settles back "
               "exponentially when contact returns -- and the shaded "
               "window is not noisy signal, it is no signal. No filter "
               "recovers it, because there is nothing under it to "
               "recover. The only correct response is to detect the "
               "condition and refuse to report a heart rate, which is "
               "what a monitor's 'LEAD OFF' alarm is.",
               13000),

        _stage("all", "mix", {"all": True},
               "{name}",
               "Everything at once, at this situation's own levels.",
               "Now the levels are this scenario's, not demonstration "
               "ones -- the five cards before this showed each artefact "
               "at a level chosen so you could see it, because a ward "
               "bed has no motion artefact to show you. This is what the "
               "situation actually produces. Swap samples to compare: a "
               "resting recording with good electrodes sits almost on "
               "its own ghost, and the back of an ambulance does not. "
               "The grey line is identical in both. Only the recording "
               "changed.",
               15000),

        _stage("recovered", "recovered", {"all": True, "filter": True},
               "What a filter can and cannot do",
               "5-15 Hz bandpass. The honest version of the result.",
               "This is the band Pan-Tompkins works in, and the caption "
               "at the top is measured, not asserted: the wander and the "
               "mains line are gone, and a little under half the QRS "
               "amplitude is gone with them. That is the trade, and it "
               "is why the detection stage that follows works on a "
               "signal that no longer looks like an ECG. What a filter "
               "cannot do is on the previous card -- a dropout stays a "
               "dropout, and a motion artefact keeps the part of itself "
               "that lives in the same band as the beat. The beat count "
               "here is ground truth from the generator, not a "
               "detection, so it measures the filter rather than "
               "flattering it.",
               16000),
    ],
})