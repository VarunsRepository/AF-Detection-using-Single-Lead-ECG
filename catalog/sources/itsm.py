# ---------------------------------------------------------------------------
# catalog/sources/itsm.py
#
# Service-management queues, as records. Each sample is one real situation
# a service desk lives in, expressed as the three numbers that actually
# determine how it feels: arrival rate, handling time, and how many people
# can work it.
#
# MODEL, NOT MEASUREMENT -- and this matters more here than anywhere else
# in the app.
#   The ECG journeys read PhysioNet recordings: real patients, real
#   electrodes, with expert annotations to check against. There is no
#   PhysioNet for incident tickets. Nothing here was measured. Every
#   sample is a PARAMETERISED MODEL whose numbers were chosen to be
#   plausible for the situation named, and the cards must say so.
#
#   What is NOT a guess is the mathematics. Given lambda, mu and c, the
#   wait is not an opinion -- Erlang C gives it in closed form and a
#   discrete-event simulation reaches the same number from a completely
#   different direction. So the structure of the answer ("at 0.90 you
#   wait 93x what you wait at 0.50") is exact, while the inputs are
#   illustrative. That is the honest split, and it is the opposite way
#   round from the ECG journeys, where the data is real and the
#   algorithm is the thing under test.
#
# WHY THESE SEVEN
#   Each one breaks a different intuition, and three of them break the
#   formula itself -- which is the most useful thing a journey about a
#   formula can do:
#
#     l1_storm        high load, many agents       the ordinary case
#     l2_escalation   the classic bottleneck       load you can feel
#     p1_bridge       LOW load, terrible wait      c matters, not just rho
#     prb_backlog     rho > 1                      no formula; it diverges
#     vendor_pending  not a queue at all           a delay, zero agent load
#     change_drain    a burst, not a steady state  Erlang C does not apply
#     p_tasks         deterministic service        half the wait, same people
#
# UNITS
#   Everything is per HOUR except the problem-management sample, which is
#   per WEEK -- a PRB that takes a fortnight expressed in hours produces
#   numbers nobody can read. unit_label travels with the sample so the
#   renderer never has to guess, and so a wait of 0.28 can be printed as
#   "17 min" rather than as a bare decimal.
# ---------------------------------------------------------------------------

from Services.data_source_store import data_source_store


def _q(record_id, name, tier, lam, mean_service, agents,
       service="exponential", unit="hr", unit_label="hour",
       sla=None, kind="queue", note="", lesson=""):
    """
    One scenario.

    lam           arrivals per unit
    mean_service  mean handling time, IN THE SAME UNIT
    agents        c -- people who can actually work this queue
    service       "exponential" (ordinary human work, highly variable)
                  "deterministic" (scheduled, fixed-length work)
    kind          "queue"   a server queue; Erlang C applies
                  "delay"   a wait that consumes NO agent (vendor pending)
                  "burst"   non-stationary; steady-state formulae do not
                            apply and the simulation is the only answer
    """
    mu = 1.0 / mean_service
    a  = lam / mu                 # offered load, in erlangs
    return {
        "record_id": record_id, "name": name, "tier": tier,
        "lam": lam, "mu": mu, "agents": agents,
        "mean_service": mean_service,
        "service": service, "kind": kind,
        "unit": unit, "unit_label": unit_label,
        "sla": sla, "note": note, "lesson": lesson,
        "offered": a,
        # rho is reported, never used to decide anything: a sample with
        # rho > 1 is exactly the case that must NOT be quietly clamped.
        "rho": a / agents if agents else float("inf"),
    }


SAMPLES = {s["record_id"]: s for s in [

    # ── The ordinary case, so the others have a baseline ────────────────
    _q("l1_storm",
       "Monday 09:00, password resets",
       "L1 service desk",
       lam=120.0, mean_service=4.0 / 60, agents=10,
       sla=30 / 60,
       note="120 contacts an hour, four minutes each, ten agents",
       lesson="Eighty percent loaded sounds comfortable. Four callers in "
              "ten still wait."),

    # ── Load you can feel, and the one everyone recognises ──────────────
    _q("l2_escalation",
       "Escalations waiting for L2",
       "L2 application support",
       lam=14.0, mean_service=45.0 / 60, agents=12,
       sla=4.0,
       note="Fourteen escalations an hour, forty-five minutes each, "
            "twelve analysts",
       lesson="At 0.875 the average escalation sits for seventeen minutes "
              "before anyone opens it -- and that is the AVERAGE."),

    # ── The one that breaks the intuition that rho is the whole story ───
    _q("p1_bridge",
       "P1 bridge, waiting for an incident manager",
       "Major incident management",
       lam=0.4, mean_service=3.5, agents=2,
       sla=0.25,
       note="A P1 every two and a half hours, three and a half hours to "
            "run, two incident managers",
       lesson="Only 70% loaded -- better than the service desk -- and a P1 "
              "still waits over three hours. With two people there is "
              "nowhere for a second P1 to go."),

    # ── rho > 1. No formula, and no amount of triage fixes it ───────────
    _q("prb_backlog",
       "Problem management backlog",
       "Problem management",
       lam=6.0, mean_service=1.0 / 1.25, agents=2,
       unit="wk", unit_label="week",
       note="Six problems raised a week, about twelve analyst-hours each, "
            "two analysts with fifteen usable hours between them",
       lesson="Demand is 2.4x capacity. The queue does not settle at a "
              "big number, it grows for ever. Prioritising changes WHICH "
              "problems rot, not how many."),

    # ── Not a queue at all ──────────────────────────────────────────────
    _q("vendor_pending",
       "Pending third party",
       "Vendor tasks",
       lam=38.0, mean_service=36.0, agents=0, kind="delay",
       sla=48.0,
       note="Thirty-eight tickets an hour parked with suppliers, thirty-six "
            "hours average turnaround",
       lesson="This consumes none of your people, so every utilisation "
              "figure you report looks healthy -- while about 1,370 "
              "tickets sit pending at any moment and roughly a quarter of "
              "them will pass 48 hours. Headcount is not the lever here."),

    # ── A transient. The formula is wrong and that is the lesson ────────
    _q("change_drain",
       "The morning after a change freeze",
       "Change management",
       lam=45.0, mean_service=25.0 / 60, agents=12, kind="burst",
       sla=8.0,
       note="One hundred and eighty changes released over four hours, then "
            "eight an hour; twelve approvers, twenty-five minutes each",
       lesson="Erlang C answers 'where does this settle'. A burst never "
              "settles, so the steady-state answer understates the peak "
              "badly. Only the simulation knows."),

    # ── Same load, same people, half the wait ───────────────────────────
    _q("p_tasks",
       "Scheduled P-tasks",
       "Planned work",
       lam=20.0, mean_service=2.5 / 60, agents=1,
       service="deterministic",
       note="Twenty planned tasks an hour, two and a half minutes each, "
            "one person, every one the same length",
       lesson="Identical load to an unpredictable queue, and exactly half "
              "the wait. Pollaczek-Khinchine, exact: variability costs as "
              "much as load does."),
]}


# The utilisation grid stage 3 sweeps. Deliberately uneven -- the
# interesting part of the curve is all above 0.85, and a linear grid
# spends most of its points in the flat region where nothing happens.
_RHO_GRID = [0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.55, 0.60, 0.65,
             0.70, 0.74, 0.78, 0.80, 0.82, 0.84, 0.86, 0.88, 0.90,
             0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.975, 0.98,
             0.985, 0.99, 0.993, 0.996]


def _provider(sample_id: str) -> dict:
    s = SAMPLES.get(sample_id)
    if s is None:
        raise FileNotFoundError(sample_id)
    return {
        # The only real array is the sweep grid. Everything that defines
        # the scenario is a SCALAR, and scalars go in meta -- not in
        # arrays, where multi_to_arrays would turn each one into a
        # one-element Float32Array and every later read would need
        # unwrapping.
        "arrays": {"rho": list(_RHO_GRID)},
        "meta": {k: s[k] for k in (
            "name", "tier", "lam", "mu", "agents", "mean_service",
            "service", "kind", "unit", "unit_label", "sla", "note",
            "lesson", "offered", "rho")} | {
            # Never measured. The renderer puts this on the card.
            "provenance": "model",
            "record_id": sample_id,
        },
    }


def _lister(limit: int, offset: int) -> dict:
    ids = list(SAMPLES.keys())
    page = ids[offset:offset + limit]
    return {"samples": [{"record_id": i, "label": SAMPLES[i]["tier"]}
                        for i in page],
            "total": len(ids), "offset": offset}


data_source_store.register("itsm_queues",
    provider      = _provider,
    lister        = _lister,
    adapter       = "multi_to_arrays",
    primary_field = "rho",
    fs_field      = None,
    label         = "Service-management queues",
    description   = "Arrival rate, handling time and agent count for seven "
                    "service-desk situations. Modelled, not measured.",
    schema        = {"fields": ["arrays.rho", "meta.lam", "meta.mu",
                                "meta.agents", "meta.service", "meta.kind"],
                     "fs": None, "domain": "ops.itsm"})
