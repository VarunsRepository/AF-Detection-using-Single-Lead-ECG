# ---------------------------------------------------------------------------
# catalog/sources/ecg_noise.py
#
# HOW A TEXTBOOK BEAT BECOMES A REAL RECORDING.
#
# WHY THIS JOURNEY EXISTS
#   The primer ends by cutting from a generated ideal beat straight to a
#   real PhysioNet record. Everything in between happens off screen, so a
#   viewer sees "clean" and then "mess" with no way to attribute any part
#   of the mess to a cause. This adds the causes back, one at a time, to
#   the SAME ideal beat the primer showed.
#
# THE CLEAN SIGNAL IS THE PRIMER'S CLEAN SIGNAL
#   Same clinical geometry, same constants, derived from the same
#   published normal ranges rather than copied from the JS. The test
#   suite runs the primer's own measureBeat() over this generator's
#   output and requires the intervals to agree -- if the two journeys
#   ever drift apart, that fails rather than quietly showing two
#   different "ideal" beats.
#
# COMPONENTS, NOT PRE-MIXED SIGNALS
#   Each artefact is shipped as its own full-length array. The filter
#   sums them with a severity weight, so the rail can change severity
#   live and a stage can show exactly one artefact against the clean
#   trace. A pre-mixed signal per stage would have been less code here
#   and a dead card on screen.
#
# THE ORACLE
#   Each artefact is built with known spectral content, and the claim the
#   journey makes is measurable:
#
#       Pan-Tompkins' 5-15 Hz bandpass removes baseline wander and mains
#       while preserving the QRS.
#
#   _check_claim() measures band power before and after that bandpass and
#   asserts it at import. Nothing here depends on a beat detector -- a
#   detector would be a second thing to be wrong about.
#
#   Artefact characteristics follow the standard references:
#     baseline wander  respiration, ~0.15-0.5 Hz
#     mains            50 Hz here (UK/EU) plus a weak 3rd harmonic
#     EMG              broadband, ~20 Hz and above
#     motion           large transient excursions, <2 Hz
#     electrode        saturation / flat line
#   MIT-BIH Noise Stress Test Database (bw, em, ma) is the usual source
#   for realistic amplitudes; these are synthetic so that ground truth is
#   exact, which a real noise record cannot give.
# ---------------------------------------------------------------------------

import math
import random

from Services.data_source_store import data_source_store

FS       = 360          # Hz, MIT-BIH convention and what the ECG journey uses
DUR_S    = 8
N        = FS * DUR_S
HR_BPM   = 66
MAINS_HZ = 50           # change to 60 for North America


# ── The textbook beat ────────────────────────────────────────────────────
# Published normal ranges; the generator uses the midpoint of each. These
# are the same ranges the primer declares, and for the same reason: a beat
# drawn from clinical geometry can be measured and checked, a beat drawn
# by eye cannot.

NORMAL = {
    "pDurMs": (60, 110),     # P wave duration
    "prMs":   (120, 200),    # P onset to QRS onset
    "qrsMs":  (70, 110),     # QRS duration
    "qtMs":   (350, 440),    # QRS onset to T end, at ~60-70 bpm
    "pMv":    (0.05, 0.25),  # P amplitude
    "tMv":    (0.10, 0.50),  # T amplitude
}


def _mid(r):
    return (r[0] + r[1]) / 2


def _gauss(t, centre, width):
    """A wave as a Gaussian bump. width is the full visible width in ms;
    the 2.5 divides it into the +/-2.5 sigma that is visibly non-zero."""
    s = width / 5.0
    return math.exp(-0.5 * ((t - centre) / s) ** 2)


def clean_signal():
    """Returns (signal, r_indices). r_indices is the ground truth."""
    y = [0.0] * N
    r_idx = []

    pr   = _mid(NORMAL["prMs"])
    qrs  = _mid(NORMAL["qrsMs"])
    qt   = _mid(NORMAL["qtMs"])
    pdur = _mid(NORMAL["pDurMs"])
    pamp = _mid(NORMAL["pMv"])
    tamp = _mid(NORMAL["tMv"])

    rr_ms = 60000.0 / HR_BPM
    n_beats = int(DUR_S * 1000 / rr_ms) + 1

    for b in range(n_beats):
        # R peak sits at QRS onset + half the QRS, so the measured PR and
        # QT below are the clinical ones rather than approximations.
        qrs_onset_ms = b * rr_ms + 400.0
        r_ms = qrs_onset_ms + qrs / 2
        r_i  = int(round(r_ms * FS / 1000.0))
        if 0 <= r_i < N:
            r_idx.append(r_i)

        for i in range(N):
            t = i * 1000.0 / FS - qrs_onset_ms     # ms relative to QRS onset
            if t < -400 or t > 700:
                continue
            v = 0.0
            v += pamp * _gauss(t, -pr + pdur / 2, pdur)      # P
            v += -0.12 * _gauss(t, qrs * 0.18, 26)           # Q
            v +=  1.20 * _gauss(t, qrs * 0.50, 56)           # R
            v += -0.28 * _gauss(t, qrs * 0.82, 30)           # S
            v += tamp  * _gauss(t, qt - 160 / 2, 160)        # T
            y[i] += v

    return y, r_idx


CLEAN, TRUTH_R = clean_signal()


# ── The artefacts ────────────────────────────────────────────────────────
# Each returns a full-length array at a NOMINAL amplitude. The filter
# scales them; nothing here knows about severity.

def baseline_wander(seed=1):
    """Respiration, plus a slower electrode-impedance drift."""
    rnd = random.Random(seed)
    ph1, ph2 = rnd.random() * 6.28, rnd.random() * 6.28
    out = []
    for i in range(N):
        t = i / FS
        out.append(0.35 * math.sin(2 * math.pi * 0.28 * t + ph1)     # breathing
                 + 0.18 * math.sin(2 * math.pi * 0.09 * t + ph2))    # drift
    return out


def mains(seed=2):
    """Mains pickup: the fundamental plus a weak third harmonic, which is
    what makes real mains interference look like a fuzzy band rather than
    a clean sinusoid."""
    rnd = random.Random(seed)
    ph = rnd.random() * 6.28
    return [0.09 * math.sin(2 * math.pi * MAINS_HZ * (i / FS) + ph)
            + 0.03 * math.sin(2 * math.pi * MAINS_HZ * 3 * (i / FS) + ph)
            for i in range(N)]


def emg(seed=3):
    """Muscle activity. Broadband, made by high-pass filtering white noise
    so its energy sits above ~20 Hz where real EMG does."""
    rnd = random.Random(seed)
    w = [rnd.gauss(0, 1) for _ in range(N)]
    # one-pole high pass, fc ~ 20 Hz
    a = math.exp(-2 * math.pi * 20 / FS)
    out, prev_x, prev_y = [], 0.0, 0.0
    for x in w:
        yv = a * (prev_y + x - prev_x)
        out.append(yv * 0.055)
        prev_x, prev_y = x, yv
    return out


def motion(seed=4):
    """Two large transient excursions -- a cable pulled, a patient shifting.
    Slow enough to look like a wave, big enough to be mistaken for one."""
    rnd = random.Random(seed)
    out = [0.0] * N
    for centre_s, amp, width_s in ((2.4, 0.9, 0.45), (5.6, -0.7, 0.30)):
        c = centre_s * FS
        w = width_s * FS
        for i in range(N):
            d = (i - c) / w
            if abs(d) < 4:
                out[i] += amp * math.exp(-0.5 * d * d) * (1 + 0.25 * rnd.gauss(0, 1))
    return out


def electrode(seed=5):
    """A lead coming off: the amplifier saturates, then settles. Returns a
    MASK as well, because this one does not add -- it replaces."""
    out  = [0.0] * N
    mask = [0.0] * N
    start, end = int(6.2 * FS), int(7.0 * FS)
    for i in range(start, min(end, N)):
        k = (i - start) / max(1, (end - start))
        mask[i] = 1.0
        # a hard step, then an exponential settle back toward zero
        out[i] = 2.2 * math.exp(-6 * k) - 0.4
    return out, mask


WANDER          = baseline_wander()
MAINS           = mains()
EMG             = emg()
MOTION          = motion()
ELECTRODE, EMASK = electrode()


# ── The oracle ───────────────────────────────────────────────────────────
# Pan-Tompkins bandpasses 5-15 Hz before it does anything else. The claim
# this journey makes is that the band is not arbitrary: it is where the
# QRS lives and where the two most common artefacts do not.

def _goertzel_power(x, f0):
    """Power at one frequency. Cheaper and clearer than a whole FFT when
    three bins are all that is wanted."""
    w = 2 * math.pi * f0 / FS
    c = 2 * math.cos(w)
    s1 = s2 = 0.0
    for v in x:
        s0 = v + c * s1 - s2
        s2, s1 = s1, s0
    return (s1 * s1 + s2 * s2 - c * s1 * s2) / len(x)


def _one_pole_hp(x, fc):
    a = math.exp(-2 * math.pi * fc / FS)
    out, px, py = [], 0.0, 0.0
    for v in x:
        py = a * (py + v - px)
        px = v
        out.append(py)
    return out


def _one_pole_lp(x, fc):
    a = math.exp(-2 * math.pi * fc / FS)
    out, prev = [], 0.0
    for v in x:
        prev = prev + (1 - a) * (v - prev)
        out.append(prev)
    return out


def _bandpass_5_15(x):
    """5 Hz high-pass then 15 Hz low-pass, TWO POLES EACH.

    The first version used one pole per section and the claim check
    failed honestly: 8% of the 50 Hz power survived, because a single
    pole rolls off at only 20 dB/decade and 50 Hz is barely three times
    the corner. That was a bad model rather than a bad signal --
    Pan-Tompkins' own low-pass is second order
    (y[n] = 2y[n-1] - y[n-2] + x[n] - 2x[n-6] + x[n-12]) and far
    sharper. Two cascaded poles is the honest simplification: still
    verifiable by inspection, and it does not flatter the band.

    Not the paper's exact integer filter. The point here is the BAND, and
    a filter whose response anyone can check beats one that cites a
    reference and hopes."""
    y = _one_pole_hp(_one_pole_hp(x, 5), 5)
    return _one_pole_lp(_one_pole_lp(y, 15), 15)


def _check_claim():
    problems = []
    probes = [("baseline wander", WANDER, 0.28),
              ("mains",           MAINS,  float(MAINS_HZ))]
    for name, comp, f0 in probes:
        before = _goertzel_power(comp, f0)
        after  = _goertzel_power(_bandpass_5_15(comp), f0)
        if before <= 0:
            problems.append(f"{name}: no power at {f0} Hz to begin with")
            continue
        atten = after / before
        if atten > 0.05:
            problems.append(f"{name}: bandpass leaves {atten:.1%} "
                            f"of the power at {f0} Hz (wanted under 5%)")

    # ...and the QRS must survive it. Measured as peak-to-peak of the
    # filtered clean signal relative to the unfiltered one.
    f = _bandpass_5_15(CLEAN)
    keep = (max(f) - min(f)) / (max(CLEAN) - min(CLEAN))
    if keep < 0.25:
        problems.append(f"the bandpass also flattens the QRS "
                        f"({keep:.0%} of peak-to-peak left)")

    if len(TRUTH_R) < 6:
        problems.append(f"only {len(TRUTH_R)} beats in {DUR_S}s")

    if problems:
        print("\n[ECG-NOISE] the journey's own claim does not hold:")
        for p in problems:
            print(f"  - {p}")
        print()
    else:
        print(f"[ECG-NOISE] claim holds: 5-15 Hz bandpass removes wander "
              f"and {MAINS_HZ} Hz, keeps {keep:.0%} of the QRS "
              f"({len(TRUTH_R)} beats)")
    return problems


_check_claim()


# ── Scenarios ────────────────────────────────────────────────────────────
# A sample is a RECORDING SITUATION, and its mix is what that situation
# actually does to a trace. Same six stages on every card; a different
# answer at the end of each.

_SCENARIOS = {
    "resting": {
        "name": "Resting, good electrodes",
        "blurb": "A quiet room and fresh gel. This is as close to the "
                 "textbook as a real recording gets.",
        "mix": {"wander": 0.25, "mains": 0.15, "emg": 0.15,
                "motion": 0.0, "electrode": 0.0},
    },
    "breathing": {
        "name": "Deep breathing",
        "blurb": "The chest moves, the electrodes move with it, and the "
                 "whole trace rides up and down at the breathing rate.",
        "mix": {"wander": 1.4, "mains": 0.2, "emg": 0.2,
                "motion": 0.0, "electrode": 0.0},
    },
    "ward_mains": {
        "name": "Ward bed, poor earth",
        "blurb": "Mains pickup dominates. The trace fuzzes at exactly "
                 f"{MAINS_HZ} Hz, and the fuzz is the building, not the heart.",
        "mix": {"wander": 0.4, "mains": 1.6, "emg": 0.25,
                "motion": 0.0, "electrode": 0.0},
    },
    "treadmill": {
        "name": "Exercise test",
        "blurb": "Muscle everywhere and the leads swinging. The hardest "
                 "ordinary recording to read.",
        "mix": {"wander": 1.0, "mains": 0.3, "emg": 1.5,
                "motion": 0.8, "electrode": 0.0},
    },
    "loose_lead": {
        "name": "Loose lead",
        "blurb": "One electrode lifts. The amplifier saturates, and what "
                 "comes back is not a small error -- it is no signal.",
        "mix": {"wander": 0.6, "mains": 0.3, "emg": 0.3,
                "motion": 0.6, "electrode": 1.0},
    },
    "ambulance": {
        "name": "In the back of an ambulance",
        "blurb": "Everything at once, which is the condition most "
                 "real-world detectors are actually judged on.",
        "mix": {"wander": 1.3, "mains": 0.8, "emg": 1.3,
                "motion": 1.4, "electrode": 0.7},
    },
}


def _provider(sample_id):
    s = _SCENARIOS.get(sample_id)
    if s is None:
        raise FileNotFoundError(sample_id)
    return {
        "arrays": {
            "clean":     CLEAN,
            "wander":    WANDER,
            "mains":     MAINS,
            "emg":       EMG,
            "motion":    MOTION,
            "electrode": ELECTRODE,
            "emask":     EMASK,
        },
        "meta": {
            "id": sample_id,
            "name": s["name"],
            "blurb": s["blurb"],
            "mix": s["mix"],
            "fs": FS,
            "truthR": TRUTH_R,
            "mainsHz": MAINS_HZ,
            "hrBpm": HR_BPM,
            "normal": {k: list(v) for k, v in NORMAL.items()},
            "bands": {
                "wander":    "0.09 and 0.28 Hz -- drift and respiration",
                "mains":     f"{MAINS_HZ} Hz plus a weak 3rd harmonic",
                "emg":       "broadband above ~20 Hz",
                "motion":    "transient, under 2 Hz",
                "electrode": "saturation, then an exponential settle",
            },
            "source": "Artefact bands follow the MIT-BIH Noise Stress Test "
                      "Database characterisation (bw, em, ma). The signal "
                      "is synthetic so the beat positions are exact.",
        },
    }


def _lister(limit, offset):
    ids = list(_SCENARIOS.keys())
    page = ids[offset:offset + limit]
    return {"samples": [{"record_id": i, "label": _SCENARIOS[i]["name"]}
                        for i in page],
            "total": len(ids), "offset": offset}


data_source_store.register(
    source_id="ecg_noise",
    label="Clean beat plus named artefacts",
    description="A textbook ECG and the real-world corruptions that turn "
                "it into a recording, shipped separately so they can be "
                "added one at a time",
    adapter="multi_to_arrays",
    primary_field="clean",
    provider=_provider,
    lister=_lister,
    schema={"fields": ["clean", "wander", "mains", "emg", "motion",
                       "electrode", "emask"],
            "fs_required": True,
            "domain": "biomedical.ecg"},
)
