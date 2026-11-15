// ---------------------------------------------------------------------------
// static/shorts/filters/ecg_noise_filter.js
//
// THE MISSING STEP BETWEEN THE PRIMER AND THE REAL WORLD.
//
// /journey/ecg_primer ends on stage 5 by dropping a real recording in
// front of the viewer with no warning. Four stages of textbook beat, then
// a wall of fuzz. The jump is too big: the viewer is asked to accept that
// the second thing is the first thing, and nothing on screen argues it.
//
// This journey is that argument, made one artefact at a time. The clean
// beat stays on screen as a ghost for every stage, so each imperfection
// is visible as a DIFFERENCE rather than as a new picture.
//
//   textbook     the primer's beat, unchanged. The reference.
//   wander       the chest moves. The whole trace rides up and down.
//   mains        the building leaks in at one exact frequency.
//   emg          muscle. Broadband fuzz that overlaps the QRS.
//   motion       a lead is tugged. Transient, and QRS-shaped.
//   electrode    an electrode lifts. Not an error -- an absence.
//   all          the scenario's real mix, which is all of them at once.
//   recovered    the 5-15 Hz bandpass, and what it costs.
//
// WHY CUMULATIVE AND NOT ONE-AT-A-TIME
//   The main trace accumulates, because "gradually move from ideal to
//   real" is a cumulative claim. But the artefact INTRODUCED at each
//   stage is also drawn alone, underneath, because recognising wander by
//   its shape is the skill the stage is actually teaching. Cumulative
//   alone teaches that it gets worse; isolated alone teaches names
//   without consequence. Both together is the lesson.
//
// WHAT THIS FILE DOES NOT DO
//   It does not detect anything. There is no peak finder here and no
//   claim about where the beats are. The beat positions come from the
//   source, which knows them because it GENERATED them -- and that is
//   also why the last stage can say truthfully how many beats survive
//   the filter, which a detector-based version could not.
//
// THE ORACLE
//   Lives in the source, not here: catalog/sources/ecg_noise.py asserts
//   at import that the bandpass removes the wander and the mains and
//   keeps the QRS, by band power, and that assertion is what the final
//   stage's caption reports. This file's own contribution to the oracle
//   is a reconstruction identity -- the mixed trace minus the artefacts
//   it added must equal the clean trace to within float error. If a
//   severity weight is ever applied twice, or an array goes missing, the
//   identity breaks and the console says so at load. See selfCheck().
// ---------------------------------------------------------------------------

(function () {
    "use strict";

    // The ONE source of truth for artefact order and labelling. Stage
    // params name these ids; the rail names them; the renderer labels
    // them. A second list somewhere else is how the DRM box labels went
    // out of sync with the pipeline they described.
    const ARTEFACTS = [
        { id: "wander",
          label: "Baseline wander",
          cause: "The chest moves as you breathe, and the electrodes move with it.",
          band:  "0.09 and 0.28 Hz" },
        { id: "mains",
          label: "Mains interference",
          cause: "The building's wiring couples into the leads.",
          band:  "one exact frequency, plus a weak 3rd harmonic" },
        { id: "emg",
          label: "Muscle noise (EMG)",
          cause: "Skeletal muscle firing near the electrode.",
          band:  "broadband, above ~20 Hz" },
        { id: "motion",
          label: "Motion artefact",
          cause: "A lead is tugged, or the skin-gel contact shifts.",
          band:  "transient, below 2 Hz -- and QRS-shaped" },
        { id: "electrode",
          label: "Electrode disconnect",
          cause: "An electrode lifts. The amplifier saturates, then settles.",
          band:  "not a band at all" },
    ];

    const BY_ID = Object.fromEntries(ARTEFACTS.map((a) => [a.id, a]));

    // ── Demonstration levels ──────────────────────────────────────────
    // THE TEACHING STAGES DO NOT USE THE SCENARIO'S MIX, and this is the
    // most important decision in the file.
    //
    // Found by plotting all eight stages for all six scenarios and
    // looking at them. On "Ward bed, poor earth" the scenario mixes motion
    // at 0.0 and electrode at 0.0 -- correctly, a patient lying still in a
    // bed has neither -- so the stage titled "Motion artefact" drew a
    // trace with no motion in it, and the stage titled "Electrode
    // disconnect" drew no disconnect. Two cards naming a thing that was
    // not on screen. Six scenarios x eight stages x four severities of
    // assertions all passed, because every one of them checked a property
    // I had thought of. The picture checked the one I had not.
    //
    // So stages 2-6 show each artefact at a level chosen to be legible,
    // and the SCENARIO's own mix arrives at stage 7, which is where it
    // means something: "you have now seen all five -- here is how much of
    // each your situation actually has." The cards say which they are
    // showing. These numbers are the ambulance mix, because plotting
    // showed that one to be legible for every artefact at once.
    const DEMO = { wander: 1.3, mains: 0.8, emg: 1.3,
                   motion: 1.4, electrode: 0.7 };

    // ── Severity ──────────────────────────────────────────────────────
    // A multiplier on top of the scenario's own mix, exposed as a rail
    // control. The scenario mix says WHAT this situation does; severity
    // says how bad today is. 0 is included deliberately: being able to
    // take the noise back to zero on any stage, and watch the trace fall
    // onto its own ghost, is the clearest possible statement that the
    // ghost and the trace are the same signal.
    const SEVERITY = [
        { value: 0.0, label: "None" },
        { value: 0.5, label: "Mild" },
        { value: 1.0, label: "As recorded" },
        { value: 2.0, label: "Severe" },
    ];

    function arr(a) {
        if (!a) return null;
        return (a instanceof Float32Array) ? a : Float32Array.from(a);
    }

    // ── The filter the last stage is about ────────────────────────────
    // Two poles per section, matching the source's Python so the browser
    // and the oracle filter the same way. A single pole was tried first
    // and left 8% of the mains power standing, which failed the source's
    // own band-power check -- the cascade is not decoration.
    function onePoleHp(x, fc, fs) {
        const dt = 1 / fs, rc = 1 / (2 * Math.PI * fc);
        const a = rc / (rc + dt);
        const y = new Float32Array(x.length);
        let prevX = x[0], prevY = 0;
        for (let i = 0; i < x.length; i++) {
            prevY = a * (prevY + x[i] - prevX);
            prevX = x[i];
            y[i] = prevY;
        }
        return y;
    }

    function onePoleLp(x, fc, fs) {
        const dt = 1 / fs, rc = 1 / (2 * Math.PI * fc);
        const a = dt / (rc + dt);
        const y = new Float32Array(x.length);
        let prevY = x[0];
        for (let i = 0; i < x.length; i++) {
            prevY = prevY + a * (x[i] - prevY);
            y[i] = prevY;
        }
        return y;
    }

    function bandpass5to15(x, fs) {
        let y = onePoleHp(x, 5, fs);
        y = onePoleHp(y, 5, fs);
        y = onePoleLp(y, 15, fs);
        y = onePoleLp(y, 15, fs);
        return y;
    }

    // ── Mixing ────────────────────────────────────────────────────────
    // ONE function builds every stage's trace, so no stage can mix
    // differently from another by accident. `active` is the cumulative
    // set; the returned `parts` carries each contribution at the weight
    // actually used, which is what makes the reconstruction check below
    // meaningful rather than circular.
    function mix(a, clean, mixWeights, active, severity) {
        const n = clean.length;
        const out = new Float32Array(n);
        out.set(clean);
        const parts = {};

        for (const id of active) {
            const src = a[id];
            if (!src) continue;
            const w = (Number(mixWeights?.[id]) || 0) * severity;
            if (w === 0) { parts[id] = { w: 0, y: null }; continue; }

            const contrib = new Float32Array(n);
            for (let i = 0; i < n; i++) contrib[i] = src[i] * w;
            for (let i = 0; i < n; i++) out[i] += contrib[i];
            parts[id] = { w, y: contrib };
        }

        // The electrode mask is NOT additive and must come last. A lifted
        // electrode does not add a voltage to the heartbeat; it replaces
        // the trace with whatever the saturated amplifier is doing. Adding
        // it would draw a heartbeat riding on top of a dropout, which is
        // the one thing a disconnect never looks like.
        const useMask = active.includes("electrode") && a.emask && severity > 0;
        let masked = null;
        if (useMask) {
            const mw = Math.min(1, (Number(mixWeights?.electrode) || 0) * severity);
            masked = [];
            for (let i = 0; i < n; i++) {
                const m = a.emask[i] * mw;
                if (m > 0.001) masked.push(i);
                out[i] = out[i] * (1 - m) + (a.electrode ? a.electrode[i] : 0) * m;
            }
        }

        return { y: out, parts, maskedIdx: masked };
    }

    const impl = {
        id: "ecg_noise",
        label: "From textbook to real",

        // Rail controls are built from this, not from a list in the
        // recipe. The DSPE declares what it can actually vary; a recipe
        // that invented a fourth severity would be offering a control the
        // filter does not honour.
        // SHAPE MATTERS, and the first version got every field wrong.
        //
        // journey_interpreter.js does:
        //     (algo?.choices?.(envelope) ?? []).map(c => ...)
        // so this must return an ARRAY. Returning an object made .map
        // throw, the interpreter caught it with console.warn("choices()
        // failed"), and the whole derived rail silently disappeared --
        // no button, no error on screen.
        //
        // The engine builds the button itself from these fields and
        // dispatches setParameter with operation "cycle". The recipe
        // does NOT declare this control; it can only veto or rename it
        // through stage.choiceControls, which is deliberate -- a recipe
        // that could invent an option the DSPE never declared is how a
        // button ends up setting a parameter nothing reads.
        choices() {
            return [{
                key:    "severity",
                label:  "Severity",
                values: SEVERITY.map((s) => s.value),
                value:  1.0,                       // seeds the parameter
                display: Object.fromEntries(
                    SEVERITY.map((s) => [String(s.value), s.label])),
            }];
        },

        process(input, params) {
            const p = params || {};
            const meta = input?.meta || {};
            const fs = Number(input?.fs) || Number(meta.fs) || 360;

            const a = {
                clean:     arr(input?.arrays?.clean     ?? input?.clean),
                wander:    arr(input?.arrays?.wander    ?? input?.wander),
                mains:     arr(input?.arrays?.mains     ?? input?.mains),
                emg:       arr(input?.arrays?.emg       ?? input?.emg),
                motion:    arr(input?.arrays?.motion    ?? input?.motion),
                electrode: arr(input?.arrays?.electrode ?? input?.electrode),
                emask:     arr(input?.arrays?.emask     ?? input?.emask),
            };

            if (!a.clean) {
                return { finalOutput: { error: "ecg_noise: no clean array" } };
            }

            const severity = (p.severity === undefined || p.severity === null)
                ? 1.0 : Number(p.severity);

            // Cumulative set. A stage names `upTo`, and the active set is
            // every artefact from the start of ARTEFACTS to that one --
            // so the order of the stages cannot disagree with the order
            // of the list, because it IS the order of the list.
            const upTo = p.upTo || null;
            let active = [];
            if (upTo) {
                const stop = ARTEFACTS.findIndex((x) => x.id === upTo);
                active = ARTEFACTS.slice(0, stop + 1).map((x) => x.id);
            } else if (p.all) {
                active = ARTEFACTS.map((x) => x.id);
            }

            // Teaching stages demonstrate; the payoff stages report. See
            // the DEMO comment -- this is the line that stops a card
            // naming an artefact the scenario happens to zero out.
            const teaching = !!upTo;
            const mixWeights = teaching ? DEMO : (meta.mix || {});
            const m = mix(a, a.clean, mixWeights, active, severity);

            // The artefact this stage introduces, drawn alone underneath.
            const focusId = upTo || null;
            const focus = focusId ? {
                ...BY_ID[focusId],
                // The electrode artefact is multiplicative -- it REPLACES
                // the trace rather than adding to it -- so its additive
                // "contribution" is not what the viewer is seeing. Drawing
                // it would be drawing a component that does not exist.
                // For that one the renderer gets the mask window instead,
                // which is the honest isolated picture: here is where the
                // signal is absent.
                y: focusId === "electrode" ? null : (m.parts[focusId]?.y || null),
                isMask: focusId === "electrode",
                mask: focusId === "electrode" ? (a.emask || null) : null,
                weight: m.parts[focusId]?.w ?? 0,
                // What THIS scenario actually has of it, so the card can
                // be honest that the level on screen is a demonstration.
                scenarioWeight: Number(meta.mix?.[focusId]) || 0,
                // The source's own band description, where it has one.
                band: meta.bands?.[focusId] || BY_ID[focusId].band,
            } : null;

            const wantFilter = !!p.filter;
            const filtered = wantFilter ? bandpass5to15(m.y, fs) : null;

            // What the filter costs, stated in the same units for both --
            // peak-to-peak of the clean QRS before and after. The number
            // on the card is this, not a claim from memory.
            let cost = null;
            if (wantFilter) {
                const fc = bandpass5to15(a.clean, fs);
                const pp = (x) => {
                    let lo = Infinity, hi = -Infinity;
                    for (let i = 0; i < x.length; i++) {
                        if (x[i] < lo) lo = x[i];
                        if (x[i] > hi) hi = x[i];
                    }
                    return hi - lo;
                };
                cost = { keptFrac: pp(fc) / pp(a.clean) };
            }

            return {
                finalOutput: {
                    fs,
                    clean: a.clean,          // the ghost, on every stage
                    y: m.y,                  // the cumulative trace
                    filtered,
                    focus,                   // the artefact just added
                    maskedIdx: m.maskedIdx,  // where the trace is absent
                    active,
                    teaching,       // demonstration levels, not the scenario's
                    demoMix: teaching ? DEMO : null,
                    severity,
                    severityLabel: (SEVERITY.find((s) => s.value === severity)
                                    || {}).label || `${severity}x`,
                    cost,
                    artefacts: ARTEFACTS,
                    truthR: meta.truthR || null,
                    mainsHz: meta.mainsHz ?? null,
                    scenario: { id: meta.id, name: meta.name,
                                blurb: meta.blurb, mix: mixWeights },
                    provenance: {
                        signal: "synthetic -- beat positions are exact " +
                                "because the source generated them",
                        artefacts: meta.source || null,
                    },
                },
            };
        },
    };

    // ── The reconstruction identity ───────────────────────────────────
    // The mixed trace minus the contributions it reports must be the
    // clean trace. This catches a severity weight applied twice, a part
    // reported at a different weight than it was summed at, and an array
    // silently missing -- none of which would look wrong on screen,
    // because a slightly-too-noisy trace looks exactly like a noisy one.
    //
    // The electrode mask is excluded: it is multiplicative by design, so
    // it is not part of an additive identity. That exclusion is the
    // reason the mask is applied last and separately.
    function selfCheck() {
        const fs = 360, n = 1024;
        const rnd = (seed) => {
            let s = seed;
            return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
        };
        const mk = (seed) => {
            const r = rnd(seed), x = new Float32Array(n);
            for (let i = 0; i < n; i++) x[i] = r();
            return x;
        };
        const a = { clean: mk(1), wander: mk(2), mains: mk(3),
                    emg: mk(4), motion: mk(5), electrode: mk(6), emask: null };
        const weights = { wander: 0.7, mains: 1.3, emg: 0.4, motion: 0.9 };
        const active = ["wander", "mains", "emg", "motion"];

        const problems = [];
        for (const sev of [0, 0.5, 1, 2]) {
            const m = mix(a, a.clean, weights, active, sev);
            let worst = 0;
            for (let i = 0; i < n; i++) {
                let v = m.y[i];
                for (const id of active) {
                    const part = m.parts[id];
                    if (part && part.y) v -= part.y[i];
                }
                worst = Math.max(worst, Math.abs(v - a.clean[i]));
            }
            if (worst > 1e-5) {
                problems.push(`severity ${sev}: residual ${worst.toExponential(2)}`);
            }
            if (sev === 0) {
                let same = true;
                for (let i = 0; i < n; i++) {
                    if (Math.abs(m.y[i] - a.clean[i]) > 1e-6) { same = false; break; }
                }
                if (!same) problems.push("severity 0 does not return the clean trace");
            }
        }

        if (problems.length) {
            console.warn("[ECG-NOISE] the mix does not reconstruct: " +
                         problems.join("; ") + ". A stage is drawing a " +
                         "trace it is not describing.");
        }
        return { ok: problems.length === 0, problems };
    }

    if (typeof registerDspAlgorithm === "function") {
        registerDspAlgorithm(impl.id, impl);
        selfCheck();
    } else if (typeof module !== "undefined") {
        module.exports = { impl, ARTEFACTS, SEVERITY, mix,
                           bandpass5to15, selfCheck };
    }
})();