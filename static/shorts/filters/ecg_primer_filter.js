// ---------------------------------------------------------------------------
// static/shorts/filters/ecg_primer_filter.js
//
// THE JOURNEY BEFORE THE JOURNEY.
//
// /journey/ecg opens on a real recording with Pan-Tompkins already
// running, which assumes the viewer knows three things: that a wiggly
// line is voltage against time, that the spikes are heartbeats, and that
// finding them is hard. Shown to someone without a signals background,
// none of those were obvious and all three had to be explained out loud.
// That explanation is what this is.
//
// FIVE STAGES, ONE IDEA EACH
//   what_is_signal  a number that changes over time. Flat, then a bump.
//   count_them      count the bumps. You just did peak detection.
//   anatomy         a real beat is not a bump: P, QRS, T, and what each
//                   one is the heart actually doing.
//   the_landmark    why R and not P or T, and that timing is R-to-R.
//   why_hard        a REAL recording. Now find the beats.
//
// why_hard ends on the PROBLEM, not the answer, so Pan-Tompkins arrives
// as the solution to something the viewer has just failed at.
//
// SYNTHETIC FOR STAGES 1-4, REAL FOR STAGE 5 -- and the cards say so.
//   Synthetic teaches the ideal: no noise, exact spacing, a known answer.
//   Real shows why the ideal does not happen. Mixing them inside one
//   stage would be the dishonest version; separating them is the lesson.
//
// THE ORACLE (section 34's rule)
//   stages 1, 2, 4  EXACT BY CONSTRUCTION. The generator is told where
//                   to put the bumps, so the count, the spacing and the
//                   implied rate are known rather than measured. The
//                   test asserts the generator against its own inputs.
//   stage 3         the canonical beat is a DIAGRAM, and its oracle is
//                   published clinical reference ranges: the intervals
//                   MEASURED OFF THE GENERATED SAMPLES must fall inside
//                   PR 120-200ms, QRS 70-110ms, QT 350-440ms, P <=110ms.
//                   A drawing that looks like a beat but has a 60ms PR
//                   interval would teach something false.
//   stage 5         real PhysioNet data; nothing is claimed about it
//                   beyond "this is hard", which the picture establishes.
//
//   NOT AN ORACLE, and marked as such on the card: the P/QRS/T labels in
//   stage 3 sit on a beat this file DREW. They are definitional, not
//   detected. The journey is not claiming to have found them.
// ---------------------------------------------------------------------------

(function () {
    "use strict";

    // ── Clinical reference ranges ────────────────────────────────────────
    // Standard adult values, used BOTH to build the canonical beat and to
    // check it. Writing them once means the diagram cannot drift from the
    // thing it is checked against.
    const NORMAL = {
        pDurMs:   [60, 110],    // P wave duration
        prMs:     [120, 200],   // P onset to QRS onset
        qrsMs:    [70, 110],    // QRS duration
        qtMs:     [350, 440],   // QRS onset to T end, at ~60-70 bpm
        pMv:      [0.05, 0.25], // P amplitude
        tMv:      [0.10, 0.50], // T amplitude
    };

    const mid = ([lo, hi]) => (lo + hi) / 2;

    // Threshold used BOTH to draw and to measure. One constant, so the
    // drawing and the check cannot disagree about where a wave ends.
    const EPS_MV = 0.02;

    // ── NOMINAL WIDTH vs MEASURED WIDTH ──────────────────────────────────
    // A raised cosine reaches zero at its nominal edges, but it drops
    // BELOW A MEASUREMENT THRESHOLD well before that -- so anyone
    // measuring the drawing gets a narrower wave than the width it was
    // drawn with. Measured, the P wave came out 63ms from a nominal 85ms:
    // still inside the normal range, but only by luck, and it would move
    // if the threshold moved. A number that changes with an unseen
    // parameter is the anchor problem from section 34 in miniature.
    //
    // So the generator is given the width it wants to be MEASURED at and
    // solves for the nominal width that produces it:
    //
    //     0.5 * (1 + cos(pi*u)) = eps / amp
    //     u = acos(2*eps/amp - 1) / pi        <- visible fraction
    //     nominal = target / u
    //
    // Amplitude-dependent, which is why it is solved rather than being a
    // single fudge factor: a 0.15mV P and a 0.30mV T lose different
    // amounts of width to the same threshold.
    function nominalForVisible(targetMs, amp, eps = EPS_MV) {
        const a = Math.abs(amp);
        if (!(a > eps)) return targetMs;         // never visible anyway
        const u = Math.acos(2 * eps / a - 1) / Math.PI;
        return targetMs / u;
    }

    // ── Shapes ───────────────────────────────────────────────────────────
    // A raised cosine rather than a Gaussian: it reaches exactly zero at
    // a known width, so "this wave is 100ms wide" is true of the drawing
    // and not merely approximately true. That matters because stage 3's
    // oracle MEASURES the widths back off the samples.
    function bump(out, fs, centreS, widthMs, amp) {
        const half = (widthMs / 1000) * fs / 2;
        const c = centreS * fs;
        const from = Math.max(0, Math.ceil(c - half));
        const to = Math.min(out.length - 1, Math.floor(c + half));
        for (let i = from; i <= to; i++) {
            const u = (i - c) / half;              // -1 .. 1
            out[i] += amp * 0.5 * (1 + Math.cos(Math.PI * u));
        }
    }

    // ── ONE GENERATOR, WITH A DETAIL KNOB ────────────────────────────────
    //
    // Stages 1 and 2 used to draw a featureless bump. That was a small
    // lie: the card says "each bump is a heartbeat" while showing a shape
    // no heartbeat has ever made. It also wasted the reveal -- stage 3
    // introduced a NEW shape, when it could have been saying "this is
    // what you have been looking at all along".
    //
    // So there is one beat generator and a `detail` parameter from 0 to 1.
    // At 0.35 the subtle features are damped: a small rise, a sharp spike,
    // a dip, a gentle recovery. Recognisably a heartbeat, nothing to
    // name yet. At 1.0 it is the full textbook beat the oracle checks.
    // The journey turns the knob up as it goes.
    //
    // The CLINICAL GEOMETRY IS IDENTICAL AT EVERY DETAIL LEVEL -- only
    // amplitudes are damped, never timings. A simplified beat with a
    // squashed PR interval would teach a wrong fact quietly, and stages
    // 1 and 2 are where a viewer forms their first idea of the shape.
    const BEAT = {
        rAtS: 0.42,
        amp:  { p: mid(NORMAL.pMv), q: -0.12, r: 1.20,
                s: -0.28, t: mid(NORMAL.tMv) },
        w:    { p: mid(NORMAL.pDurMs), q: 26, r: 56, s: 30, t: 160 },
        qOffS: -0.030,
        sOffS: +0.034,
    };

    // How much of each feature survives at a given detail level. R is
    // never damped -- it is the thing being pointed at from stage 1
    // onwards, and shrinking it would make the simplified beat read as a
    // different, flatter rhythm rather than as the same beat with less
    // detail.
    function damp(detail) {
        const d = Math.max(0, Math.min(1, detail));
        return { p: d, q: 0.45 + 0.55 * d, r: 1, s: 0.45 + 0.55 * d, t: d };
    }

    // Returns the geometry as well as the samples, so callers that need
    // the clinical intervals (stage 3) and callers that only need an
    // R index (stages 1, 2, 4) read the same object.
    function makeBeat(fs, { detail = 1, lenS = 1.0, rAtS = BEAT.rAtS } = {}) {
        const n = Math.round(lenS * fs);
        const y = new Float32Array(n);
        const k = damp(detail);
        const amp = { p: BEAT.amp.p * k.p, q: BEAT.amp.q * k.q,
                      r: BEAT.amp.r * k.r, s: BEAT.amp.s * k.s,
                      t: BEAT.amp.t * k.t };
        const w = BEAT.w;

        const qCentreS  = rAtS + BEAT.qOffS;
        const sCentreS  = rAtS + BEAT.sOffS;
        const qrsOnsetS = qCentreS - w.q / 2000;
        const qrsEndS   = sCentreS + w.s / 2000;
        const prTarget  = mid(NORMAL.prMs);
        const qtTarget  = mid(NORMAL.qtMs);
        const pOnsetS   = qrsOnsetS - prTarget / 1000;
        const pCentreS  = pOnsetS + w.p / 2000;
        const tEndS     = qrsOnsetS + qtTarget / 1000;
        const tCentreS  = tEndS - w.t / 2000;

        // A damped wave is thinner at the measurement threshold, so the
        // nominal width is solved from its OWN amplitude. Using the full
        // amplitude here would make the P wave in stage 1 narrower than
        // the P wave in stage 3, for no reason a viewer could see.
        if (Math.abs(amp.p) > EPS_MV)
            bump(y, fs, pCentreS, nominalForVisible(w.p, amp.p), amp.p);
        if (Math.abs(amp.q) > EPS_MV)
            bump(y, fs, qCentreS, nominalForVisible(w.q, amp.q), amp.q);
        bump(y, fs, rAtS, nominalForVisible(w.r, amp.r), amp.r);
        if (Math.abs(amp.s) > EPS_MV)
            bump(y, fs, sCentreS, nominalForVisible(w.s, amp.s), amp.s);
        if (Math.abs(amp.t) > EPS_MV)
            bump(y, fs, tCentreS, nominalForVisible(w.t, amp.t), amp.t);

        const S = (x) => Math.round(x * fs);
        return {
            y, fs, lenS, detail,
            marks: { P: S(pCentreS), Q: S(qCentreS), R: S(rAtS),
                     Sw: S(sCentreS), T: S(tCentreS) },
            spans: {
                p:   [S(pOnsetS),   S(pOnsetS + w.p / 1000)],
                pr:  [S(pOnsetS),   S(qrsOnsetS)],
                qrs: [S(qrsOnsetS), S(qrsEndS)],
                qt:  [S(qrsOnsetS), S(tEndS)],
            },
            // WHICH PART EACH SAMPLE BELONGS TO, so the renderer can
            // colour by segment without re-deriving the boundaries and
            // drifting from them.
            segOf: (() => {
                const seg = new Uint8Array(n);      // 0 flat 1 P 2 QRS 3 T
                const fill = (a, b, v) => {
                    for (let i = Math.max(0, S(a)); i <= Math.min(n - 1, S(b)); i++)
                        seg[i] = v;
                };
                fill(pOnsetS, pOnsetS + w.p / 1000, 1);
                fill(qrsOnsetS, qrsEndS, 2);
                fill(tEndS - w.t / 1000, tEndS, 3);
                return seg;
            })(),
            intervalsMs: {
                pDur: w.p, pr: prTarget,
                qrs: (qrsEndS - qrsOnsetS) * 1000, qt: qtTarget,
            },
            amplitudesMv: { p: amp.p, r: amp.r, t: amp.t },
        };
    }

    // Full detail, for stage 3 and its oracle.
    function makeCanonicalBeat(fs) { return makeBeat(fs, { detail: 1 }); }

    // ── A train of beats ─────────────────────────────────────────────────
    // Used by stages 1, 2 and 4. One beat is a train of length one, so
    // there is no separate code path for the single-beat case to drift.
    function makeBeatTrain(fs, { count, bpm, detail = 1,
                                 leadS = 0.5, tailS = 0.4 } = {}) {
        const gapS = 60 / bpm;
        const one = makeBeat(fs, { detail });
        // The beat template is 1.0s long with R at 0.42s; at rates above
        // ~100bpm successive beats overlap in their flat tails, which is
        // harmless, but the TEMPLATE still has to fit.
        const lenS = leadS + (count - 1) * gapS + one.lenS + tailS;
        const n = Math.round(lenS * fs);
        const y = new Float32Array(n);
        const seg = new Uint8Array(n);
        const rIdx = [];

        for (let b = 0; b < count; b++) {
            const shift = Math.round((leadS + b * gapS) * fs);
            for (let i = 0; i < one.y.length && shift + i < n; i++) {
                y[shift + i] += one.y[i];
                if (one.segOf[i]) seg[shift + i] = one.segOf[i];
            }
            rIdx.push(shift + one.marks.R);
        }

        const rrMs = count > 1 ? (rIdx[1] - rIdx[0]) / fs * 1000 : null;
        return {
            y, fs, lenS, rIdx, segOf: seg, detail, count,
            // Kept under the old name too: stage 2's renderer counts
            // these, and "the thing you count" reads better as peaks
            // than as rIdx at the call site.
            peakIndices: rIdx.slice(),
            bpm, intervalMs: gapS * 1000,
            rrMs, bpmFromRr: rrMs ? 60000 / rrMs : null, bpmAsked: bpm,
            beatLenS: one.lenS, beatRAtS: one.marks.R / fs,
        };
    }

    // Kept for the stage-4 ribbon, which wants each beat as its OWN
    // series rather than summed into one line -- a 3-D stack needs the
    // beats separable, and slicing them back out of a train would
    // re-derive boundaries the generator already knows.
    function makeBeatLayers(fs, { count, bpm, detail = 1, jitterMs = 0,
                                  seed = 4 } = {}) {
        // A tiny deterministic wobble so the ribbon does not look like a
        // photocopy. Real beat-to-beat intervals vary; a ribbon of
        // identical beats would imply they do not.
        let a = seed >>> 0;
        const rnd = () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const one = makeBeat(fs, { detail });
        const layers = [];
        let tS = 0;
        for (let b = 0; b < count; b++) {
            const wob = jitterMs ? (rnd() - 0.5) * 2 * jitterMs : 0;
            layers.push({ y: one.y, rIdx: one.marks.R, startS: tS,
                          rrMs: b === 0 ? null : (60 / bpm) * 1000 + wob });
            tS += (60 / bpm) + wob / 1000;
        }
        return { layers, fs, beatLenS: one.lenS, rAt: one.marks.R,
                 segOf: one.segOf, bpm, count,
                 spanS: tS + one.lenS };
    }

    // Measure the generated samples back, so the drawing is checked
    // rather than trusted. Threshold-crossing on a clean synthetic trace,
    // which is all that is needed here -- and notably NOT a peak
    // detector, because using one would make the oracle circular.
    function measureBeat(beat) {
        const { y, fs } = beat;
        const ms = (samples) => (samples / fs) * 1000;
        const eps = EPS_MV;                    // the SAME threshold used to draw

        // R apex: the largest sample. On a synthetic clean beat this is
        // unambiguous, which is the only reason it is allowed.
        let rIdx = 0;
        for (let i = 1; i < y.length; i++) if (y[i] > y[rIdx]) rIdx = i;

        // QRS: the contiguous run around R that leaves the baseline,
        // including the negative Q and S shoulders.
        let a = rIdx, b = rIdx;
        while (a > 0 && Math.abs(y[a - 1]) > eps) a--;
        while (b < y.length - 1 && Math.abs(y[b + 1]) > eps) b++;

        // P: the first excursion before the QRS run.
        let pEnd = a;
        while (pEnd > 0 && Math.abs(y[pEnd - 1]) <= eps) pEnd--;
        let pStart = pEnd;
        while (pStart > 0 && Math.abs(y[pStart - 1]) > eps) pStart--;

        // T: the excursion after it.
        let tStart = b;
        while (tStart < y.length - 1 && Math.abs(y[tStart + 1]) <= eps) tStart++;
        let tEnd = tStart;
        while (tEnd < y.length - 1 && Math.abs(y[tEnd + 1]) > eps) tEnd++;

        let pPeak = pStart;
        for (let i = pStart; i <= pEnd; i++) if (y[i] > y[pPeak]) pPeak = i;
        let tPeak = tStart;
        for (let i = tStart; i <= tEnd; i++) if (y[i] > y[tPeak]) tPeak = i;

        return {
            rIdx,
            pDurMs: ms(pEnd - pStart),
            prMs:   ms(a - pStart),
            qrsMs:  ms(b - a),
            qtMs:   ms(tEnd - a),
            pMv:    y[pPeak],
            rMv:    y[rIdx],
            tMv:    y[tPeak],
        };
    }

    // ── Stage 4: two beats, so there is an interval to point at ──────────
    function makeTwoBeats(fs, bpm) {
        const gapS = 60 / bpm;
        const one = makeCanonicalBeat(fs);
        const lenS = gapS + one.lenS;
        const n = Math.round(lenS * fs);
        const y = new Float32Array(n);
        const rs = [];
        for (const off of [0, gapS]) {
            const shift = Math.round(off * fs);
            for (let i = 0; i < one.y.length && shift + i < n; i++) {
                y[shift + i] += one.y[i];
            }
            rs.push(shift + one.marks.R);
        }
        return {
            y, fs, lenS, rIdx: rs,
            rrMs: (rs[1] - rs[0]) / fs * 1000,
            // The arithmetic the stage is about, stated so the renderer
            // never has to do sums of its own.
            bpmFromRr: 60000 / ((rs[1] - rs[0]) / fs * 1000),
            bpmAsked: bpm,
        };
    }

    const impl = {
        id: "ecg_primer",
        label: "What a heartbeat looks like",

        process(input, params) {
            const p = params || {};
            const fs = Number(input?.fs) || 300;
            const BPM = 72;

            // Stage 1: ONE beat, after a stretch of nothing. Simplified
            // -- recognisably a heartbeat, nothing named yet. The flat
            // lead-in is not padding: "it was flat, THEN something
            // happened" is the entire stage.
            const single = makeBeatTrain(fs, {
                count: 1, bpm: BPM, detail: 0.35, leadS: 1.5, tailS: 0.5,
            });

            // Stage 2: five of the same, at a resting rate, so the
            // number counted is also a believable pulse.
            const train = makeBeatTrain(fs, {
                count: 5, bpm: BPM, detail: 0.35, leadS: 0.55, tailS: 0.45,
            });

            // Stage 3: full detail. THE SAME SHAPE, turned up -- which is
            // what makes "this is what you have been looking at" land.
            const beat = makeCanonicalBeat(fs);
            const measured = measureBeat(beat);

            // Stage 4: beats as SEPARATE layers for the depth stack,
            // plus the flat two-beat pair the interval span is drawn on.
            const pair = makeBeatTrain(fs, {
                count: 2, bpm: BPM, detail: 1, leadS: 0.15, tailS: 0.25,
            });
            const ribbon = makeBeatLayers(fs, {
                count: 14, bpm: BPM, detail: 1, jitterMs: 34, seed: 11,
            });

            // Stage 5: THE REAL RECORDING, untouched. No filtering, no
            // detection -- the point is what it looks like before anyone
            // has helped you.
            const realY = input?.y ? Array.from(input.y) : null;

            return {
                finalOutput: {
                    fs,
                    single, train, beat, pair, ribbon,
                    measured,
                    normal: NORMAL,
                    real: realY ? {
                        y: realY,
                        lenS: realY.length / fs,
                        // Deliberately NOT peak indices. Handing the
                        // answer to the stage that asks the question
                        // would undo the stage.
                        label: input?.meta?.label ?? null,
                        recordId: input?.meta?.record_id
                               ?? input?.meta?.recordId ?? null,
                    } : null,
                    provenance: {
                        synthetic: ["what_is_signal", "count_them",
                                    "anatomy", "the_landmark"],
                        measured:  ["why_hard"],
                    },
                },
            };
        },
    };

    if (typeof registerDspAlgorithm === "function") {
        registerDspAlgorithm(impl.id, impl);
    } else if (typeof module !== "undefined") {
        module.exports = { impl, makeCanonicalBeat, measureBeat,
                           makeBeat, makeBeatTrain, makeBeatLayers,
                           NORMAL };
    }
})();