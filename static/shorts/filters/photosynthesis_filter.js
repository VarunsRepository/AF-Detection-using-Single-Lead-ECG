// ---------------------------------------------------------------------------
// filters/photosynthesis_filter.js
//
// Why there are three photosynthesis pathways instead of one.
//
// THE PROBLEM ALL THREE SOLVE
//   RuBisCO, the enzyme that fixes CO2, also accepts O2 -- it evolved
//   when the atmosphere had almost no oxygen. Every oxygenation wastes
//   energy and releases CO2 back (photorespiration, the "C2" cycle), and
//   it gets WORSE as temperature rises. C4 and CAM are two different
//   workarounds, and both cost extra ATP to run.
//
//     C3    no workaround -- cheapest per CO2, loses most to O2
//     C4    separates in SPACE: CO2 concentrated in bundle-sheath cells
//     CAM   separates in TIME:  CO2 captured at night, used by day
//
//   So the interesting output is not "which is best" but WHERE EACH
//   WINS, which depends on temperature and water. That crossover is the
//   thing this DSPE computes.
//
// THE MODEL IS DELIBERATELY SIMPLE
//   Specificity factor falling with temperature, a fixed ATP tariff per
//   carboxylation and per oxygenation, and a transpiration ratio per
//   pathway. It is NOT a Farquhar model -- no light response, no
//   stomatal feedback, no mesophyll conductance.
//
//   It is anchored to published values so it can be checked rather than
//   merely believed: C3 at 25 C loses roughly a quarter of its fixed
//   carbon to photorespiration; C3 costs 3 ATP + 2 NADPH per CO2 and C4
//   about 5; water use is roughly 500, 250 and 50 H2O per CO2 for
//   C3, C4 and CAM. See photosynthesis.test.js.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// RuBisCO specificity at 25 C: it prefers CO2 over O2 by about 80:1 on a
// concentration basis. Falls roughly 1.5% per degree -- the enzyme gets
// LESS selective as it warms, which is the root of the whole problem.
const SPECIFICITY_25 = 80;
const SPECIFICITY_PER_DEG = -0.015;

// Dissolved gas ratio at the fixation site, ambient air, 25 C.
// O2 is far more abundant; only RuBisCO's selectivity keeps
// carboxylation ahead. Warming also lowers CO2 solubility relative to
// O2, which compounds the specificity loss.
const CO2_O2_RATIO_25 = 0.0416;
const RATIO_PER_DEG   = -0.011;

const PATHWAYS = {
    C3: {
        name: "C3",
        full: "Calvin cycle only",
        extraAtpPerCO2: 0,          // no concentrating mechanism to run
        concentratesCO2: false,
        waterPerCO2: 500,           // H2O molecules transpired per CO2 fixed
        stomataByDay: true,
        note: "No workaround: cheapest per CO2, and loses the most to oxygen",
    },
    C4: {
        name: "C4",
        full: "Spatial separation",
        // PEP carboxylase fixes CO2 in mesophyll cells and pumps it to
        // bundle-sheath cells, where CO2 is concentrated enough that
        // RuBisCO barely sees O2. Regenerating PEP costs 2 ATP per CO2.
        extraAtpPerCO2: 2,
        concentratesCO2: true,
        waterPerCO2: 250,
        stomataByDay: true,
        note: "CO2 concentrated around RuBisCO in a separate cell type",
    },
    CAM: {
        name: "CAM",
        full: "Temporal separation",
        // Same pump, run at NIGHT. Malate is stored in the vacuole and
        // released by day with the stomata shut -- which is why water
        // use is an order of magnitude lower.
        extraAtpPerCO2: 2.5,        // PEP regeneration plus vacuolar transport
        concentratesCO2: true,
        waterPerCO2: 50,
        stomataByDay: false,
        note: "CO2 captured at night, stomata shut by day -- water is the point",
    },
};

// Calvin cycle tariff per carboxylation, and the salvage cost per
// oxygenation. Photorespiration also returns half a CO2 for every
// oxygenation, so it wastes carbon as well as energy.
const ATP_PER_CARBOXYLATION   = 3;
const NADPH_PER_CARBOXYLATION = 2;
const ATP_PER_OXYGENATION     = 3.5;
const NADPH_PER_OXYGENATION   = 2;
const CO2_RELEASED_PER_OXYGENATION = 0.5;


function specificity(tempC) {
    return SPECIFICITY_25 * (1 + SPECIFICITY_PER_DEG * (tempC - 25));
}
function gasRatio(tempC) {
    return CO2_O2_RATIO_25 * (1 + RATIO_PER_DEG * (tempC - 25));
}


registerDspAlgorithm("photosynthesis", {
    process(envelope, parameters) {
        const meta     = envelope.meta ?? {};
        const pathId   = (parameters?.pathway ?? meta.pathway ?? "C3").toUpperCase();
        const tempC    = parameters?.temperatureC ?? meta.temperatureC ?? 25;
        const isNight  = parameters?.night ?? meta.night ?? false;
        const drought  = parameters?.drought ?? meta.drought ?? false;

        const path = PATHWAYS[pathId];
        if (!path) {
            return { error: `photosynthesis: unknown pathway "${pathId}". `
                          + `Expected C3, C4 or CAM.` };
        }

        // ── carboxylation vs oxygenation ───────────────────────────────
        // vc/vo = specificity x [CO2]/[O2]. A concentrating mechanism
        // raises CO2 at the site by roughly ten-fold, which is enough to
        // make oxygenation negligible -- that IS the mechanism.
        const concentrationFactor = path.concentratesCO2 ? 10 : 1;
        const vcOverVo = specificity(tempC) * gasRatio(tempC) * concentrationFactor;

        // Per 1 carboxylation, how many oxygenations occur.
        const vc = 1;
        const vo = vc / vcOverVo;

        const netCO2 = vc - vo * CO2_RELEASED_PER_OXYGENATION;

        // TWO different "photorespiration costs" get quoted, and they are
        // not the same number:
        //
        //   carbonLost     CO2 released back per CO2 fixed. At 25 C with
        //                  vc/vo ~ 3.3 this is 0.5/3.3 = ~15%.
        //   energyPenalty  the drop in efficiency once the ATP diverted
        //                  into salvage is counted too -- larger, and the
        //                  source of the "25-30%" figure in the
        //                  literature.
        //
        // Reporting only one of them invites the reader to check it
        // against the other and conclude the model is wrong.
        const photorespirationLoss = 1 - netCO2 / vc;   // carbon released back

        // ── energy per NET CO2 fixed ───────────────────────────────────
        const atpGross   = vc * ATP_PER_CARBOXYLATION + vo * ATP_PER_OXYGENATION
                         + path.extraAtpPerCO2;
        const nadphGross = vc * NADPH_PER_CARBOXYLATION + vo * NADPH_PER_OXYGENATION;
        const atpPerCO2   = atpGross / netCO2;
        const nadphPerCO2 = nadphGross / netCO2;

        // Efficiency against a hypothetical RuBisCO that never accepted
        // O2: 3 ATP per CO2, plus whatever the concentrating mechanism
        // costs. This is the number worth comparing pathways on.
        const idealAtp = ATP_PER_CARBOXYLATION + path.extraAtpPerCO2;
        const energyPenalty = 1 - idealAtp / atpPerCO2;

        // ── water ──────────────────────────────────────────────────────
        // Transpiration rises steeply with temperature (vapour pressure
        // deficit). Drought closes stomata, which saves water and starves
        // the leaf of CO2 at the same time -- the trade CAM exists to avoid.
        const vpdFactor = 1 + 0.04 * (tempC - 25);
        let waterPerCO2 = path.waterPerCO2 * Math.max(0.3, vpdFactor);
        let carbonGain  = netCO2;
        let stomataOpen = isNight ? !path.stomataByDay : path.stomataByDay;

        if (drought && path.stomataByDay && !isNight) {
            // C3 and C4 must shut their stomata in drought, and then
            // fixation collapses. CAM is unaffected by day because its
            // stomata were already closed.
            stomataOpen = false;
            carbonGain *= 0.15;
            waterPerCO2 *= 0.25;
        }
        if (isNight && path.stomataByDay) {
            // No light: no Calvin cycle for C3/C4. CAM is still capturing.
            carbonGain = 0;
            waterPerCO2 = 0;
        }

        // ── the steps, for the renderer ────────────────────────────────
        const steps = [];
        const push = (compartment, label, tech, extra = {}) =>
            steps.push({ compartment, label, tech, ...extra });

        if (pathId === "CAM" && isNight) {
            push("stoma",     "Stomata open",  "night air is cool and humid",
                 { open: true });
            push("mesophyll", "PEP carboxylase", "CO2 -> oxaloacetate -> malate");
            push("vacuole",   "Malate stored", "acid builds up overnight",
                 { storing: true });
        } else if (pathId === "CAM") {
            push("stoma",     "Stomata SHUT",  "no water lost by day",
                 { open: false });
            push("vacuole",   "Malate released", "the night's store is spent",
                 { storing: false });
            push("mesophyll", "Decarboxylation", "CO2 around RuBisCO, no O2 competition");
            push("chloroplast", "Calvin cycle", `${atpPerCO2.toFixed(1)} ATP per CO2`);
        } else if (pathId === "C4") {
            push("stoma",     stomataOpen ? "Stomata open" : "Stomata SHUT",
                 stomataOpen ? "CO2 in, water out" : "drought -- fixation collapses",
                 { open: stomataOpen });
            push("mesophyll", "PEP carboxylase", "no affinity for O2 at all");
            push("bundle",    "CO2 concentrated", "~10x, so RuBisCO barely sees O2");
            push("chloroplast", "Calvin cycle", `${atpPerCO2.toFixed(1)} ATP per CO2`);
        } else {
            push("stoma",     stomataOpen ? "Stomata open" : "Stomata SHUT",
                 stomataOpen ? "CO2 in, water out" : "drought -- fixation collapses",
                 { open: stomataOpen });
            push("mesophyll", "RuBisCO", "meets CO2 and O2 together");
            if (photorespirationLoss > 0.05) {
                push("peroxisome", "Photorespiration",
                     `${(photorespirationLoss * 100).toFixed(0)}% of carbon lost`,
                     { wasteful: true });
            }
            push("chloroplast", "Calvin cycle", `${atpPerCO2.toFixed(1)} ATP per CO2`);
        }

        return {
            interimOutputs: steps.map((s, i) => ({
                label: s.label, tech: s.tech, depth: 1, parent: "leaf",
                data: new Float32Array([i]), step: s, index: i,
            })),
            finalOutput: {
                pathway: pathId, pathwayName: path.full, note: path.note,
                tempC, isNight, drought, stomataOpen,
                vcOverVo,
                photorespirationLoss,   // carbon released back
                energyPenalty,          // efficiency lost, ATP included
                atpPerCO2, nadphPerCO2,
                waterPerCO2, carbonGain,
                extraAtpPerCO2: path.extraAtpPerCO2,
                steps,
            },
        };
    },
});

if (typeof module !== "undefined" && module.exports) {
    module.exports = { PATHWAYS, specificity, gasRatio };
}

})();
