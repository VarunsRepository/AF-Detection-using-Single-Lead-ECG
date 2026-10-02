// ---------------------------------------------------------------------------
// filters/pathway_filter.js
//
// A GENERIC pathway engine. Give it species and reactions in SBML's
// shape and it works out the order, whether the path closes into a
// cycle, and what is present at each step.
//
// WHY GENERIC
//   ets_chain_filter.js and photosynthesis_filter.js each hardcode their
//   own choreography in JavaScript, so glycolysis would mean writing a
//   third. Here the pathway is DATA: the TCA cycle, the Calvin cycle and
//   glycolysis are three JSON documents against one implementation.
//
// THE ORDER IS NOT IN THE FILE
//   SBML stores two flat lists and no sequence -- reactions may appear in
//   any order. The order emerges from SHARED SPECIES NAMES: one
//   reaction's product is the next one's reactant. So this walks the
//   graph rather than reading the list top to bottom, and a cycle needs
//   no special representation: it is simply a walk that returns to where
//   it started.
//
// THE ATOM BALANCE CHECK
//   Where every species in a reaction declares a chemical formula, the
//   atoms on each side must match. That is a genuine external oracle --
//   a typo in the pathway data fails arithmetic instead of animating
//   plausible but wrong chemistry.
//
//   Reactions involving cofactors (NAD+, CoA, FAD) are reported as
//   UNCHECKED rather than passed: those molecules are large and their
//   formulas are not carried here, so claiming they balance would be a
//   lie of omission. Partial checking, honestly labelled, beats a green
//   tick that means nothing.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// "C6H8O7" -> {C:6, H:8, O:7}
function parseFormula(f) {
    const atoms = {};
    const re = /([A-Z][a-z]?)(\d*)/g;
    let m;
    while ((m = re.exec(f)) !== null) {
        if (!m[1]) continue;
        atoms[m[1]] = (atoms[m[1]] ?? 0) + (m[2] ? parseInt(m[2], 10) : 1);
    }
    return atoms;
}

function sideAtoms(side, species) {
    const total = {};
    for (const [id, n] of Object.entries(side)) {
        const formula = species[id]?.formula;
        if (!formula) return null;              // unknown -> cannot check
        for (const [el, count] of Object.entries(parseFormula(formula))) {
            total[el] = (total[el] ?? 0) + count * n;
        }
    }
    return total;
}

function checkBalance(rx, species) {
    const left  = sideAtoms(rx.reactants, species);
    const right = sideAtoms(rx.products,  species);
    if (!left || !right) return { checked: false };

    const elements = new Set([...Object.keys(left), ...Object.keys(right)]);
    const diffs = [];
    for (const el of elements) {
        const a = left[el] ?? 0, b = right[el] ?? 0;
        if (a !== b) diffs.push(`${el}: ${a} vs ${b}`);
    }
    return { checked: true, balanced: diffs.length === 0, diffs };
}

// Walk the graph from `start`, following shared species names. Stops
// when it returns to the beginning (a cycle) or runs out of reactions
// that can consume what it is holding (a linear path).
function walk(reactions, start, isBoundary, maxSteps = 60) {
    const consumers = {};                       // species -> reactions using it
    for (const rx of reactions) {
        for (const id of Object.keys(rx.reactants)) {
            (consumers[id] ??= []).push(rx);
        }
    }

    const order = [];
    const used  = new Set();
    let current = start;

    for (let i = 0; i < maxSteps; i++) {
        // Prefer a reaction not yet used, so a branch point does not send
        // the walk round the same short loop forever.
        const candidates = consumers[current] ?? [];
        const rx = candidates.find(r => !used.has(r.id)) ?? null;
        if (!rx) break;

        used.add(rx.id);
        order.push(rx);

        // Follow the CARBON BACKBONE only. Boundary species (ATP, ADP,
        // NAD+, water) are excluded, because they are consumed and
        // produced all over a pathway and following one sends the walk
        // sideways into an unrelated reaction.
        //
        // This was not hypothetical: jsonify sorts object keys, so
        // hexokinase's products arrived as {adp, g6p} rather than
        // {g6p, adp}, the walk followed adp to phosphoglycerate kinase,
        // and glycolysis rendered as
        //   glucose -> 1,3-BPG -> fructose-6-P -> PEP
        // Four steps of pure nonsense. Insertion order hid it locally.
        const products = Object.keys(rx.products).filter(p => !isBoundary(p));
        const next = products.find(p => (consumers[p] ?? []).some(r => !used.has(r.id)))
                  ?? products.find(p => p === start)
                  ?? null;

        if (next === start) { order.cyclic = true; break; }
        if (!next) break;
        current = next;
    }
    return order;
}




// ── CONDITIONS ──────────────────────────────────────────────────────────
// A reaction may carry `when`, a small boolean expression over the
// conditions in force:
//
//     "oxygen > 0"
//     "organism == 'yeast'"
//     "oxygen == 0 && organism == 'yeast'"
//
// This REPLACES the earlier tags mechanism. A tag said "this belongs to a
// group I named"; a condition says why the reaction fires, which is the
// actual biology. It also composes: yeast-vs-muscle needed a third tag
// and a third button value, but falls out of two variables here.
//
// Deliberately NOT eval(). The expressions come from pathway data, which
// will eventually be converted from files we did not write, and eval
// would execute anything in them. This parser understands comparisons
// and "&&" and nothing else -- it cannot call, assign or loop.
function evalWhen(expr, ctx) {
    if (!expr) return true;                    // no condition = always fires

    // OR binds loosest: split on "||" first, then each alternative on
    // "&&". Supporting only "&&" did not fail loudly -- the regex below
    // happily matched "a == 'x' || a == 'y'" as ONE comparison whose
    // value was "x' || a == 'y", which never equals anything. Every
    // reaction guarded that way silently vanished, and the pathway
    // reported that nothing consumed its own start species.
    return String(expr).split("||").some(alternative =>
        alternative.split("&&").every(clause => {
        const m = clause.trim().match(
            /^([A-Za-z_][\w.]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
        if (!m) {
            console.warn(`pathway: cannot parse condition "${clause.trim()}"`);
            return true;                       // unparseable = do not hide it
        }
        const [, field, op, rawValue] = m;
        const actual = ctx[field];

        // '...' or "..." is a string; otherwise a number if it looks like
        // one, so oxygen > 0 compares numerically.
        let want = rawValue.trim().replace(/^['"]|['"]$/g, "");
        const quoted = /^['"]/.test(rawValue.trim());
        if (!quoted && want !== "" && !Number.isNaN(Number(want))) want = Number(want);

        switch (op) {
            case "==": return actual === want;
            case "!=": return actual !== want;
            case ">":  return actual >   want;
            case "<":  return actual <   want;
            case ">=": return actual >=  want;
            case "<=": return actual <=  want;
        }
        return true;
        }));
}

// ── NAVIGATION TAPE ─────────────────────────────────────────────────────
// A flat log of what the walk DID, rather than a list of what it found:
//
//   move   advanced along a reaction
//   push   hit a fork, walked one arm, deferred the other
//   pop    that arm ended, returning to the deferred one
//
// Push/pop makes this a CALL STACK, which is what a branch actually is --
// a detour that returns. Nesting then costs nothing extra: a fork inside
// a fork is just a deeper stack.
//
// The tape is also what a windowed renderer needs: showing "two before,
// current, two after" requires a linear sequence, and a graph is not one.
function buildTape(reactions, species, start) {
    const isBoundary = id => species[id]?.boundary === true;

    // Index EVERY reactant, boundary or not -- matching walk() exactly.
    //
    // Skipping boundary species here meant the tape could not begin when
    // the start species was itself a boundary one (NAD+, ATP, water):
    // consumers[start] was empty, the loop exited immediately, and the
    // navigator showed an empty buffer while the map -- which uses the
    // other walk -- rendered the pathway perfectly.
    //
    // Two walks that disagree is the real fault. Boundary species are
    // still excluded from the CHOICE of what to follow next, which is
    // where that rule belongs: it stops the walk wandering off down ATP.
    const consumers = {};
    for (const rx of reactions) {
        for (const id of Object.keys(rx.reactants)) {
            (consumers[id] ??= []).push(rx);
        }
    }

    const visited = new Set();

    // How far the walk could get down an arm before running out of
    // unvisited reactions. Used to take the SHORTER arm first, so a fork
    // reads as a quick detour that returns rather than a long departure
    // leaving a loose end. Capped, because a cycle has no end.
    function armLength(rx, seen = new Set(), depth = 0) {
        if (depth > 12 || seen.has(rx.id) || visited.has(rx.id)) return depth;
        seen.add(rx.id);
        let best = depth + 1;
        for (const p of Object.keys(rx.products)) {
            if (isBoundary(p)) continue;
            for (const nxt of consumers[p] ?? []) {
                if (seen.has(nxt.id) || visited.has(nxt.id)) continue;
                best = Math.max(best, armLength(nxt, seen, depth + 1));
            }
        }
        return best;
    }

    const tape = [];
    const branches = [];
    const stack = [];              // deferred arms, innermost last
    let current = start;
    let cyclic = false;

    for (let guard = 0; guard < 200; guard++) {
        const options = (consumers[current] ?? []).filter(r => !visited.has(r.id));

        if (options.length === 0) {
            if (stack.length === 0) break;
            const resume = stack.pop();
            tape.push({ type: "pop", depth: stack.length, to: resume.species });
            current = resume.species;
            continue;
        }

        // Shortest arm first; the rest are deferred in the same order so
        // the eventual pops are predictable.
        options.sort((a, b) => armLength(a) - armLength(b));
        const [chosen, ...deferred] = options;

        if (deferred.length) {
            branches.push({
                species: current,
                taken: chosen.id,
                deferred: deferred.map(r => r.id),
            });
            for (const d of deferred) stack.push({ species: current, via: d.id });
            tape.push({ type: "push", depth: stack.length, at: current,
                        taken: chosen.id, deferred: deferred.map(r => r.id) });
        }

        visited.add(chosen.id);
        const products = Object.keys(chosen.products).filter(p => !isBoundary(p));
        const onward = products.filter(p => (consumers[p] ?? [])
                                    .some(r => !visited.has(r.id)));

        // The move is recorded BEFORE any fork is noted, so the reaction
        // that CAUSED the fork stays on the trunk. Recording the push
        // first marked aldolase itself as a side branch, which is
        // backwards -- it is the junction, not the detour.
        const provisional = onward[0] ?? (products.includes(start) ? start : null);
        tape.push({ type: "move", depth: stack.length, reaction: chosen.id,
                    from: current, to: provisional });

        // A product fork -- aldolase making DHAP and GAP -- is the same
        // situation seen from the other side, so it defers identically.
        let next = provisional;
        if (onward.length > 1) {
            const mergeDistance = (from, target) => {
                const seen = new Set();
                let frontier = [from], d = 0;
                while (frontier.length && d < 12) {
                    const nxt = [];
                    for (const sp of frontier) {
                        if (sp === target && d > 0) return d;
                        if (seen.has(sp)) continue;
                        seen.add(sp);
                        for (const rx of consumers[sp] ?? []) {
                            if (visited.has(rx.id)) continue;
                            for (const p of Object.keys(rx.products)) {
                                if (!isBoundary(p)) nxt.push(p);
                            }
                        }
                    }
                    frontier = nxt; d++;
                }
                return Infinity;
            };
            // Take the arm that REJOINS SOONEST. DHAP reaches GAP in one
            // reaction; GAP never returns to DHAP. By arm LENGTH the two
            // look identical, because they merge and then share
            // everything -- which stranded the one-step detour at the
            // very end of the tape, after the pathway had finished.
            const sorted = onward.slice().sort((a, b) => {
                const da = Math.min(...onward.filter(o => o !== a).map(o => mergeDistance(a, o)));
                const db = Math.min(...onward.filter(o => o !== b).map(o => mergeDistance(b, o)));
                return da - db;
            });
            for (const extra of sorted.slice(1)) stack.push({ species: extra, via: null });
            branches.push({ species: chosen.id, taken: sorted[0],
                            deferred: sorted.slice(1) });
            tape.push({ type: "push", depth: stack.length, at: chosen.id,
                        taken: sorted[0], deferred: sorted.slice(1) });
            next = sorted[0];
            tape[tape.length - 2].to = next;
        }

        // Pop as soon as the detour REJOINS -- the deferred species has
        // just been produced, so there is nothing left to come back to.
        // Waiting until the walk dead-ends marked every later reaction
        // as still being on the branch.
        while (stack.length && next && stack[stack.length - 1].species === next) {
            stack.pop();
            tape.push({ type: "pop", depth: stack.length, to: next });
        }

        if (next === start) { cyclic = true; break; }
        if (!next) { current = null; continue; }
        current = next;
    }

    return { tape, branches, cyclic, order: tape.filter(t => t.type === "move") };
}

registerDspAlgorithm("pathway", {

    // What the user can vary FOR THIS DATA. The engine builds rail
    // buttons from this, so a pathway with no declared conditions gets no
    // buttons -- which is the fix for a "Route" control appearing on the
    // citric acid cycle and doing nothing, because no reaction there was
    // ever conditional.
    //
    // Enumerable values only for now. A button cycling three temperatures
    // is fine; a continuous range needs a slider, which does not exist.
    choices(envelope) {
        const declared = envelope?.meta?.pathway?.conditions ?? {};
        const fromSample = envelope?.meta?.conditions ?? {};
        return Object.entries(declared)
            .filter(([, spec]) => (spec.values ?? []).length > 1)
            .map(([key, spec]) => ({
                key,
                label:  spec.label ?? key,
                values: spec.values,
                // The EFFECTIVE value right now, so the button can show
                // it before the user has touched anything. Sample first,
                // then the pathway's default -- the same precedence
                // process() uses, or the label would disagree with the
                // walk it is describing.
                value: fromSample[key] ?? spec.default ?? spec.values[0],
                // Optional display names: oxygen 1/0 reads better as
                // "present"/"absent" than as numbers on a button.
                display: spec.display ?? null,
            }));
    },

    process(envelope, parameters) {
        const model = envelope.meta?.pathway ?? parameters?.pathway;
        if (!model || !model.reactions || !model.species) {
            return { error: "pathway needs meta.pathway with `species` and "
                          + "`reactions` (SBML-shaped)." };
        }

        const { species } = model;

        // ── CONDITIONS IN FORCE ────────────────────────────────────────
        // Three layers, innermost wins: the pathway's declared defaults,
        // then whatever the sample sets, then whatever the user picked on
        // the rail. Filtering happens BEFORE the walk, so the data stays
        // a superset -- one network, different active subsets, which is
        // how real metabolic models are written.
        const declared = model.conditions ?? {};
        const ctx = {};
        for (const [key, spec] of Object.entries(declared)) {
            ctx[key] = spec.default ?? spec.values?.[0];
        }
        for (const key of Object.keys(declared)) {
            if (envelope.meta?.conditions?.[key] !== undefined) {
                ctx[key] = envelope.meta.conditions[key];
            }
            if (parameters?.[key] !== undefined) ctx[key] = parameters[key];
        }

        const reactions = model.reactions.filter(rx => evalWhen(rx.when, ctx));
        const start = model.start ?? Object.keys(species)[0];
        // "auto" means "whatever THIS pathway's regulated step is", so a
        // stage can say "now block it" without naming a reaction that may
        // not exist. Hardcoding "sdh" made that stage inert on glycolysis
        // -- it silently blocked nothing and looked identical to stage 1.
        const requested = parameters?.blocked ?? envelope.meta?.blocked ?? null;
        const blocked = requested === "auto" ? (model.defaultBlock ?? null) : requested;

        const isBoundaryFn = id => species[id]?.boundary === true;
        const order = walk(reactions, start, isBoundaryFn);
        const nav = buildTape(reactions, species, start);
        if (order.length === 0) {
            return { error: `pathway: nothing consumes "${start}" -- check the `
                          + `start species name.` };
        }

        // Where the routes part company: a species consumed by reactions
        // belonging to different routes. Reported so the card can say a
        // choice was made and another road existed -- otherwise the
        // anaerobic route just looks like the whole story.
        const junctions = [];
        {
            // A species consumed by several CONDITIONAL reactions is a
            // place where the conditions decide the outcome. Reported so
            // the card can name the road not taken -- otherwise one route
            // looks like the whole story.
            const bySpecies = {};
            for (const rx of model.reactions) {
                if (!rx.when) continue;
                for (const id of Object.keys(rx.reactants)) {
                    if (species[id]?.boundary) continue;
                    (bySpecies[id] ??= []).push({ id: rx.id, when: rx.when,
                                                  name: rx.name ?? rx.id });
                }
            }
            for (const [id, opts] of Object.entries(bySpecies)) {
                if (opts.length > 1) junctions.push({ species: id, options: opts });
            }
        }

        // Balance every reaction IN THE MODEL, not just the active route:
        // a typo in a reaction this route happens to skip is still a typo.
        const balance = model.reactions.map(rx => ({ id: rx.id, ...checkBalance(rx, species) }));
        const unbalanced = balance.filter(b => b.checked && !b.balanced);
        const unchecked  = balance.filter(b => !b.checked).length;

        // Fire each reaction in turn. `pool` is what has been produced so
        // far -- the tokens the renderer moves.
        // BOUNDARY SPECIES are treated as always available -- SBML's own
        // `boundaryCondition` flag, for pools the model does not track:
        // water, NAD+, CoA, and the acetyl-CoA feeding the cycle. Without
        // this nothing fires at all, because citrate synthase needs three
        // reactants and the walk only ever starts holding one.
        const isBoundary = isBoundaryFn;
        const pool = { [start]: 1 };

        // FEEDER REACTIONS -- every reactant is a boundary species, so
        // they can always run and are not part of the ring the walk
        // finds. Carbamoyl-phosphate synthetase is the example: it makes
        // carbamoyl-P from ammonia, CO2 and ATP, and without seeding it
        // the urea cycle's first real step has no substrate and NOTHING
        // fires. They are reported separately so the card can say where
        // the material came from, rather than being silently hidden.
        const feeders = reactions.filter(rx =>
            !order.some(o => o.id === rx.id) &&
            Object.keys(rx.reactants).every(id => isBoundary(id)));
        for (const rx of feeders) {
            for (const [id, n] of Object.entries(rx.products)) {
                if (!isBoundary(id)) pool[id] = (pool[id] ?? 0) + n;
            }
        }
        let stalled = false;
        const steps = order.map((rx, i) => {
            const isBlocked = blocked && rx.id === blocked;
            // A reaction can only fire if its reactants are present. That
            // single rule gives inhibition for free: block one reaction
            // and everything after it starves, with no special-casing.
            const canFire = !isBlocked && !stalled &&
                            Object.keys(rx.reactants)
                                  .every(id => isBoundary(id) || (pool[id] ?? 0) > 0);
            if (isBlocked || !canFire) stalled = true;

            if (canFire) {
                for (const [id, n] of Object.entries(rx.reactants)) {
                    if (!isBoundary(id)) pool[id] = (pool[id] ?? 0) - n;
                }
                for (const [id, n] of Object.entries(rx.products)) {
                    if (!isBoundary(id)) pool[id] = (pool[id] ?? 0) + n;
                }
            }

            return {
                id: rx.id,
                name: rx.name ?? rx.id,
                reactants: rx.reactants,
                products:  rx.products,
                // How many times this reaction happens per molecule of
                // the starting substrate. Glycolysis splits in two, so
                // everything below aldolase runs twice -- the walk still
                // visits it once, but the LEDGER must count it twice or
                // the textbook net +2 ATP comes out as 0.
                runs: rx.runs ?? 1,
                // What this single reaction spends and makes, for the
                // slot beside it, as distinct from the running total.
                cofactorsIn: Object.entries(rx.reactants)
                    .filter(([id]) => isBoundary(id))
                    .map(([id, q]) => ({ name: species[id]?.name ?? id, q })),
                cofactorsOut: Object.entries(rx.products)
                    .filter(([id]) => isBoundary(id))
                    .map(([id, q]) => ({ name: species[id]?.name ?? id, q })),
                modifiers: rx.modifiers ?? [],
                note: rx.note ?? "",
                blocked: isBlocked,
                fired: canFire,
                index: i,
                pool: { ...pool },
            };
        });

        // ── COFACTOR LEDGER ────────────────────────────────────────────
        // ATP, NADH and the rest are boundary species, so the walk skips
        // them -- correct for pathfinding, but it meant the accounting
        // that IS the lesson of glycolysis never appeared anywhere.
        //
        // `runs` matters here: the lower half happens twice per glucose,
        // and without it the books' net +2 ATP comes out as 0.
        const ledger = {}, turnover = {};
        for (const s of steps) {
            if (!s.fired) continue;
            const n = s.runs ?? 1;
            for (const [id, q] of Object.entries(s.reactants)) {
                if (!species[id]?.boundary) continue;
                ledger[id]   = (ledger[id]   ?? 0) - q * n;
                turnover[id] = (turnover[id] ?? 0) + q * n;
            }
            for (const [id, q] of Object.entries(s.products)) {
                if (!species[id]?.boundary) continue;
                ledger[id]   = (ledger[id]   ?? 0) + q * n;
                turnover[id] = (turnover[id] ?? 0) + q * n;
            }
        }
        // Net zero is NOT nothing happening. In fermentation NADH is
        // spent and remade in equal measure -- and regenerating NAD+ is
        // the entire reason the pathway has that step. Dropping anything
        // that nets to zero would hide the point, so a balanced cofactor
        // is kept and flagged.
        const cofactors = Object.entries(turnover)
            .map(([id, moved]) => ({
                id, name: species[id]?.name ?? id,
                net: ledger[id] ?? 0,
                moved,
                balanced: (ledger[id] ?? 0) === 0,
            }))
            .filter(c => c.moved > 0)
            .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.moved - a.moved);

        return {
            interimOutputs: steps.map(s => ({
                label: s.name,
                tech:  s.blocked ? "BLOCKED"
                     : !s.fired  ? "no substrate -- starved"
                     : Object.keys(s.reactants).join(" + ") + "  \u2192  "
                       + Object.keys(s.products).join(" + "),
                depth: 1, parent: "pathway",
                data: new Float32Array([s.index]),
                step: s,
            })),
            finalOutput: {
                // ── VOCABULARY ─────────────────────────────────────────
                // Every visible label comes from here, so a model can
                // name its own parts. The engine is not biochemistry --
                // it walks typed things that turn into other typed
                // things -- but every string in the renderers said
                // "reaction" and "metabolite", which would read as
                // nonsense on a compiler pass or a psychological model.
                //
                // Defaults keep the biology cards reading exactly as
                // before; a model overrides only what differs.
                vocabulary: {
                    node:   "metabolite",
                    edge:   "reaction",
                    edges:  "reactions",
                    side:   "cofactor",
                    sides:  "cofactors",
                    cycle:  "cycle",
                    chain:  "chain",
                    branch: "side branch",
                    per:    "per",
                    ...(model.vocabulary ?? {}),
                },
                // Navigation tape: move/push/pop, for a windowed renderer.
                // Built alongside the existing step list rather than
                // replacing it, so pathway_view keeps working unchanged.
                tape:     nav.tape,
                branches: nav.branches,
                // An empty tape is almost always a start that nothing
                // consumes -- a typo, or a species that only ever appears
                // as a product. Saying so beats an empty buffer.
                tapeNote: nav.tape.length ? null
                        : `nothing consumes "${start}" -- check the start `
                          + `species name, or whether it only appears as a product`,
                name: model.name ?? "pathway",
                cyclic: order.cyclic === true,
                start,
                steps,
                species,
                stepCount: steps.length,
                firedCount: steps.filter(s => s.fired).length,
                blocked,
                cofactors,
                conditions: ctx,
                declaredConditions: declared,
                // Rendered on the card. Without it the walk shows a fate
                // with no statement of WHY that fate -- the viewer sees
                // lactate and cannot tell which button produced it.
                conditionSummary: Object.entries(ctx).map(([k, v]) => {
                    const spec = declared[k] ?? {};
                    const shown = spec.display?.[String(v)] ?? v;
                    return `${spec.label ?? k}: ${shown}`;
                }).join("  \u00b7  "),
                junctions,
                // Every reaction's name, including ones this route skips.
                // finalOutput.steps holds only ACTIVE reactions, so the
                // card naming "the other route" had nothing to look up
                // and printed a raw id.
                reactionNames: Object.fromEntries(
                    model.reactions.map(r => [r.id, r.name ?? r.id])),
                feeders: feeders.map(r => ({ id: r.id, name: r.name ?? r.id })),
                balance: {
                    total: balance.length,
                    checked: balance.length - unchecked,
                    unchecked,
                    unbalanced: unbalanced.map(b => `${b.id}: ${b.diffs.join(", ")}`),
                    allBalanced: unbalanced.length === 0,
                },
            },
        };
    },
});

if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseFormula, checkBalance, walk };
}

})();
