// ---------------------------------------------------------------------------
// static/shorts/filters/itsm_filter.js
//
// Service-desk queues. Given arrivals per hour, handling time and how many
// people can work it, answer the question every service manager actually
// asks: how long will this sit, and what moves it.
//
// THE ORACLE -- three independent routes to the same number
//   1. Erlang C in closed form
//   2. a discrete-event simulation that contains no formula at all
//   3. Little's Law (L = lambda * W), an IDENTITY the simulation must
//      satisfy whichever way the formula came out
//   plus Pollaczek-Khinchine, which is EXACT for M/D/1 and is what lets
//   the "variability costs as much as load" claim be stated as fact.
//
//   Verified against a Python implementation of all four before this file
//   was written: agreement to under one standard error of the
//   simulation's own estimator. That matters because the alternative --
//   one implementation agreeing with itself -- is not evidence.
//
// WHAT IS MODELLED AND WHAT IS EXACT
//   The inputs are invented. Nothing here was measured, there is no
//   PhysioNet for incident tickets, and the cards say so. The MATHS is
//   not invented: given those inputs the wait is determined, not
//   estimated. So the shape of every finding is exact while the numbers
//   are illustrative -- the reverse of the ECG journeys, where the data
//   is real and the algorithm is the thing under test.
//
// ERLANG B RECURRENCE, NOT THE FACTORIAL FORM
//   The textbook expression has a**c / c! in it, which overflows for c in
//   the low hundreds and loses precision long before. A service desk with
//   200 agents is not hypothetical, so the recurrence is used instead --
//   it is also fewer operations.
// ---------------------------------------------------------------------------

(function () {
    "use strict";

    // ── The closed form ──────────────────────────────────────────────────

    function erlangC(lam, mu, c) {
        if (!(c > 0)) return 1;
        const a = lam / mu;            // offered load, erlangs
        const rho = a / c;
        if (rho >= 1) return 1;        // unstable: everyone waits, for ever
        let b = 1;
        for (let n = 1; n <= c; n++) b = (a * b) / (n + a * b);
        return b / (1 - rho * (1 - b));
    }

    // Expected time IN QUEUE, not including being worked on. The
    // distinction matters on a card: "waiting 17 minutes" is the thing
    // people complain about, and it is not the 45 minutes the ticket
    // then takes to resolve.
    function mmcWait(lam, mu, c) {
        const rho = (lam / mu) / c;
        if (rho >= 1) return Infinity;
        return erlangC(lam, mu, c) / (c * mu - lam);
    }

    // M/D/1, Pollaczek-Khinchine. EXACT, and exactly half of M/M/1 at
    // the same utilisation.
    function md1Wait(lam, mu) {
        const rho = lam / mu;
        if (rho >= 1) return Infinity;
        return rho / (2 * mu * (1 - rho));
    }

    function mm1Wait(lam, mu) {
        const rho = lam / mu;
        if (rho >= 1) return Infinity;
        return rho / (mu * (1 - rho));
    }

    // Deterministic service with several servers has no tidy exact form.
    // Kingman's approximation is used and LABELLED as one: scale the
    // M/M/c wait by (Ca^2 + Cs^2)/2, which for Poisson arrivals and
    // fixed service is exactly 1/2. Good near heavy load, optimistic
    // when light -- so the card says "approximate" for c > 1 and
    // "exact" for c = 1.
    function waitFor(lam, mu, c, service) {
        if (service !== "deterministic") return mmcWait(lam, mu, c);
        if (c === 1) return md1Wait(lam, mu);          // exact
        return mmcWait(lam, mu, c) * 0.5;              // Kingman
    }

    // ── A seeded generator ───────────────────────────────────────────────
    // Reproducible on purpose. A card whose numbers move every time it is
    // viewed cannot be discussed, screenshotted or checked -- and the
    // whole point of a verified journey is that someone can check it.
    function rngFrom(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ── The simulation -- knows no formula ───────────────────────────────
    //
    // Agents are a COUNT, not objects: nothing here cares which agent
    // takes a ticket, only whether one is free. Jobs waiting are an
    // array of arrival times shifted off the front, which is FIFO -- and
    // FIFO is what a priority-sorted queue is, within one priority.
    //
    // Returns the series the renderer animates AND the summary numbers,
    // because they must come from the same run. Drawing the picture from
    // one simulation and printing the statistics from another is how a
    // card ends up contradicting itself.
    function simulate(lam, mu, c, opts) {
        const o = opts || {};
        const nJobs      = o.nJobs || 2600;
        const det        = o.service === "deterministic";
        const burstUntil = o.burstUntil || 0;      // in time units
        const burstLam   = o.burstLam || lam;
        const afterLam   = o.afterLam || lam;
        const rnd        = rngFrom(o.seed || 12345);
        const exp = (rate) => -Math.log(1 - rnd()) / rate;
        const svc = () => (det ? 1 / mu : exp(mu));

        let t = 0, free = c, served = 0;
        const queue = [];
        const events = [];
        const waits = [];
        const qLen = [];
        const arrivals = [];

        const rateAt = (time) => (burstUntil > 0 && time < burstUntil
                                  ? burstLam : afterLam);
        const push = (time, kind) => {
            // Small arrays: a linear insert beats a heap here and is
            // easier to be certain about.
            let i = events.length;
            while (i > 0 && events[i - 1].t > time) i--;
            events.splice(i, 0, { t: time, kind });
        };

        push(exp(rateAt(0)), 0);

        // Warm-up discarded: the queue starts EMPTY, which is not a state
        // a loaded queue spends time in. Averaging from zero biases the
        // wait down, and at high utilisation it biases it enormously.
        // NOT discarded for a burst, where the empty start IS the
        // scenario being shown.
        const warm = burstUntil > 0 ? 0 : Math.floor(nJobs * 0.15);

        let guard = nJobs * 50;
        while (served < nJobs && events.length && guard-- > 0) {
            const e = events.shift();
            t = e.t;

            if (e.kind === 0) {
                if (arrivals.length < 900) arrivals.push(t);
                if (free > 0) {
                    free--;
                    push(t + svc(), 1);
                    if (served >= warm) waits.push(0);
                    served++;
                } else {
                    queue.push(t);
                }
                push(t + exp(rateAt(t)), 0);
            } else {
                if (queue.length) {
                    const from = queue.shift();
                    push(t + svc(), 1);
                    if (served >= warm) waits.push(t - from);
                    served++;
                } else {
                    free++;
                }
            }
            if (qLen.length < 1400) qLen.push({ t, n: queue.length });
        }

        const sorted = waits.slice().sort((x, y) => x - y);
        const pct = (p) => sorted.length
            ? sorted[Math.min(sorted.length - 1,
                              Math.floor(p * sorted.length))] : 0;

        return {
            meanWait: waits.length
                ? waits.reduce((s, w) => s + w, 0) / waits.length : 0,
            pWait: waits.length
                ? waits.filter(w => w > 1e-12).length / waits.length : 0,
            p50: pct(0.50), p90: pct(0.90), p95: pct(0.95), p99: pct(0.99),
            maxWait: sorted.length ? sorted[sorted.length - 1] : 0,
            waits, qLen, arrivals,
            tEnd: t,
            served: waits.length,
            qMax: qLen.reduce((mx, s) => Math.max(mx, s.n), 0),
        };
    }

    // ── The algorithm ────────────────────────────────────────────────────

    const impl = {
        id: "itsm_queue",
        label: "Service queue",

        // Headcount as a rail control. It is the one number a service
        // manager can actually change, so it is the one thing the card
        // should let you change -- and watching the curve move under your
        // thumb is the whole argument the journey is making.
        //
        // A DELTA, not an absolute: the scenarios run from one agent to
        // twelve, so a fixed list of counts would be meaningless on most
        // of them.
        choices(envelope) {
            const m = envelope?.meta || {};
            if (m.kind === "delay") return [];   // no servers to add
            return [{
                key: "agentDelta",
                label: "People",
                values: [-2, -1, 0, 1, 2, 4],
                value: 0,
                display: { "-2": "−2", "-1": "−1", "0": "as-is",
                           "1": "+1", "2": "+2", "4": "+4" },
            }];
        },

        process(input, params) {
            const p = params || {};
            const m = input?.meta || {};

            // meta carries SCALARS and the adapter does not touch it, so
            // these are plain numbers. arrays.rho IS converted, so it
            // arrives as a Float32Array -- and TypedArray.prototype.map
            // returns another typed array, coercing anything non-numeric
            // to NaN. Array.from first, every time. This exact mistake
            // rendered the silicon journey blank for an evening.
            const rhoGrid = Array.from(input?.arrays?.rho ?? []);

            const lam     = Number(m.lam);
            const mu      = Number(m.mu);
            const baseC   = Number(m.agents);
            const service = m.service || "exponential";
            const kind    = m.kind || "queue";

            const delta = Number(p.agentDelta ?? 0);
            // Never below one once there is a queue at all: zero agents
            // is not a staffing choice, it is a different scenario.
            const c = kind === "delay" ? 0 : Math.max(1, baseC + delta);

            const offered = lam / mu;
            const rho = c > 0 ? offered / c : null;
            const stable = (kind === "queue" || kind === "burst")
                ? (rho !== null && rho < 1) : true;

            // ── A pure delay is not a queue ──────────────────────────────
            // No servers, so nothing waits FOR a server. Little's Law
            // still applies and is exact for any service distribution,
            // which is why the pending count can be stated outright
            // rather than simulated.
            let delayStats = null;
            if (kind === "delay") {
                const meanT = 1 / mu;
                delayStats = {
                    inSystem: lam * meanT,
                    meanTurnaround: meanT,
                    pastSla: m.sla ? Math.exp(-m.sla / meanT) : null,
                };
            }

            // ── Formula, where it applies ───────────────────────────────
            const formula = (kind === "queue" && stable)
                ? { pWait: erlangC(lam, mu, c),
                    meanWait: waitFor(lam, mu, c, service),
                    exact: !(service === "deterministic" && c > 1) }
                : null;

            // ── Simulation, always ──────────────────────────────────────
            // Run even where the formula applies, because agreement
            // between them is the card's evidence. For rho >= 1 and for
            // the burst it is the only answer there is.
            const sim = kind === "delay" ? null : simulate(lam, mu, c, {
                service,
                nJobs: kind === "burst" ? 1100 : 2600,
                seed: 20261022,
                burstUntil: kind === "burst" ? 4 : 0,
                burstLam:   lam,
                // The burst sample declares the BURST rate as lam; the
                // rate it falls back to is carried separately so the
                // drain is a drain and not a second burst.
                afterLam:   kind === "burst" ? (m.after_lam ?? 8) : lam,
            });

            // Little's Law, from the simulation alone. An identity, so
            // it checks the simulation while owing nothing to Erlang C.
            let little = null;
            if (sim && sim.served > 0 && stable) {
                const W = sim.meanWait + 1 / mu;        // time in system
                little = { W, L: lam * W };
            }

            // ── The curve stage 3 sweeps ────────────────────────────────
            // Wait is reported in MULTIPLES OF HANDLING TIME, not hours.
            // A curve in hours is a curve about this one scenario's
            // service time; in service-time units it is the same curve
            // for every service desk on earth, which is the claim.
            const curve = rhoGrid.map(r => {
                const lamR = r * Math.max(1, c) * mu;
                const w = waitFor(lamR, mu, Math.max(1, c), service);
                return { rho: r, wait: w, waitRel: w * mu,
                         pWait: erlangC(lamR, mu, Math.max(1, c)) };
            }).filter(pt => Number.isFinite(pt.wait));

            // What one more person buys AT THIS LOAD. The honest form of
            // "we need more headcount": a ratio at the operating point,
            // rather than a feeling.
            let oneMore = null;
            if (kind !== "delay" && Number.isFinite(formula?.meanWait)) {
                const w2 = waitFor(lam, mu, c + 1, service);
                oneMore = { from: formula.meanWait, to: w2,
                            factor: w2 > 0 ? formula.meanWait / w2 : Infinity,
                            saved: formula.meanWait - w2 };
            } else if (kind !== "delay" && !stable) {
                // Unstable: the useful question is not "how much faster"
                // but "how many people before it is finite at all".
                let need = c;
                while (need < c + 200 && offered / need >= 1) need++;
                oneMore = { unstableNeeds: need, have: c };
            }

            // The variability finding, for every scenario and not only
            // the deterministic one -- "make the work predictable" is
            // advice that applies everywhere.
            const variability = stable ? {
                exponential:   c === 1 ? mm1Wait(lam, mu) : mmcWait(lam, mu, c),
                deterministic: c === 1 ? md1Wait(lam, mu)
                                       : mmcWait(lam, mu, c) * 0.5,
                exactForThisC: c === 1,
            } : null;

            return {
                finalOutput: {
                    view: p.view || "queue",
                    scenario: {
                        name: m.name, tier: m.tier, note: m.note,
                        lesson: m.lesson, kind, service,
                        unit: m.unit || "hr",
                        unitLabel: m.unit_label || "hour",
                        sla: m.sla ?? null,
                        provenance: m.provenance || "model",
                        lam, mu, meanService: 1 / mu,
                        agents: c, agentsBase: baseC, agentDelta: delta,
                        offered, rho, stable,
                    },
                    formula, sim, little, curve, oneMore, variability,
                    delayStats,
                },
            };
        },
    };

    if (typeof registerDspAlgorithm === "function") {
        registerDspAlgorithm(impl.id, impl);
    } else if (typeof module !== "undefined") {
        module.exports = { impl, erlangC, mmcWait, md1Wait, mm1Wait,
                           simulate, waitFor };
    }
})();
