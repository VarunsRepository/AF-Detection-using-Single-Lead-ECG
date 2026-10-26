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
# THREE LEVELS, ONE MECHANISM
#   /seed          one card per DOMAIN      -- the front door
#   /tour/ecg      one card per JOURNEY     -- the domain
#   /journey/ecg   every RECORD, paginated  -- the journey
#
#   Each level is the same question asked again: more of this? And each
#   level is the same data structure -- the front door is a tour whose
#   stops happen to lead to other tours, so it needs no new store, no new
#   route and no new renderer. A tour of tours is still a tour.
#
#   The master tour is DERIVED from the others (see MASTER_ORDER below).
#   Hand-writing it would mean the same sample ids maintained in two
#   places, and the second place is always the one that goes stale.
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
#   tour      optional, and ONLY the master tour sets it. It names where
#             the card's "more from" chip should go. With it the chip
#             leads to /tour/<tour>; without it, to /journey/<journey>.
#             That one key is the whole difference between the two
#             levels -- the client has no other way to know which one it
#             is looking at, and hardcoding /journey/ would make the
#             front door skip the middle level entirely and drop a
#             first-time viewer into 8,528 recordings.
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

    # EVERY journey, one card each. This is what "seed" used to be, and
    # it is kept because it is the only page that proves all fifteen
    # journeys still render -- a smoke test you can watch. It is no
    # longer the front door: fifteen flat cards is a long scroll for a
    # first visit, and being flat it says nothing about ECG having four
    # journeys and crypto having four.
    "everything": {
        "label": "Every journey",
        "description": "One card from every journey, across every domain.",
        "stops": [
            {"journey": "ecg_primer",     "sample": None},
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
        "description": "Start from a flat line and end with a beat "
                       "detector, in five short steps.",
        "stops": [
            # THE PRIMER GOES FIRST, and that one line also changes the
            # front door: MASTER_ORDER["ecg"] is None, meaning "this
            # tour's first stop", so /seed now opens on the primer
            # instead of on a raw ECG sweep. Deriving the master tour
            # rather than hand-writing it is what makes that automatic.
            #
            # It also retires an open item. The front door's ECG card
            # used to be pixel-identical to /journey/ecg's first card --
            # same journey, same stage, same recording -- which read as
            # "did it redirect me?". A primer that opens on a flat line
            # cannot be confused for anything else.
            {"journey": "ecg_primer", "sample": None,
             "label": "What a heartbeat looks like"},
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

# ── The master tour ──────────────────────────────────────────────────────
#
# The front door. One card per domain, each leading into that domain's
# own tour.
#
# Keys are tour names, in play order. The value picks WHICH of that
# tour's stops represents it:
#
#   None        that tour's first stop
#   "<journey>" the tour's stop for that journey instead
#
# WHY AN OVERRIDE EXISTS AT ALL, when deriving from stops[0] would be
# simpler: a tour's first stop is chosen to OPEN A SEQUENCE, which
# usually means the gentlest one. The master tour is a cold open to a
# stranger with no context, so it wants the domain's LOUDEST card. Those
# are rarely the same card. "hardware" is the clear case -- two chips
# agreeing on a clock is a good way into the domain and a forgettable
# first impression; a car sucking itself to the tarmac is not.
#
# What is NOT overridable is the sample. The stop is taken whole, so the
# sample id lives in exactly one place: the sub-tour that owns it.
MASTER_ORDER = {
    # Left on None ON PURPOSE, now that the ECG tour opens with the
    # primer. The earlier argument for an override here was that a bare
    # ECG sweep is the plainest card in the app and a poor cold open;
    # the primer is the opposite of that, and it teaches rather than
    # merely impressing, which is the better job for a first card.
    "ecg":      None,
    "life":     None,
    "crypto":   "aes_round",   # the FIPS-197 worked example, not the toy SPN
    "compute":  None,
    "hardware": "suction",     # see above
}


def build_master_stops(tours: dict, order: dict) -> tuple[list, list]:
    """
    Derive the master tour's stops from the tours they lead into.

    Returns (stops, problems). Reports rather than raises, and falls back
    to a tour's first stop when an override names a journey that tour
    does not contain -- a wrong override should cost a log line and a
    slightly duller card, not a missing front door.

    The derived stop keeps the SUB-TOUR's label, not the journey's: the
    card is standing for a whole domain, so it should read "Reading a
    heartbeat", not "Finding every beat".

    A derived stop with sample=None resolves at request time from the
    same lister, at cursor 0, as the sub-tour's own first card -- so the
    recording on the front door is the recording the tour opens with.
    Continuity for free; nothing has to coordinate for it.
    """
    stops, problems = [], []

    for tour_name, pick in order.items():
        spec = tours.get(tour_name)
        if not spec:
            problems.append(
                f'MASTER_ORDER names tour "{tour_name}", which does not '
                f'exist -- the front door will be one card short')
            continue

        candidates = spec.get("stops") or []
        if not candidates:
            problems.append(
                f'MASTER_ORDER names tour "{tour_name}", which has no stops')
            continue

        chosen = candidates[0]
        if pick is not None:
            match = next((s for s in candidates
                          if s.get("journey") == pick), None)
            if match is None:
                problems.append(
                    f'MASTER_ORDER["{tour_name}"] = "{pick}" but that tour '
                    f'has no stop for it -- falling back to its first stop '
                    f'("{chosen.get("journey")}")')
            else:
                chosen = match

        stops.append({
            "journey": chosen.get("journey"),
            "sample":  chosen.get("sample"),
            "label":   spec.get("label", tour_name),
            "tour":    tour_name,
        })

    return stops, problems


_master_stops, _master_problems = build_master_stops(TOURS, MASTER_ORDER)

# Inserted FIRST so it leads /api/tours and any future index page. The
# name stays "seed" because /seed is already shared in the wild and
# people forward links without reading them.
TOURS = {
    "seed": {
        "label": "Start here",
        "description": "One card from each thing this explains. "
                       "Tap any of them for more.",
        "stops": _master_stops,
    },
    **TOURS,
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

    def note(self, problem: str) -> None:
        """
        Record a problem found OUTSIDE register() -- the master tour's
        derivation, currently. Same report, one place to look.
        """
        self._problems.append(problem)

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

    def check_stop_tours(self) -> list:
        """
        A stop's optional "tour" key is a CHIP TARGET -- the client turns
        it into /tour/<name> with no further checking. A typo there is a
        404 the viewer meets, not one the server does, so it is worth
        catching here. Same reasoning as check_journeys_exist, same
        reason it runs late: every tour must be registered first.
        """
        bad = []
        for name, tour in self._tours.items():
            for stop in tour.get("stops", []):
                target = stop.get("tour")
                if target and target not in self._tours:
                    bad.append(f'tour "{name}" has a stop whose chip points '
                               f'at tour "{target}", which does not exist '
                               f'-- that chip would 404')
        return bad

    def report(self) -> None:
        problems = (self._problems
                    + self.check_journeys_exist()
                    + self.check_stop_tours())
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

# Derivation problems join the same report, so there is one place to look
# at startup rather than two.
for _p in _master_problems:
    tour_store.note(_p)

tour_store.report()