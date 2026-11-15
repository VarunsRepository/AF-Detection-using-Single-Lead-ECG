# ---------------------------------------------------------------------------
# catalog/glossaries/ecg.py
#
# Same four-column shape as catalog/glossaries/wireless.py: acronym, full
# name, a plain-English definition, and a short swappable noun phrase.
# Read that file's header for why each column exists; this one records
# only what is specific to ECG.
#
# SCOPE: the terms that appear in the beats, ecg and spectrum journeys'
# own prose. Not a cardiology reference -- a term earns an entry when a
# card already says it, because the point is to let one written sentence
# serve both registers, not to teach vocabulary nobody met.
#
# ── THE ACCURACY RULE THIS DOMAIN NEEDS AND WIRELESS DOES NOT ─────────
#   A plain name must name THE SAME THING, not a nearby thing. The trap
#   here is specific and it is easy to fall into:
#
#       R-apex        ONE SAMPLE -- the top of the spike
#       QRS complex   AN INTERVAL of roughly 100 ms
#
#   They are not synonyms, and labelling a single point "the QRS complex"
#   is simply wrong. The audience most likely to notice is the audience
#   this app is trying to earn. So a `short` form may simplify the
#   WORDING and must never change the REFERENT: "the beat's peak" is a
#   fine short form for R-apex because it still names one point.
#
#   Where a term genuinely refers to a span, the entry says so, and the
#   annotation layer cannot mark it until span anchors exist.
#
# ── WHY MOST ENTRIES HAVE NO EMOJI, AND WHY THE PEAK HAS NONE ─────────
#   Same rule as wireless: repeated glyphs teach, unique ones decorate.
#
#   R_PEAK deliberately carries none even though it is the most repeated
#   term in the app -- the annotation layer ALREADY marks peaks on the
#   plot, via the theme's `peak` and `point_at` roles. A glyph in the
#   prose as well would be the same signal twice, in two vocabularies
#   that could drift apart. The mark owns the plot; the glossary owns the
#   words.
# ---------------------------------------------------------------------------

TERMS: dict[str, dict[str, str]] = {

    # ── the waveform's own landmarks ──────────────────────────────────────
    # Points, every one of them. Safe to mark on a plot.
    "R_PEAK": {
        "full": "R-apex",
        "jargon": "R-apex",
        "plain": "the tallest point of a heartbeat's main spike",
        "short": "the beat's peak",
    },
    "P_WAVE": {
        "full": "P-wave",
        "plain": "the small bump before the main spike, as the upper chambers contract",
        "short": "the small early bump",
    },
    "Q_DIP": {
        "full": "Q-dip",
        "plain": "the small dip immediately before the main spike",
        "short": "the dip before the spike",
    },
    "S_DIP": {
        "full": "S-dip",
        "plain": "the dip immediately after the main spike",
        "short": "the dip after the spike",
    },
    "T_WAVE": {
        "full": "T-wave",
        "plain": "the broad bump after the spike, as the main chambers reset",
        "short": "the broad late bump",
    },

    # ── spans, NOT points. See the accuracy rule above. ───────────────────
    "QRS": {
        "full": "QRS complex",
        "jargon": "QRS complex",
        "plain": "the whole roughly 100 millisecond stretch covering the dip, spike and dip",
        # A STRETCH, and the short form has to keep saying so. "the main
        # spike" would quietly turn an interval into a point.
        "short": "the main spike's stretch",
    },
    "RR": {
        "full": "R-R interval",
        "jargon": "R-R interval",
        "plain": "the gap in milliseconds from one beat's peak to the next one's",
        "short": "the beat-to-beat gap",
        # The gap IS the subject of two whole stages, and it recurs in the
        # tachogram, the scatter view and the rhythm stages.
        "emoji": "⏱",
    },

    # ── rhythm and what it reveals ────────────────────────────────────────
    "AFIB": {
        "full": "Atrial fibrillation",
        "plain": "a rhythm where the upper chambers quiver instead of contracting, leaving the beats irregular",
        "short": "the irregular-rhythm condition",
    },
    "F_WAVE": {
        "full": "Fibrillatory wave",
        "plain": "the ragged activity that replaces the small early bump when the upper chambers quiver",
        "short": "the ragged early activity",
    },
    "SINUS": {
        "full": "Normal sinus rhythm",
        "plain": "the ordinary rhythm, where beats arrive evenly and each one looks like the last",
        "short": "the ordinary rhythm",
    },
    "MORPHOLOGY": {
        "full": "Morphology",
        "plain": "the shape of a beat, as opposed to when it happened",
        "short": "the beat's shape",
    },
    "BPM": {
        "full": "Beats per minute",
        "plain": "how many times the heart beats in a minute",
        "short": "the beat rate",
        "emoji": "💓",
    },

    # ── the algorithms the journeys name ──────────────────────────────────
    "PAN_TOMPKINS": {
        "full": "Pan-Tompkins",
        "plain": "the standard recipe for finding heartbeats in a signal: filter, square, smooth, then threshold",
        "short": "the beat-finding algorithm",
    },
    "HAMILTON_TOMPKINS": {
        "full": "Hamilton-Tompkins",
        "plain": "a later variant of that recipe, with different rules for rejecting false beats",
        "short": "the alternative beat-finder",
    },
    "DWT": {
        "full": "Discrete Wavelet Transform",
        "plain": "splitting a signal into coarse and fine detail, repeatedly, so each scale can be looked at alone",
        "short": "the detail-splitting transform",
    },
    "THRESHOLD": {
        "full": "Adaptive threshold",
        "plain": "the moving bar a candidate has to clear to count as a beat, which rises and falls with the signal",
        "short": "the moving bar",
    },

    # ── measures the cards print ──────────────────────────────────────────
    "SD1": {
        "full": "SD1",
        "plain": "how much consecutive beat gaps differ from each other -- short-term variability",
        "short": "the short-term spread",
    },
    "SD2": {
        "full": "SD2",
        "plain": "how much the beat gaps drift over the whole recording -- long-term variability",
        "short": "the long-term spread",
    },
    "POINCARE": {
        "full": "Poincaré plot",
        "plain": "each beat gap plotted against the one before it, so a steady rhythm gathers in a tight cloud",
        "short": "the gap-against-previous-gap plot",
    },
    "TACHOGRAM": {
        "full": "RR tachogram",
        "plain": "the beat gaps drawn in order, so the rhythm's drift over time is visible",
        "short": "the gaps-over-time plot",
    },
    "PSD": {
        "full": "Power Spectral Density",
        "plain": "how much of a signal's energy sits at each frequency",
        "short": "the energy-by-frequency curve",
    },
    "VIX": {
        "full": "Rhythm volatility index",
        "plain": "the spread of successive beat-gap ratios -- near zero for a steady rhythm, above 10% when it is genuinely irregular",
        "short": "the rhythm volatility score",
    },

    # ── signal-processing vocabulary the cards use ────────────────────────
    "FS": {
        "full": "Sampling rate",
        "plain": "how many measurements of the signal were taken each second",
        "short": "the measurements per second",
    },
    "MV": {
        "full": "Millivolt",
        "plain": "the unit the heart's electrical signal is measured in, a thousandth of a volt",
        "short": "the signal's unit",
    },
    "BASELINE_WANDER": {
        "full": "Baseline wander",
        "plain": "the slow drift of the whole trace up and down, usually from breathing or a moving electrode",
        "short": "the slow drift",
    },
    "ARTEFACT": {
        "full": "Artefact",
        "plain": "something in the trace that came from the equipment or the patient moving, not from the heart",
        "short": "the non-heart interference",
        "emoji": "⚠️",
    },
}


def terms_for(keys: list[str]) -> list[dict]:
    """
    The entries a stage should surface, in the order given -- the order a
    viewer meets them matters more than alphabetical.

    Raises on an unknown key rather than skipping it. This runs at import
    time, so a typo fails the app's startup loudly instead of quietly
    leaving a card with no definitions.

    Identical to the wireless version on purpose: two glossaries with the
    same contract can be swapped by a recipe naming a different module,
    and a journey that spans domains can merge them.
    """
    out = []
    for k in keys:
        if k not in TERMS:
            raise KeyError(
                f'ecg glossary: no entry for "{k}". '
                f'Known keys: {", ".join(sorted(TERMS))}')
        out.append({"acronym": k, **TERMS[k]})
    return out


def glossary_for_client() -> dict:
    """
    The whole glossary, in the shape journey_interpreter's fill() needs to
    resolve {{KEY}} tokens in a stage's prose. See the wireless version
    for why this is the whole thing rather than a per-stage subset.

    `jargon` is the form shown in the FULL register, and it defaults to
    `full` rather than to the dict key -- because an ECG key is a
    programmer's identifier, not a term. Rendering the key would put
    "marks each R_PEAK" on the card. The wireless glossary defaults to the
    key instead, because there the key genuinely IS the acronym.
    """
    return {
        k: {"acronym": v.get("jargon", v.get("full", k)),
            "short": v.get("short", k),
            "emoji": v.get("emoji")}
        for k, v in TERMS.items()
    }
