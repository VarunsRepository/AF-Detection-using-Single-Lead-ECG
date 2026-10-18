# ---------------------------------------------------------------------------
# catalog/sources/aero.py
#
# Fan cars: a sealed volume under the car, a fan pulling air out of it, and
# atmospheric pressure doing the rest.
#
# HOW HONEST THESE NUMBERS ARE -- read this before quoting any of them
#   Masses and years are documented. ALMOST NOTHING ELSE IS. Nobody
#   published the BT46B's fan flow rate or its sealed plan area, and
#   Tesla has published no fan specification at all. The figures below
#   marked "est" are plausible values chosen to put a real car in a real
#   ballpark; they are NOT measurements and the journey says so on screen.
#
#   This matters because the journey would be worthless if it implied
#   otherwise. What it teaches is the SHAPE of the relationship --
#   downforce independent of speed, and pressure going as 1/gap^2 -- and
#   that shape is a property of the model, not of the specific car.
#
#   tag meanings:
#     spec   documented figure
#     est    plausible illustrative value, NOT a measurement
#     claim  the manufacturer's assertion, independently unverified
#
# WHY THE SCALARS LIVE IN meta
#   A car is a handful of numbers, not a signal. Same shape as the
#   pathway source: arrays carries one dummy element so the adapter has
#   something to normalise, and everything real travels in meta.
# ---------------------------------------------------------------------------

from Services.data_source_store import data_source_store

RHO_AIR = 1.225          # kg/m3, sea level, 15C
G = 9.80665


CARS = {
    "fan_chaparral": {
        "name": "Chaparral 2J",
        "year": 1970,
        "note": "Can-Am, 1970 -- the first of them, with Lexan skirts",
        "mass_kg": 820,          # spec
        "sealedArea_m2": 3.0,    # est
        "sealPerimeter_m": 10.0, # est
        "skirtGap_mm": 6.0,      # est
        # Two 17-inch fans driven by a 45hp two-stroke, separate from the
        # main engine -- which is why its suction did NOT vary with road
        # speed or throttle. That independence is the whole idea.
        "fanQmax_m3s": 4.5,      # est
        "fanDPmax_Pa": 4500,     # est
        "wingArea_m2": 1.6,      # est
        "wingCl": 1.6,           # est
        "thrust_N": None,
        "tags": {"mass_kg": "spec", "sealedArea_m2": "est",
                 "sealPerimeter_m": "est", "skirtGap_mm": "est",
                 "fanQmax_m3s": "est", "fanDPmax_Pa": "est",
                 "wingArea_m2": "est", "wingCl": "est"},
    },

    "fan_bt46b": {
        "name": "Brabham BT46B",
        "year": 1978,
        "note": "Won the 1978 Swedish GP, then withdrawn",
        "mass_kg": 590,          # spec-ish: 1978 F1 minimum was 575kg
        "sealedArea_m2": 2.2,    # est
        "sealPerimeter_m": 9.0,  # est
        "skirtGap_mm": 5.0,      # est
        # Driven off the gearbox, so fan speed followed ENGINE speed. That
        # is what let Murray argue it was a cooling device, and also what
        # made it legal-ish: the downforce rose with revs, not with road
        # speed, which is a distinction the rulebook had not anticipated.
        "fanQmax_m3s": 3.5,      # est
        "fanDPmax_Pa": 5000,     # est
        "wingArea_m2": 1.4,      # est
        "wingCl": 1.8,           # est
        "thrust_N": None,
        "tags": {"mass_kg": "spec", "sealedArea_m2": "est",
                 "sealPerimeter_m": "est", "skirtGap_mm": "est",
                 "fanQmax_m3s": "est", "fanDPmax_Pa": "est",
                 "wingArea_m2": "est", "wingCl": "est"},
    },

    "fan_roadster": {
        "name": "Tesla Roadster",
        "year": 2026,
        "note": "Fan and deployable skirts -- and a claim to check",
        "mass_kg": 2000,         # est
        "sealedArea_m2": 3.0,    # est
        "sealPerimeter_m": 11.0, # est
        "skirtGap_mm": 4.0,      # est
        # NO FAN SPECIFICATION IS PUBLISHED, so none is invented here.
        # Leaving these null makes stage 3 run the arithmetic BACKWARDS
        # instead: given the claimed downforce, what underbody pressure
        # does it demand? That question needs no proprietary numbers and
        # cannot be fudged.
        "fanQmax_m3s": None,
        "fanDPmax_Pa": None,
        "wingArea_m2": 1.8,      # est
        "wingCl": 1.4,           # est
        "claimedG": 2.0,         # claim
        "claimedUpsideDown": True,
        # Cold-gas thrusters, a SEPARATE system from the fan. vE and gas
        # mass are estimates: cold gas runs about Isp 60-75s, so an
        # exhaust velocity near 700 m/s. Tesla has published neither the
        # tank capacity nor a burn time.
        "thrust_N": 80000,       # claim
        "exhaustVel_ms": 700,    # est
        "gasMass_kg": 20,        # est
        "tags": {"mass_kg": "est", "sealedArea_m2": "est",
                 "sealPerimeter_m": "est", "skirtGap_mm": "est",
                 "wingArea_m2": "est", "wingCl": "est",
                 "claimedG": "claim", "thrust_N": "claim",
                 "exhaustVel_ms": "est", "gasMass_kg": "est"},
    },
}


def _provider(sample_id: str) -> dict:
    car = CARS.get(sample_id)
    if car is None:
        raise FileNotFoundError(sample_id)
    meta = dict(car)
    meta["rho"] = RHO_AIR
    meta["g"] = G
    # Orifice discharge coefficient for a thin-edged gap. 0.6 is the
    # textbook value and the model is not sensitive enough to it for a
    # better one to change any conclusion here.
    meta["cd"] = 0.6
    # The scalars are the payload; the array exists only so the adapter
    # has something of the expected shape to normalise.
    return {"arrays": {"scenario": [1]}, "meta": meta}


def _lister(limit: int, offset: int) -> dict:
    ids = list(CARS.keys())
    page = ids[offset:offset + limit]
    return {"samples": [{"record_id": i,
                         "label": f"{CARS[i]['name']} — {CARS[i]['note']}"}
                        for i in page],
            "total": len(ids), "offset": offset}


data_source_store.register("fan_cars",
    provider      = _provider,
    lister        = _lister,
    adapter       = "multi_to_arrays",
    primary_field = "scenario",
    fs_field      = None,
    label         = "Fan car parameters",
    description   = "Mass, sealed area, skirt perimeter and fan characteristic",
    schema        = {"fields": ["meta.mass_kg", "meta.sealedArea_m2",
                                "meta.sealPerimeter_m", "meta.skirtGap_mm"],
                     "fs": None, "domain": "physics.aero"})
