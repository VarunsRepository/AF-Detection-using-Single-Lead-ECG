# ---------------------------------------------------------------------------
# catalog/page_meta.py
#
# What a link preview says, per journey.
#
# WHY THIS IS NOT DERIVED FROM THE RECIPE
#
#   The recipe has a label -- "ECG", "DWT" -- but that is UI copy, written
#   for someone already inside the app and looking at the thing. A link
#   preview is read by someone who has not arrived yet and is deciding
#   whether to, and on a CV that someone is deciding something else as
#   well. Those are different jobs and they want different words.
#
#   One shared site-level description ("short animated explainers") is
#   accurate and useless: it describes the format, not the work. A
#   recruiter reading it files you under educational content and never
#   learns that the ECG journey is Pan-Tompkins implemented from the 1985
#   paper and checked against a validated library.
#
# WHY IT LIVES IN catalog/ AND NOT IN THE BLUEPRINT
#
#   Same rule this repo already follows: journey_bp.py is routes, catalog
#   is content. Preview copy is content. Adding a journey should not mean
#   editing the blueprint, and neither should rewording one.
#
# THE TIDIER END STATE
#
#   This arguably belongs ON the recipe, next to the stages it describes
#   -- a "pageMeta" block in each catalog/journeys/*.py, surfaced by
#   build_journey(). That is one line in journey_store and one optional
#   block per recipe. It is better because the copy then cannot drift
#   away from the journey it describes. This dict is the version that
#   needs no recipe edits today; move it when the list stops changing.
# ---------------------------------------------------------------------------

SITE_URL = "https://www.kymograph.dev"
DEFAULT_IMAGE = f"{SITE_URL}/static/icons/og_preview.png?v=1"

# Site level. Used for /feed, /shorts, /seed and any journey without an
# entry below -- deliberately generic, because a generic page is what it
# describes.
SITE_META = {
    "title": "Kymograph",
    "description": ("Algorithms, one step at a time. Short animated "
                    "explainers for signal processing, cryptography and "
                    "biochemistry."),
    "image": DEFAULT_IMAGE,
}

# Per journey. Each description names the ALGORITHM and what was actually
# built, because that is the claim being made. "Watch an ECG be analysed"
# is a description of a video; "Pan-Tompkins implemented from the 1985
# paper" is a description of engineering.
#
# Keep them under ~160 characters: LinkedIn and Twitter truncate past
# that, and a sentence that ends mid-word reads as carelessness on the
# one surface where carelessness is most expensive.
JOURNEY_META = {
    "ecg": {
        "title": "Pan-Tompkins QRS detection, step by step — Kymograph",
        "description": ("The 1985 Pan-Tompkins algorithm implemented from "
                        "the paper and run on PhysioNet records: bandpass, "
                        "derivative, squaring, integration, adaptive "
                        "thresholding."),
                        "image": f"{SITE_URL}/static/icons/og_ecg.png?v=1",
    },
    "beats": {
        "title": "Heart rate variability from RR intervals — Kymograph",
        "description": ("Beat-to-beat intervals turned into HRV: time-domain "
                        "measures, a Poincaré plot, and what the shape of "
                        "the scatter actually tells you."),
    },
    "dwt": {
        "title": "Daubechies-4 wavelet decomposition — Kymograph",
        "description": ("A signal pulled apart into detail and approximation "
                        "bands by the discrete wavelet transform, one level "
                        "at a time, with each band shown as it is removed."),
                        "image": f"{SITE_URL}/static/icons/og_dwt.png?v=1",                        
    },
    "spectrum": {
        "title": "Spectral decomposition of a signal — Kymograph",
        "description": ("Where the energy in a waveform actually sits: the "
                        "frequency domain built up band by band from the "
                        "time-domain trace."),
    },
    "simd": {
        "title": "SIMD: one instruction, many lanes — Kymograph",
        "description": ("Vector registers processing several values per "
                        "instruction, drawn lane by lane — why the same "
                        "arithmetic runs several times faster."),
    },
    "sha1": {
        "title": "SHA-1 compression, round by round — Kymograph",
        "description": ("Eighty rounds of the SHA-1 compression function "
                        "with the internal state shown at every step, and "
                        "why a one-bit change scrambles all of it."),
    },
    "aes_round": {
        "title": "Inside one AES round — Kymograph",
        "description": ("SubBytes, ShiftRows, MixColumns and AddRoundKey "
                        "applied to the state grid, each transformation "
                        "shown on the bytes it touches."),
    },
    "aes_expansion": {
        "title": "AES key expansion — Kymograph",
        "description": ("How one key becomes eleven round keys: rotation, "
                        "substitution and the round constant, traced through "
                        "the whole schedule."),
    },
    "spn": {
        "title": "A substitution-permutation network — Kymograph",
        "description": ("Confusion and diffusion at the bit level: how an "
                        "SPN turns a single flipped input bit into an "
                        "unrecognisable output."),
    },
    "pathway": {
        "title": "Metabolic pathways as a walk — Kymograph",
        "description": ("The citric acid cycle and others as species and "
                        "reactions, walked one step at a time — block a "
                        "step and watch the downstream stall."),
                        "image": f"{SITE_URL}/static/icons/og_pathway.png?v=1",                        
    },
    "ets": {
        "title": "The electron transport chain — Kymograph",
        "description": ("Electrons handed down the respiratory complexes, "
                        "the proton gradient they build, and the ATP that "
                        "comes out the other end."),
    },
    "photosynthesis": {
        "title": "Photosynthesis, light to sugar — Kymograph",
        "description": ("From a photon striking a leaf to a carbon fixed in "
                        "the Calvin cycle, drawn as one continuous chain "
                        "rather than two unrelated diagrams."),
    },
    "protocols": {
        "title": "UART, SPI, I²C and CAN, decoded off the wire — Kymograph",
        "description": ("Four buses as signals rather than diagrams — the "
                        "instants a receiver samples the line, and what "
                        "happens when two devices disagree about them."),
        "image": f"{SITE_URL}/static/icons/og_protocols.png?v=1",
    },
        "simd": {
        "title": "SIMD: four sums, one instruction — Kymograph",
        "description": ("A 128-bit register holds four values side by side "
                        "and adds them together. Plus the packing step that "
                        "can cost more than the arithmetic saves."),
        "image": f"{SITE_URL}/static/icons/og_simd.png?v=1",
    },
    "spn": {
        "title": "Confuse, then diffuse: an SPN cipher — Kymograph",
        "description": ("Heys' 16-bit cipher, small enough to draw every bit. "
                        "Substitution stays inside a nibble; the permutation "
                        "scatters bits across all four."),
        "image": f"{SITE_URL}/static/icons/og_spn.png?v=1",
    },
        "aes_round": {
        "title": "Inside an AES round, step by step — Kymograph",
        "description": ("SubBytes changes every byte without moving one; "
                        "ShiftRows moves them without changing one. Ten "
                        "rounds, four operations, drawn on a 4x4 grid."),
        "image": f"{SITE_URL}/static/icons/og_aes_round.png?v=1",
    },
    "aes_expansion": {
        "title": "AES key expansion: eleven keys from one — Kymograph",
        "description": ("RotWord, SubWord and a round constant transform one "
                        "word of the previous key; the rest cascade by XOR. "
                        "Ten rounds need eleven keys."),
        "image": f"{SITE_URL}/static/icons/og_aes_expansion.png?v=1",
    },
        "spectrum": {
        "title": "Where the energy lives: an ECG spectrum — Kymograph",
        "description": ("A recording can look clean in time and still carry a "
                        "quarter of its power at 50 Hz. The same ECG as a "
                        "Welch power spectrum, band by band."),
        "image": f"{SITE_URL}/static/icons/og_spectrum.png?v=1",
    },
        "beats": {
        "title": "Every ECG beat, overlaid on its own R — Kymograph",
        "description": ("Each beat re-centred on its R-apex so they stack. A "
                        "tight bundle is consistent morphology; fuzz where P "
                        "should be is the atria fibrillating."),
        "image": f"{SITE_URL}/static/icons/og_beats.png?v=1",
    },
        "silicon": {
        "title": "What \u201c3nm\u201d actually measures \u2014 Kymograph",
        "description": ("Fifty years of transistor counts, and two reasons "
                        "not to trust them: a node label that stopped "
                        "tracking density, and packages counted as chips."),
        "image": f"{SITE_URL}/static/icons/og_silicon.png?v=1",
    },
}


def meta_for(journey_name: str | None = None, path: str = "/") -> dict:
    """
    Preview copy for a page. Always returns a complete dict, so the
    template never needs a conditional and a journey with no entry
    degrades to the site-level copy rather than to empty tags.

    `url` is built here rather than from request.url_root: Open Graph
    wants ONE canonical address per page, and url_root reflects however
    the visitor happened to arrive -- www or bare, http or https behind a
    proxy. Two spellings of the same page means two cache entries at
    every scraper and a share count split between them.
    """
    meta = dict(SITE_META)
    if journey_name:
        meta.update(JOURNEY_META.get(journey_name, {}))
    meta.setdefault("image", DEFAULT_IMAGE)
    meta["url"] = f"{SITE_URL}{path}"
    return meta
