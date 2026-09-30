// ---------------------------------------------------------------------------
// renderers/pathway_view.js
//
// Draws whatever pathway the DSPE walked: a RING when the path closes on
// itself, a CHAIN when it does not.
//
// WHY THE SHAPE IS CHOSEN, NOT DECLARED
//   The DSPE already discovered whether the walk returned to its starting
//   species. A cycle drawn as a straight line hides the one fact that
//   matters about it -- that the last product feeds the first reaction --
//   so the layout follows the topology rather than an author's setting.
//
// WHAT IS DRAWN
//   metabolites  nodes around the ring, named
//   reactions    the arcs between them, labelled with the enzyme
//   the active step lit, everything already fired dimmed but present
//   blocked or starved steps in red, so a stall is visible as a gap in
//   the circle rather than an absence of motion
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("pathway_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }
        const fo = dspOutput.finalOutput ?? {};
        const steps = fo.steps ?? [];
        if (!steps.length) {
            container.innerHTML = `<p style="color:#ff4d4d;padding:20px;">Empty pathway.</p>`;
            return;
        }

        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);
        const iw = container.offsetWidth || 390, ih = container.offsetHeight || 440;
        canvas.width = Math.round(iw * useDPR); canvas.height = Math.round(ih * useDPR);
        canvas.style.width = iw + "px"; canvas.style.height = ih + "px";
        // Resizing a canvas CLEARS it. The observer fires after the first
        // paint, so without repainting here the card is blank until
        // something else happens to draw -- which is why restarting the
        // stage "fixed" it: the restart started a sweep loop.
        //
        new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width = Math.round(width * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px"; canvas.style.height = height + "px";
            // Resizing a canvas CLEARS it, and the observer fires AFTER the
            // first paint -- so without this the card goes blank until
            // something else happens to draw. Replaying the sweep loop's
            // last frame works for every renderer without knowing its
            // internal draw function: activeSweepControl already stores
            // both the draw callback and the elapsed time it last used.
            const _ctl = activeSweepControl.get(sampleId);
            if (_ctl) _ctl.drawFn(_ctl.lastElapsedMs);
        }).observe(container);

        const root = getComputedStyle(document.documentElement);
        const accent = (typeof THEMES !== "undefined" && THEMES[themeIndex]?.traceColor)
                       || root.getPropertyValue("--accent").trim() || "#5cc24a";
        const DIM = "#4a5260", BAD = "#e74c3c";

        // Node i sits before reaction i: the species that reaction consumes.
        // For a ring the last reaction's product is node 0 again, which is
        // exactly why no extra node is needed to close it.
        const nodes = steps.map(s => {
            const main = Object.keys(s.reactants)
                .find(id => !fo.species?.[id]?.boundary) ?? Object.keys(s.reactants)[0];
            return { id: main, name: fo.species?.[main]?.name ?? main };
        });

        // durationMs must be finite and positive: NaN or 0 makes stepMs
        // NaN, and Math.min(n - 1, NaN) is NaN rather than the clamp it
        // looks like -- so the index silently became invalid on frame one.
        const safeDuration = Number.isFinite(durationMs) && durationMs > 0
                             ? durationMs : 10000;
        const stepMs = safeDuration / steps.length;

        // ── ROUTE IDENTITY ──────────────────────────────────────────────
        // Where the routes part, and which one this walk took. Everything
        // from the fork onward is drawn in that route's colour, and it is
        // drawn from the FIRST frame -- a bifurcation should be visible
        // before you arrive at it, not only once you are standing on it.
        const ROUTE_COLS = ["#c77dff", "#21d4fd", "#ffd166", "#ff5d8f"];
        const junctionIds = new Set((fo.junctions ?? []).map(j => j.species));
        const activeIds   = new Set((fo.steps ?? []).map(s => s.id));
        const FORK = (() => {
            const at = steps.findIndex(s =>
                Object.keys(s.reactants ?? {}).some(r => junctionIds.has(r)));
            if (at === -1) return { at: -1, col: null, others: [] };
            const sp = Object.keys(steps[at].reactants).find(r => junctionIds.has(r));
            const opts = ((fo.junctions ?? []).find(x => x.species === sp)?.options) ?? [];
            const taken = opts.findIndex(o => activeIds.has(o.id));
            return {
                at,
                col: ROUTE_COLS[(taken < 0 ? 0 : taken) % ROUTE_COLS.length],
                others: opts.filter(o => !activeIds.has(o.id)),
            };
        })();


        function draw(idx, frac) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);
            const mono = s => `${s * useDPR}px "IBM Plex Mono", monospace`;
            const step = steps[idx];
            // Guard the other renderers all have and this one lacked.
            // Without it an out-of-range idx dereferences undefined and
            // the exception kills the sweep loop mid-frame -- which looked
            // like "nothing animates until I restart".
            if (!step) return;

            ctx.textAlign = "center";
            ctx.fillStyle = accent;
            ctx.font = `600 ${14 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(fo.name, W / 2, 24 * useDPR);
            ctx.fillStyle = "#78828e";
            ctx.font = mono(10);
            const V = fo.vocabulary ?? {};
            const shape = `${fo.cyclic ? (V.cycle ?? "cycle") : (V.chain ?? "chain")}`
                        + ` \u00b7 ${steps.length} ${V.edges ?? "reactions"}`;
            // Naming the route matters: without it the anaerobic walk
            // looks like the whole of glycolysis rather than one of two
            // fates for pyruvate.
            ctx.fillText(shape, W / 2, 40 * useDPR);
            if (fo.conditionSummary) {
                // Same colour as the branch it produced. The map has no
                // per-condition layout to work with, so the whole line
                // takes the route colour rather than one word of it.
                ctx.fillStyle = FORK.col ?? "#5c6470";
                ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(fo.conditionSummary, W / 2, 53 * useDPR);
            }

            const cx = W / 2, cy = H * 0.52;
            const R  = Math.min(W, H) * 0.30;

            const pos = i => {
                if (fo.cyclic) {
                    // -90deg so the first metabolite sits at the top.
                    const a = (i / steps.length) * Math.PI * 2 - Math.PI / 2;
                    return [cx + Math.cos(a) * R, cy + Math.sin(a) * R];
                }
                // A long chain runs VERTICALLY. Ten nodes across a 390px
                // phone leaves ~39px each, and the metabolite names
                // ("Phosphoglycerate") overlap into illegibility. Down the
                // screen there is room for a label beside every node.
                if (steps.length > 5) {
                    const top = H * 0.16, bot = H * 0.84;
                    // 0.52, not 0.30: the enzyme label sits to the LEFT of
                    // the column and "Phosphoglycerate mutase" needs ~140px
                    // at this size. At 0.30 it ran off the screen edge.
                    return [W * 0.52,
                            top + (i / Math.max(1, steps.length - 1)) * (bot - top)];
                }
                const span = W - 70 * useDPR;
                return [35 * useDPR + (i / Math.max(1, steps.length - 1)) * span, cy];
            };

            // ── arcs ───────────────────────────────────────────────────
            steps.forEach((s, i) => {
                const [x0, y0] = pos(i);
                const [x1, y1] = pos((i + 1) % steps.length);
                if (!fo.cyclic && i === steps.length - 1) return;

                const state = s.blocked ? "blocked" : s.fired ? "fired" : "starved";
                const active = i === idx;
                // After the fork the trunk takes the ROUTE's colour, and
                // it is drawn from the first frame -- the bifurcation
                // should be visible before you arrive at it, not only
                // once you are standing on it.
                const onRoute = FORK.at !== -1 && i >= FORK.at;
                const liveCol = onRoute ? FORK.col : accent;
                ctx.strokeStyle = state === "fired"
                    ? (i <= idx ? liveCol : (onRoute ? FORK.col + "55"
                                                     : "rgba(255,255,255,0.13)"))
                    : BAD;
                // Heavier throughout: at 1.5px the ring read as a faint
                // wireframe rather than a pathway, and the active arc
                // needs to stand out from eight neighbours, not two.
                ctx.lineWidth = (active ? 4 : 2.4) * useDPR;
                if (active) {
                    // The faint rail underneath, so the arc being
                    // crossed still shows where it is heading.
                    const ps = ctx.strokeStyle, pw = ctx.lineWidth;
                    ctx.strokeStyle = "rgba(255,255,255,0.12)";
                    ctx.lineWidth = 1.4 * useDPR;
                    ctx.beginPath();
                    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
                    ctx.stroke();
                    ctx.strokeStyle = ps; ctx.lineWidth = pw;
                }

                ctx.beginPath();
                ctx.moveTo(x0, y0);
                if (active) {
                    // The current arc GROWS toward the next node instead
                    // of switching on whole. Lighting up an edge says "we
                    // went that way"; drawing it says "we are going",
                    // which is the thing a walk is meant to show.
                    //
                    // Eased so it leaves and arrives softly rather than
                    // sliding at constant speed into a node it then sits
                    // on for the rest of the step.
                    const p = Math.min(1, Math.max(0, frac));
                    const e = p * p * (3 - 2 * p);
                    ctx.lineTo(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
                } else {
                    ctx.lineTo(x1, y1);
                }
                ctx.stroke();

                // enzyme label on the arc, only for the active reaction --
                // eight labels at once is unreadable on a phone
                if (active) {
                    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
                    ctx.font = `600 ${12 * useDPR}px "IBM Plex Mono", monospace`;
                    const tw = ctx.measureText(s.name).width;
                    const pad = 6 * useDPR;

                    // Work out WHERE THE TEXT GOES FIRST, then put the
                    // plate under it. Previously the plate was always
                    // centred on the arc midpoint while the vertical-chain
                    // text was right-aligned 26px to its left, so the
                    // shadow sat on the centre line with the label beside
                    // it.
                    const vertical = !fo.cyclic && steps.length > 5;
                    const tx = vertical ? mx - 26 * useDPR : mx;
                    const ty = vertical ? my + 3 * useDPR : my - 6 * useDPR;
                    const left = vertical ? tx - tw - pad : tx - tw / 2 - pad;

                    ctx.fillStyle = "rgba(10,12,15,0.88)";
                    ctx.fillRect(left, ty - 12 * useDPR, tw + pad * 2, 17 * useDPR);

                    ctx.fillStyle = state === "fired" ? "#e8f4f8" : BAD;
                    ctx.textAlign = vertical ? "right" : "center";
                    ctx.fillText(s.name, tx, ty);
                    ctx.textAlign = "center";
                }
            });

            // ── nodes ──────────────────────────────────────────────────
            nodes.forEach((n, i) => {
                const [x, y] = pos(i);
                const reached = i <= idx;
                // A metabolite is a THING, so it gets a solid body rather
                // than a hollow ring. Current is larger again, and gets a
                // halo so the eye finds it without reading any text.
                const r = (i === idx ? 11 : 8) * useDPR;
                if (i === idx) {
                    ctx.fillStyle = accent + "22";
                    ctx.beginPath();
                    ctx.arc(x, y, r + 7 * useDPR, 0, Math.PI * 2);
                    ctx.fill();
                }
                const nodeOnRoute = FORK.at !== -1 && i > FORK.at;
                const nodeCol = nodeOnRoute ? FORK.col : accent;
                ctx.fillStyle = reached ? nodeCol + "55" : "rgba(255,255,255,0.07)";
                ctx.strokeStyle = reached ? nodeCol : "rgba(255,255,255,0.16)";
                ctx.lineWidth = (i === idx ? 3 : 1.8) * useDPR;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();

                if (FORK.at !== -1 && i === FORK.at) {
                    ctx.strokeStyle = FORK.col;
                    ctx.lineWidth = 1.6 * useDPR;
                    ctx.beginPath();
                    ctx.arc(x, y, r + 6 * useDPR, 0, Math.PI * 2);
                    ctx.stroke();
                    // The road not taken, as a stub off the fork. Without
                    // it the alternative exists only as text at the
                    // bottom of the card, which is easy to miss entirely.
                    if (FORK.others.length) {
                        const sx = x + 16 * useDPR, sy = y - 20 * useDPR;
                        ctx.strokeStyle = "rgba(255,255,255,0.22)";
                        ctx.setLineDash([3 * useDPR, 3 * useDPR]);
                        ctx.beginPath();
                        ctx.moveTo(x, y); ctx.lineTo(sx, sy);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.beginPath();
                        ctx.arc(sx, sy, 4 * useDPR, 0, Math.PI * 2);
                        ctx.stroke();
                        ctx.fillStyle = "#6b7480";
                        ctx.font = mono(9);
                        ctx.textAlign = "left";
                        ctx.fillText(FORK.others[0].name,
                                     sx + 8 * useDPR, sy + 3 * useDPR);
                        ctx.textAlign = "center";
                    }
                }
                ctx.fillStyle = i === idx ? "#e8f4f8" : reached ? "#9aa4b0" : DIM;
                ctx.font = i === idx
                    ? `600 ${12 * useDPR}px "IBM Plex Mono", monospace`
                    : mono(10);
                // push labels outward from the ring so they clear the arcs
                if (fo.cyclic) {
                    ctx.fillText(n.name, cx + (x - cx) * 1.32,
                                 cy + (y - cy) * 1.32 + 3 * useDPR);
                } else if (steps.length > 5) {
                    ctx.textAlign = "left";               // beside the node
                    ctx.fillText(n.name, x + 14 * useDPR, y + 3 * useDPR);
                    ctx.textAlign = "center";
                } else {
                    ctx.fillText(n.name, x, y + 23 * useDPR);
                }
            });

            // ── readout ────────────────────────────────────────────────
            ctx.fillStyle = step.blocked ? BAD : step.fired ? "#9aa4b0" : BAD;
            ctx.font = mono(10);
            ctx.fillText(step.tech ?? "", W / 2, H - 42 * useDPR);

            // A feeder supplies the ring from outside it -- carbamoyl-P
            // synthetase for the urea cycle. Saying so stops the first
            // metabolite looking as though it appeared from nowhere.
            if (fo.feeders && fo.feeders.length) {
                ctx.fillStyle = "#5c6470";
                ctx.font = mono(9);
                ctx.fillText(`fed by ${fo.feeders.map(f => f.name).join(", ")}`,
                             W / 2, H - 56 * useDPR);
            }

            const bal = fo.balance;
            if (bal) {
                ctx.font = mono(9);
                if (!bal.allBalanced) {
                    ctx.fillStyle = BAD;
                    ctx.fillText(`UNBALANCED: ${bal.unbalanced[0]}`, W / 2, H - 24 * useDPR);
                } else if (bal.checked === 0) {
                    // "all balanced" with nothing checked is a green tick
                    // that means nothing -- every species here is
                    // cofactor-bound and carries no formula.
                    ctx.fillStyle = "#4a5260";
                    ctx.fillText(`no reaction here is atom-checkable`, W / 2, H - 24 * useDPR);
                } else {
                    ctx.fillStyle = "#4a5260";
                    ctx.fillText(`atoms balance in ${bal.checked}/${bal.total} checkable reactions`,
                                 W / 2, H - 24 * useDPR);
                }
            }
            ctx.fillStyle = DIM;
            ctx.font = mono(9);
            ctx.fillText(`${idx + 1} / ${steps.length}`, W / 2, H - 8 * useDPR);
        }

        draw(0, 0);
        startSweepLoop(sampleId, safeDuration, e => {
            const raw = Math.floor((Number.isFinite(e) ? e : 0) / stepMs);
            const idx = Math.max(0, Math.min(steps.length - 1,
                                             Number.isFinite(raw) ? raw : 0));
            draw(idx, (e % stepMs) / stepMs || 0);
        });
    },
});

})();
