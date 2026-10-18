// ---------------------------------------------------------------------------
// filters/moore_filter.js
//
// Three questions about one table of chips:
//
//   line    how straight is the line, and what is the doubling period
//   claim   did real density keep up with what the node label implied
//   dies    how much of the recent curve is one chip and how much a package
//
// ONE PASS, THREE VIEWS
//   The same arithmetic answers all three, so this runs once and tags its
//   captures by view. The renderer filters. Nothing recomputes when you
//   move between stages -- the same pattern as the AES depth ladder.
//
// WHAT THE FIT IS
//   Least squares on log10(transistors) against year. A straight line in
//   log space IS an exponential, so the slope is the only parameter that
//   matters: doubling period = log10(2) / slope. Fitting in linear space
//   would let the last few points dominate entirely and tell you nothing
//   about the 1970s.
//
// THE HONEST PART
//   Density is transistors divided by die area, and die areas are often
//   measured off photographs rather than published. Worse, die area moves
//   with how much cache and GPU a product carries, which has nothing to
//   do with the process. So a single density ratio is noisy, and this
//   filter does NOT report a crossing on one sign change -- see
//   findSettledCrossing below.
//
// Self-registers into DSP_ALGORITHMS (dsp_registry.js must load first).
// ---------------------------------------------------------------------------

(function () {
"use strict";

// Least squares on (x, log10 y). Returns slope/intercept in log space
// plus r2, which the renderer prints -- a fit this good is itself the
// finding and hiding the number would be coy.
function logFit(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    const ly = ys.map(v => Math.log10(v));
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ly.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (xs[i] - mx) * (ly[i] - my);
        den += (xs[i] - mx) ** 2;
    }
    if (den === 0) return null;
    const slope = num / den;
    const intercept = my - slope * mx;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
        ssRes += (ly[i] - (slope * xs[i] + intercept)) ** 2;
        ssTot += (ly[i] - my) ** 2;
    }
    return {
        slope, intercept,
        r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
        doublingYears: slope > 0 ? Math.log10(2) / slope : null,
    };
}

// The first point after which the efficiency ratio never returns above
// its own long-run mean. "Never again", not "first dip", because the
// ratio wobbles by a few percent and a naive sign test fires on noise
// in a die-area estimate rather than on a turning point.
function findSettledCrossing(points) {
    for (let i = 0; i < points.length; i++) {
        if (points[i].ratio >= 1) continue;
        if (points.slice(i).every(p => p.ratio < 1)) return points[i];
    }
    return null;
}

registerDspAlgorithm("moore_fit", {
    process(envelope, parameters) {
        const a = envelope?.arrays ?? {};
        const m = envelope?.meta ?? {};

        // EVERY ARRAY ARRIVES AS A Float32Array. multi_to_arrays does
        //     arrays[key] = new Float32Array(val)
        // on the way in, and TypedArray.prototype.map returns ANOTHER
        // TYPED ARRAY -- it coerces whatever the callback returns to a
        // number. So `years.map(y => ({...}))` does not build a list of
        // objects, it builds a Float32Array of NaN, one per chip.
        //
        // Nothing throws. `points.length` is still right, so every guard
        // downstream passes, and the NaNs travel all the way to the
        // canvas -- where a fillRect or an arc with NaN coordinates is a
        // silent no-op. The result is a correctly sized, fully wired,
        // completely blank chart with an empty console.
        //
        // Array.from() once, here, is the whole fix. Do not remove it
        // because "the arrays look like arrays".
        const years = Array.from(a.year ?? []);
        const trans = Array.from(a.transistors ?? []);

        if (years.length < 2 || trans.length !== years.length) {
            return { error: "Need at least two chips with a year and a count." };
        }

        const names = m.names ?? years.map((_, i) => `chip ${i}`);
        const srcs = m.src ?? years.map(() => "vendor");
        const fams = m.families ?? years.map(() => "");
        const nodes = Array.from(a.nodeMm ?? a.nodeNm ?? []);
        const areas = Array.from(a.dieMm2 ?? []);
        const dies = a.dies ? Array.from(a.dies) : years.map(() => 1);

        const points = years.map((y, i) => ({
            i,
            name: names[i],
            year: y,
            transistors: trans[i],
            nodeNm: nodes[i] ?? null,
            dieMm2: areas[i] ?? null,
            dies: dies[i] ?? 1,
            src: srcs[i] ?? "vendor",
            family: fams[i] ?? "",
            // Density is per mm2 of SILICON, summed across dies for a
            // package. That is what keeps a nine-die Epyc from appearing
            // to be nine times denser than it is.
            density: areas[i] ? trans[i] / areas[i] : null,
            estimated: (srcs[i] ?? "vendor") === "est",
        }));

        const fitAll = logFit(points.map(p => p.year), points.map(p => p.transistors));
        const single = points.filter(p => p.dies === 1);
        const fitSingle = single.length >= 2
            ? logFit(single.map(p => p.year), single.map(p => p.transistors))
            : null;

        // ── The claim series ────────────────────────────────────────────
        // A node label implies a density: halve the linear dimension and
        // you quarter the area per transistor, so implied density goes as
        // 1/node^2. The quantity that tests this is therefore
        //
        //     efficiency = density x node^2
        //
        // which is CONSTANT if and only if the label tracks density. A
        // flat line is the null hypothesis, and the data is not flat.
        //
        // WHY NOT TWO LINES FROM AN ANCHOR CHIP
        //   The first version normalised density and the label's implied
        //   density to a shared anchor and reported where they crossed.
        //   That answer turned out to be a property of the ANCHOR, not of
        //   the data: anchored at the 4004 -- a sparse layout by any later
        //   standard -- every subsequent chip reads as "behind" and the
        //   crossing lands in 1974. Anchored at the Pentium Pro it lands
        //   in 2012. Same records, same arithmetic, different century,
        //   and nothing on screen would have admitted the choice was
        //   being made. Centring on the series' own mean removes the
        //   free parameter: the SHAPE is what is being claimed, and the
        //   shape does not move.
        const usable = points.filter(p => p.density && p.nodeNm);
        let claimPoints = [];
        if (usable.length >= 2) {
            const logs = usable.map(p => Math.log10(p.density * p.nodeNm ** 2));
            const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
            claimPoints = usable.map((p, i) => ({
                ...p,
                gapDex: logs[i] - mean,            // how far off its own era
                ratio: Math.pow(10, logs[i] - mean),
            }));
        }
        const crossing = findSettledCrossing(claimPoints);
        const ratios = claimPoints.map(p => p.ratio);
        const spread = ratios.length ? Math.max(...ratios) / Math.min(...ratios) : null;

        // ── Captures ────────────────────────────────────────────────────
        // One per chip per view, chronological, so every view can reveal
        // progressively and the sweep means the same thing in all three.
        const interimOutputs = [];
        points.forEach((p, idx) => {
            interimOutputs.push({
                view: "line", idx, label: p.name,
                tech: `${p.year} — ${fmt(p.transistors)} transistors`,
                point: p,
            });
        });
        claimPoints.forEach((p, idx) => {
            interimOutputs.push({
                view: "claim", idx, label: p.name,
                tech: `${p.nodeNm}nm label — ${p.ratio >= 1 ? "beating" : "missing"}`
                      + ` its own label by ${p.ratio.toFixed(2)}x`,
                point: p,
            });
        });
        points.forEach((p, idx) => {
            interimOutputs.push({
                view: "dies", idx, label: p.name,
                tech: p.dies > 1 ? `${p.dies} dies in one package`
                                 : "one die",
                point: p,
            });
        });

        return {
            interimOutputs,
            finalOutput: {
                points,
                claimPoints,
                crossing,
                spread,
                fit: fitAll,
                fitSingleDie: fitSingle,
                multiDieCount: points.filter(p => p.dies > 1).length,
                estimatedCount: points.filter(p => p.estimated).length,
                yearRange: [points[0].year, points[points.length - 1].year],
                note: m.note ?? "",
            },
        };
    },
});

// The fit is PLAIN DATA -- slope and intercept, no closure. An earlier
// version attached an `at(year)` evaluator, which works right up until
// something serialises finalOutput (a cache, a worker hop, a structured
// clone) and the function silently vanishes, taking the trend line with
// it and raising no error anywhere. The renderer does the two-line
// evaluation itself.
function fmt(n) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return `${n}`;
}

// Exported for the Node-side test, which checks the fit and the crossing
// against the Python run rather than trusting one implementation.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { logFit, findSettledCrossing, fmt };
}

})();