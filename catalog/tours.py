# ---------------------------------------------------------------------------
# catalog/tours.py
#
# A TOUR is an ordered set of cards, shared as ONE link.
#
#   /journey/ecg      every ECG record, one journey, paginated forever
#   /tour/ecg         four chosen cards across four journeys, then it ends
#
# Tours are pure data, exactly like recipes: a list of journey names and
# (optionally) which sample each stop should use. They name nothing a
# recipe does not already know.
#
# WHY THIS IS NOT IN journey_bp.py ANY MORE
#   SEED_TOUR lived in the routes file, which is the thing the catalog
#   split in section 24 existed to prevent. It was edited thirteen times
#   before anyone noticed. Routes stay generic; content lives here.
#
# A STOP
#   {"journey": "ecg", "sample": None, "label": "Finding the beats"}
#
#   journey   required. Must be a registered journey name.
#   sample    a specific record id, or None to take the next one from
#             that journey's own source. None is right when any record
#             makes the point (ECG recordings); a named id is right when
#             a PARTICULAR one is the point -- aes_fips197 is the
#             FIPS-197 worked example, and a random block would not be.
#   label     optional. The feed already carries this through to
#             analytics (journey_scroll_feed.js: `label: entry.label`).
#
#   THE SOURCE IS NOT DECLARED. It is read from the journey's own stage 0
#   at request time. An earlier draft made each stop name its source and
#   that is duplicated truth: a tour could name a source the recipe does
#   not use, and nothing would catch it.
#
# THE ONE HARD RULE
#   EVERY sampleId MUST BE UNIQUE WITHIN A TOUR. The feed keys a running
#   journey by sampleId, so a repeat is treated as already playing and
#   never starts -- a blank card with no error anywhere. Checked at
#   import for fixed samples, and again at request time once the
#   lister-drawn ones are known.
#
#   This also sets a real limit: a tour CANNOT show the same sample twice
#   under different conditions. Same journey with DIFFERENT samples is
#   fine. If that limit ever bites, the fix is keying the feed by card
#   index rather than sampleId, which is a client change.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store


# ── The tours ────────────────────────────────────────────────────────────

TOURS = {

    # The sampler. One card per journey, every domain the engine runs.
    # This is what /seed has always served, and /seed still does.
    "seed": {
        "label": "What this thing does",
        "description": "One card from every journey, across every domain.",
        "stops": [
            {"journey": "ecg",            "sample": None},
            {"journey": "beats",          "sample": None},
            {"journey": "spectrum",       "sample": None},
            {"journey": "dwt",            "sample": None},
            {"journey": "aes_round",      "sample": "aes_fips197"},
            # A DIFFERENT block from aes_round above -- the uniqueness
            # rule, and it reads better too: key expansion depends on the
            # KEY, so a second key gives a visibly different schedule.
            {"journey": "aes_expansion",  "sample": "aes_ascii"},
            {"journey": "spn",            "sample": "spn_classic"},
            {"journey": "sha1",           "sample": "sha1_abc"},
            {"journey": "simd",           "sample": "simd_basic"},
            {"journey": "silicon",        "sample": "moore_x86"},
            {"journey": "protocols",      "sample": None},
            {"journey": "ets",            "sample": "ets_nadh"},
            {"journey": "photosynthesis", "sample": "photo_c4_hot"},
            {"journey": "pathway",        "sample": "path_tca"},
            {"journey": "suction",        "sample": "fan_bt46b"},
        ],
    },

    # The one this feature was actually built for: "share all the ECG
    # journeys as a single link". Four stops, four journeys, four
    # different recordings -- the per-source cursor handles that.
    "ecg": {
        "label": "Reading a heartbeat",
        "description": "Four ways to look at the same kind of signal.",
        "stops": [
            {"journey": "ecg",      "sample": None,
             "label": "Finding every beat"},
            {"journey": "beats",    "sample": None,
             "label": "All of them, overlaid"},
            {"journey": "spectrum", "sample": None,
             "label": "Where the energy lives"},
            {"journey": "dwt",      "sample": None,
             "label": "One signal, pulled apart"},
        ],
    },

    "crypto": {
        "label": "How ciphers scramble",
        "description": "Two ciphers and a hash, step by step.",
        "stops": [
            {"journey": "aes_round",     "sample": "aes_fips197",
             "label": "Inside an AES round"},
            {"journey": "aes_expansion", "sample": "aes_ascii",
             "label": "Eleven keys from one"},
            {"journey": "spn",           "sample": "spn_classic",
             "label": "Confuse, then diffuse"},
            {"journey": "sha1",          "sample": "sha1_abc",
             "label": "No key, no way back"},
        ],
    },

    "compute": {
        "label": "How code runs",
        "description": "One instruction, and fifty years of them.",
        "stops": [
            {"journey": "simd",    "sample": "simd_basic",
             "label": "Four sums, one instruction"},
            {"journey": "silicon", "sample": "moore_x86",
             "label": "Fifty years of doubling"},
        ],
    },

    "life": {
        "label": "Chemistry that keeps you alive",
        "description": "Energy, carbon, and what happens when a step is blocked.",
        "stops": [
            {"journey": "ets",            "sample": "ets_nadh",
             "label": "The electron transport chain"},
            {"journey": "photosynthesis", "sample": "photo_c4_hot",
             "label": "C3, C4 and CAM"},
            {"journey": "pathway",        "sample": "path_tca",
             "label": "The citric acid cycle"},
        ],
    },

    "hardware": {
        "label": "Things made of silicon and air",
        "description": "How chips talk, how they scaled, and one that cheats.",
        "stops": [
            {"journey": "protocols", "sample": None,
             "label": "How two chips agree"},
            {"journey": "silicon",   "sample": "moore_all",
             "label": "What 3nm actually measures"},
            {"journey": "suction",   "sample": "fan_bt46b",
             "label": "Downforce without speed"},
        ],
    },
}

DEFAULT_TOUR = "seed"


# ── Store ────────────────────────────────────────────────────────────────

class TourStore:
    """
    Thin. There is nothing to resolve -- a tour names journeys and the
    journey store already resolves those.

    It exists so the checks happen ONCE AT IMPORT, loudly, instead of per
    request: that a stop names a real journey, and that fixed sample ids
    do not repeat. Same instinct as the [SCHEMA] undeclared report --
    a problem you find at startup costs a log line; the same problem
    found in the browser costs an evening.

    REPORTS, NEVER RAISES. One bad tour must not stop the app booting.
    """

    def __init__(self):
        self._tours = {}
        self._problems = []

    def register(self, name: str, tour: dict) -> None:
        stops = tour.get("stops") or []
        if not stops:
            self._problems.append(f'tour "{name}" has no stops')
            return

        for i, stop in enumerate(stops):
            if not stop.get("journey"):
                self._problems.append(f'tour "{name}" stop {i} has no journey')

        # Fixed samples only -- lister-drawn ones are not known until a
        # request, and are re-checked there.
        seen = {}
        for stop in stops:
            sid = stop.get("sample")
            if sid is None:
                continue
            if sid in seen:
                self._problems.append(
                    f'tour "{name}": sample "{sid}" is used by both '
                    f'"{seen[sid]}" and "{stop["journey"]}". The feed keys '
                    f'journeys by sampleId, so the second card will render '
                    f'BLANK. Give each stop its own sample.')
            seen[sid] = stop["journey"]

        self._tours[name] = tour

    def get(self, name: str) -> dict | None:
        return self._tours.get(name)

    def names(self) -> list:
        return list(self._tours.keys())

    def list_all(self) -> list:
        return [{"name": n,
                 "label": t.get("label", n),
                 "description": t.get("description", ""),
                 "stops": len(t.get("stops", []))}
                for n, t in self._tours.items()]

    def check_journeys_exist(self) -> list:
        """
        Run AFTER every journey is registered. Kept separate from
        register() because a tour module could in principle be imported
        before the journeys it names, and a false alarm at startup is
        worse than a late one.
        """
        known = {e["name"] for e in journey_store.list_all_journeys()}
        missing = []
        for name, tour in self._tours.items():
            for stop in tour.get("stops", []):
                j = stop.get("journey")
                if j and j not in known:
                    missing.append(f'tour "{name}" names journey "{j}", '
                                   f'which is not registered')
        return missing

    def report(self) -> None:
        problems = self._problems + self.check_journeys_exist()
        if problems:
            print(f"\n[TOURS] {len(problems)} problem(s):")
            for p in problems:
                print(f"  - {p}")
            print()
        else:
            print(f"[TOURS] {len(self._tours)} tour(s) valid: "
                  f"{', '.join(self._tours)}")


tour_store = TourStore()

for _name, _tour in TOURS.items():
    tour_store.register(_name, _tour)

tour_store.report()
