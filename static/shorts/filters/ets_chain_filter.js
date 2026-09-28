// ---------------------------------------------------------------------------
// filters/ets_chain_filter.js
//
// The electron transport chain as one falling electron pair.
//
// THE IDEA IN ONE LINE
//   Electrons fall from a low redox potential to a high one, and each
//   drop pays for protons to be pushed across a membrane. The proton
//   gradient then drives ATP synthase. Nothing here is a metaphor: the
//   energy released at each step is computable, and it is what does the
//   pumping.
//
//   deltaG = -n F deltaE
//     n = 2   electrons per carrier pair
//     F       Faraday constant, 96485 C/mol
//     deltaE  the potential difference across that complex, in volts
//
// WHY THIS IS A GOOD JOURNEY
//   It is a cascade with a number at every step, which is exactly the
//   shape the engine renders well -- and the inhibitor cases turn it
//   into a working model rather than a diagram. Blocking Complex IV
//   stops the two complexes UPSTREAM of it too, which is the non-obvious
//   part of how cyanide kills.
//
// THE NUMBERS ARE CHECKABLE
//   Standard midpoint potentials at pH 7 (E naught prime). NADH to O2
//   should total about -220 kJ/mol and yield ~2.5 ATP; succinate should
//   give about -150 kJ/mol and ~1.5 ATP. Both are textbook values, so
//   the implementation has an external oracle rather than only internal
//   consistency. See ets_chain.test.js.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

const F = 96485;      // Faraday constant, C/mol
const N_ELECTRONS = 2;

// Midpoint potentials, volts at pH 7. These are the standard values --
// real mitochondria vary with conditions, which is why the journey says
// "standard conditions" on screen rather than implying a measurement.
const CARRIERS = {
    NADH:      -0.320,
    succinate:  0.031,
    ubiquinone: 0.045,
    cytochromeC: 0.254,
    oxygen:     0.816,
};

// Each complex: where electrons enter, where they leave, and how many
// protons that drop pays for. Complex II pumps NOTHING -- its drop is
// too small to pay for one, which is the whole reason FADH2 yields less
// ATP than NADH.
const COMPLEXES = [
    { id: "I",   name: "Complex I",  label: "NADH dehydrogenase",
      from: "NADH",        to: "ubiquinone",  protons: 4,
      inhibitors: ["rotenone"],
      note: "NADH hands over two electrons; the drop pays for four protons" },
    { id: "II",  name: "Complex II", label: "Succinate dehydrogenase",
      from: "succinate",   to: "ubiquinone",  protons: 0,
      inhibitors: ["malonate"],
      note: "Too small a drop to pump anything -- which is why FADH2 yields less" },
    { id: "III", name: "Complex III", label: "Cytochrome bc1",
      from: "ubiquinone",  to: "cytochromeC", protons: 4,
      inhibitors: ["antimycin"],
      note: "The Q cycle moves four protons per pair" },
    { id: "IV",  name: "Complex IV", label: "Cytochrome c oxidase",
      from: "cytochromeC", to: "oxygen",      protons: 2,
      inhibitors: ["cyanide", "carbon_monoxide", "azide"],
      note: "The biggest drop of all, and the one cyanide blocks" },
];

// Protons per ATP: 3 through the synthase rotor plus 1 for transporting
// ATP/ADP/Pi across the membrane. The 10/4 = 2.5 figure comes from here,
// and is why older textbooks saying "3 ATP per NADH" are out of date.
const PROTONS_PER_ATP = 4;

const deltaG = (from, to) =>
    -N_ELECTRONS * F * (CARRIERS[to] - CARRIERS[from]) / 1000;   // kJ/mol


registerDspAlgorithm("ets_chain", {
    process(envelope, parameters) {
        const meta      = envelope.meta ?? {};
        // PARAMETERS beat META: the sample supplies the scenario, but a
        // stage can override it to make a point -- "now block Complex IV"
        // on whichever sample the viewer happens to be on.
        const entry     = meta.entryPoint ?? "NADH";
        const inhibitor = parameters?.inhibitor ?? meta.inhibitor ?? null;
        const uncoupled = parameters?.uncoupled ?? meta.uncoupled ?? false;

        if (!(entry in CARRIERS)) {
            return { error: `ets_chain: unknown entry point "${entry}".` };
        }

        // FADH2 (succinate) enters at Complex II, so Complex I is simply
        // not on its path -- not blocked, just bypassed. Keeping those
        // two cases distinct matters: one is a poison, the other is
        // normal metabolism.
        const path = COMPLEXES.filter(cx =>
            entry === "NADH" ? cx.id !== "II" : cx.id !== "I");

        // Find the block FIRST, because its effect is not local. A
        // blocked complex stops the whole chain: everything upstream
        // backs up (electrons have nowhere to go) and everything
        // downstream starves (none arrive). That is why cyanide acts in
        // minutes -- it does not slow the chain, it stops all of it.
        //
        // An earlier version marked only the complexes AFTER the block,
        // which left Complex I and III still pumping while IV was
        // poisoned -- a cell that would survive cyanide.
        const blockedAt = inhibitor
            ? (path.find(cx => cx.inhibitors.includes(inhibitor))?.id ?? null)
            : null;

        const steps = [];
        let cumulativeProtons = 0;
        let cumulativeG = 0;
        let seenBlock = false;

        for (const cx of path) {
            const blocked = blockedAt !== null && cx.id === blockedAt;
            const flowing = blockedAt === null;

            if (flowing) {
                cumulativeProtons += cx.protons;
                cumulativeG += deltaG(cx.from, cx.to);
            }

            const state = blocked   ? "blocked"
                        : flowing   ? "flowing"
                        : seenBlock ? "starved"     // downstream of the block
                                    : "stalled";    // upstream, backed up
            if (blocked) seenBlock = true;

            steps.push({
                ...cx,
                fromPotential: CARRIERS[cx.from],
                toPotential:   CARRIERS[cx.to],
                deltaE:  CARRIERS[cx.to] - CARRIERS[cx.from],
                deltaG:  deltaG(cx.from, cx.to),
                blocked, flowing, state,
                stalled: state === "stalled",
                starved: state === "starved",
                protonsPumped: flowing ? cx.protons : 0,
                cumulativeProtons,
                cumulativeG,
            });
        }

        // An uncoupler (DNP, thermogenin in brown fat) makes the membrane
        // leaky. Electrons keep flowing and protons keep being pumped --
        // they just leak straight back, so the gradient never builds and
        // the energy leaves as heat. Electron transport is NOT blocked,
        // which is exactly why it is a different failure from cyanide.
        const atpYield = uncoupled ? 0 : cumulativeProtons / PROTONS_PER_ATP;

        const interimOutputs = steps.map((s, i) => ({
            label: s.name,
            tech:  s.blocked ? `BLOCKED by ${inhibitor}`
                 : s.stalled ? "backed up -- electrons cannot leave"
                 : s.starved ? "starved -- no electrons arriving"
                 : `${s.deltaG.toFixed(1)} kJ/mol, ${s.protonsPumped} H+`,
            depth: 1,
            parent: "chain",
            data: new Float32Array([s.fromPotential, s.toPotential,
                                    s.deltaG, s.protonsPumped]),
            step: s,
            index: i,
        }));

        return {
            interimOutputs,
            finalOutput: {
                steps,
                entry, inhibitor, uncoupled,
                blockedAt,
                totalProtons: cumulativeProtons,
                totalDeltaG:  cumulativeG,
                atpYield,
                // Everything the renderer needs for its axis, so it never
                // has to know any biology.
                potentialRange: [CARRIERS.NADH, CARRIERS.oxygen],
                protonsPerAtp:  PROTONS_PER_ATP,
                carriers: CARRIERS,
            },
        };
    },
});

if (typeof module !== "undefined" && module.exports) {
    module.exports = { CARRIERS, COMPLEXES, deltaG, F, PROTONS_PER_ATP };
}

})();
