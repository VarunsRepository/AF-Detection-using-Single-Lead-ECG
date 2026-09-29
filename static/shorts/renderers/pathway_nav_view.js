// ---------------------------------------------------------------------------
// renderers/pathway_nav_view.js
//
// Navigation rather than diagram: five slots, the current reaction always
// in the middle, the pathway scrolling past it.
//
//   pos 0,1   where we have just been   (faded)
//   pos 2     current                   (lit, centred)
//   pos 3,4   what is coming            (faded)
//
// WHY THE WINDOW NEEDS A HUD
//   A ring's defining property is that it RETURNS, and five nodes in a
//   row cannot show closure -- the same five slots look identical
//   whether this is step 8 of a cycle that just wrapped or step 2 of a
//   line that keeps going. The window has genuinely lost the shape, so
//   the HUD carries it: the whole pathway in miniature with a marker,
//   not a progress bar. A bar would repeat the window's mistake, saying
//   "3 of 8" while hiding that 8 wraps to 1.
//
// BRANCHES ARE A CALL STACK
//   The tape emits push when the walk defers an arm and pop when it
//   returns. On a push the trunk slides to the top-right and dims, and
//   the spur runs in the centre; on a pop the trunk comes back. Nesting
//   needs no extra concept -- a fork inside a fork is a deeper stack.
//
// Needs finalOutput.tape (move/push/pop), which pathway_filter emits
// alongside its step list.
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("pathway_nav_view", {

    // What this VIEW can vary, named from the model's own vocabulary.
    // The DSPE declares choices about the data; this declares choices
    // about the display, and the two are different questions.
    //
    // Reading the vocabulary matters: a hardcoded "substrate / enzyme /
    // cofactor" button would read as nonsense on a compiler pipeline,
    // which is the same failure as a Route button on a pathway with no
    // routes, arriving from the other direction.
    choices(envelope) {
        const V = envelope?.meta?.pathway?.vocabulary ?? {};
        const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
        return [{
            key: "emphasis",
            label: "Show",
            values: ["enzyme", "substrate", "cofactor"],
            display: {
                enzyme:    cap(V.edge ?? "reaction"),
                substrate: cap(V.node ?? "metabolite"),
                cofactor:  cap(V.side ?? "cofactor"),
            },
        }];
    },

    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }
        const fo = dspOutput.finalOutput ?? {};
        const tape = fo.tape ?? [];
        const moves = tape.filter(t => t.type === "move");
        if (!moves.length) {
            container.innerHTML = `<p style="color:#ff4d4d;padding:20px;">No navigation tape.</p>`;
            return;
        }

        // Reaction id -> display name, and the species names.
        const byId = {};
        (fo.steps ?? []).forEach(s => { byId[s.id] = s; });
        const spName = id => fo.species?.[id]?.name ?? id ?? "";

        // Depth at each move, so the renderer knows when it is on a spur.
        let depth = 0;
        const frames = [];
        for (const ev of tape) {
            if (ev.type === "push") depth++;
            else if (ev.type === "pop") depth = Math.max(0, depth - 1);
            else frames.push({ ...ev, depth, step: byId[ev.reaction] });
        }

        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);
        const iw = container.offsetWidth || 390, ih = container.offsetHeight || 440;
        canvas.width = Math.round(iw * useDPR); canvas.height = Math.round(ih * useDPR);
        canvas.style.width = iw + "px"; canvas.style.height = ih + "px";
        new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width = Math.round(width * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px"; canvas.style.height = height + "px";
            const _ctl = activeSweepControl.get(sampleId);
            if (_ctl) _ctl.drawFn(_ctl.lastElapsedMs);
        }).observe(container);

        const root = getComputedStyle(document.documentElement);
        const accent = (typeof THEMES !== "undefined" && THEMES[themeIndex]?.traceColor)
                       || root.getPropertyValue("--accent").trim() || "#5cc24a";
        const SPUR = "#eb7b2b", BAD = "#e74c3c";
        // Distinct from SPUR: a spur is a detour that rejoins, a fork is
        // a choice where one road was NOT taken. Different things.
        // One colour per route, applied from the fork ONWARD -- so the
        // branch you are on is identifiable at every later step, not just
        // at the moment of divergence.
        const ROUTE_COLS = ["#c77dff", "#21d4fd", "#ffd166", "#ff5d8f"];
        const junctionIds = new Set((fo.junctions ?? []).map(j => j.species));
        const activeIds   = new Set((fo.steps ?? []).map(s => s.id));
        const forkFrame = frames.findIndex(f => junctionIds.has(f.from));
        const takenIdx = (() => {
            if (forkFrame === -1) return 0;
            const j = (fo.junctions ?? []).find(x => x.species === frames[forkFrame].from);
            const i = (j?.options ?? []).findIndex(o => activeIds.has(o.id));
            return i < 0 ? 0 : i;
        })();
        const FORK = ROUTE_COLS[takenIdx % ROUTE_COLS.length];
        const stepMs = Math.max(1, durationMs) / frames.length;

        // On a CYCLE the window never has blank ends -- position 0 is the
        // last reaction of the ring, because there is always a "before".
        // On a chain the ends really are empty, and that difference is
        // itself a signal about which you are looking at.
        const at = i => {
            if (fo.cyclic) return frames[((i % frames.length) + frames.length) % frames.length];
            return (i < 0 || i >= frames.length) ? null : frames[i];
        };

        function drawHud(ctx, W, H, idx) {
            // The whole pathway in miniature: the shape the window cannot
            // show. Ring for a cycle, line for a chain.
            const r = 26 * useDPR;
            const cx = W - r - 22 * useDPR, cy = r + 26 * useDPR;
            const trunk = frames.filter(f => f.depth === 0);
            const cur = frames[idx];
            // On a spur the current frame is NOT on the trunk, so
            // indexOf returns -1 and the marker vanished entirely --
            // exactly when the viewer most needs to know where they left
            // from. Fall back to the last trunk frame before here: the
            // junction they departed at.
            let pos = trunk.indexOf(cur);
            if (pos === -1) {
                for (let k = idx; k >= 0; k--) {
                    const p = trunk.indexOf(frames[k]);
                    if (p !== -1) { pos = p; break; }
                }
            }
            // Where the ROUTES part company -- a different kind of fork
            // from a spur: one road was taken and another was not.
            const isJunction = f => junctionIds.has(f.from);

            ctx.strokeStyle = "rgba(255,255,255,0.16)";
            ctx.lineWidth = 1.4 * useDPR;
            if (fo.cyclic) {
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
                trunk.forEach((f, i) => {
                    const a = (i / trunk.length) * Math.PI * 2 - Math.PI / 2;
                    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
                    ctx.beginPath();
                    ctx.arc(px, py, (i === pos ? 4 : 2) * useDPR, 0, Math.PI * 2);
                    ctx.fillStyle = i === pos ? accent : "rgba(255,255,255,0.28)";
                    ctx.fill();
                    if (isJunction(f)) {
                        ctx.strokeStyle = SPUR;
                        ctx.lineWidth = 1.4 * useDPR;
                        ctx.beginPath();
                        ctx.arc(px, py, 6 * useDPR, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                });
            } else {
                const x0 = cx - r, x1 = cx + r;
                ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
                trunk.forEach((f, i) => {
                    const x = x0 + (i / Math.max(1, trunk.length - 1)) * (x1 - x0);
                    ctx.beginPath();
                    ctx.arc(x, cy, (i === pos ? 4 : 2) * useDPR, 0, Math.PI * 2);
                    ctx.fillStyle = i === pos ? accent : "rgba(255,255,255,0.28)";
                    ctx.fill();
                    if (isJunction(f)) {
                        ctx.strokeStyle = SPUR;
                        ctx.lineWidth = 1.4 * useDPR;
                        ctx.beginPath();
                        ctx.arc(x, cy, 6 * useDPR, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                });
            }
            // Off the trunk entirely -- say so, or the marker looks stuck.
            ctx.fillStyle = "#5c6470";
            ctx.font = `${8 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "center";
            ctx.fillText(cur.depth > 0 ? "on a branch" : (fo.cyclic ? "cycle" : "chain"),
                         cx, cy + r + 13 * useDPR);
        }

        function draw(idx, frac = 0) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);
            const mono = s => `${s * useDPR}px "IBM Plex Mono", monospace`;
            const cur = frames[idx];
            if (!cur) return;

            ctx.textAlign = "left";
            ctx.fillStyle = accent;
            ctx.font = `600 ${13 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(fo.name, 20 * useDPR, 28 * useDPR);
            if (fo.conditionSummary) {
                ctx.fillStyle = "#78828e";
                ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(fo.conditionSummary, 20 * useDPR, 44 * useDPR);
            }

            drawHud(ctx, W, H, idx);

            // Five slots down the middle. The current one is bigger and
            // fully opaque; distance from centre fades the rest, so the
            // eye lands on the middle without being told.
            const cy = H * 0.54;
            const gap = Math.min(H * 0.135, 62 * useDPR);
            const onSpur = cur.depth > 0;

            // drawHud leaves textAlign as "center"; without resetting it
            // every slot label is centred on its x and spills off the
            // left edge of the card.
            ctx.textAlign = "left";
            // HOLD, THEN GLIDE. A constant crawl never lets a reaction
            // sit still long enough to read; jumping loses the sense of
            // travelling along a chain. So 62% of each step is held in
            // place and the remainder glides to the next, smoothstepped
            // so it starts and stops softly.
            const raw = Math.max(0, (frac - 0.62) / 0.38);
            const slide = raw * raw * (3 - 2 * raw);

            // -3..3 rather than -2..2: the incoming and outgoing slots
            // must exist before and after they are visible, or they pop
            // into being at the edge of the card.
            for (let k = -3; k <= 3; k++) {
                const f = at(idx + k);
                if (!f) continue;
                const off = k - slide;
                const y = cy + off * gap;
                const dist = Math.abs(off);
                if (dist > 2.6) continue;
                const isCur = dist < 0.5;
                // PAST vs FUTURE, not just near vs far. Opacity alone
                // made the two sides of the window symmetrical, so there
                // was no way to tell what had already happened from what
                // was coming -- which is most of what a navigator is for.
                const past = off < -0.5;
                // A JUNCTION is where the conditions decided the route.
                // The divergence was invisible: swapping oxygen changed
                // the last reaction and nothing announced that a choice
                // had been made at all.
                const atFork = junctionIds.has(f.from);
                // Everything at or after the fork wears the route colour.
                const onRoute = forkFrame !== -1 && (idx + k) >= forkFrame;
                // Continuous fade, so a slot dims as it travels rather
                // than switching brightness at a boundary.
                const alpha = Math.max(0, Math.min(1, 1 - dist * 0.42));
                const PAST_COL = "#2f6b3f";     // travelled: muted, still green
                const NEXT_COL = "#6b7480";     // upcoming: neutral grey
                const col = f.depth > 0 ? SPUR
                          : onRoute     ? FORK
                          : isCur       ? accent
                          : past        ? PAST_COL
                                        : NEXT_COL;

                ctx.globalAlpha = alpha;

                // A spur sits indented, so the trunk stays readable as the
                // thing being departed from and returned to.
                const x = 26 * useDPR + (f.depth > 0 ? 22 * useDPR : 0);

                ctx.strokeStyle = col;
                ctx.lineWidth = (isCur ? 2.4 : 1.2) * useDPR;
                ctx.beginPath();
                ctx.arc(x, y, (isCur ? 7 : 4) * useDPR, 0, Math.PI * 2);
                ctx.stroke();
                if (isCur) { ctx.fillStyle = col + "44"; ctx.fill(); }

                if (atFork) {
                    ctx.strokeStyle = FORK;
                    ctx.lineWidth = 1.4 * useDPR;
                    ctx.beginPath();
                    ctx.arc(x, y, (isCur ? 12 : 8) * useDPR, 0, Math.PI * 2);
                    ctx.stroke();
                    if (isCur) {
                        ctx.fillStyle = FORK;
                        ctx.font = `600 ${9 * useDPR}px "IBM Plex Mono", monospace`;
                        ctx.fillText("the routes part here",
                                     x + 20 * useDPR, y - 14 * useDPR);
                    }
                }

                // connector to the next slot
                if (k < 3 && at(idx + k + 1)) {
                    ctx.beginPath();
                    ctx.moveTo(x, y + 9 * useDPR);
                    ctx.lineTo(x, y + gap - 9 * useDPR);
                    ctx.stroke();
                }

                // EMPHASIS: which of the three facts about a step gets
                // the big line. The enzyme is the default because it
                // names the step, but someone following the carbon wants
                // the substrates, and someone counting ATP wants the
                // cofactors. Same data, reordered -- not a different view.
                const V = fo.vocabulary ?? {};
                const endsAtFor = st => {
                    if (!st) return "";
                    const prods = Object.keys(st.products ?? {})
                        .filter(p => !fo.species?.[p]?.boundary);
                    return (prods.length ? prods : Object.keys(st.products ?? {}))
                        .map(spName).join(" + ");
                };
                const facts = {
                    edge: f.step?.name ?? f.reaction,
                    node: `${spName(f.from)}  \u2192  ${f.to ? spName(f.to)
                                                              : endsAtFor(f.step)}`,
                    side: [
                        ...(f.step?.cofactorsIn  ?? []).map(cc => `-${cc.name}`),
                        ...(f.step?.cofactorsOut ?? []).map(cc => `+${cc.name}`),
                    ].join("  ") || "\u2014",
                };
                const order = ({
                    enzyme:    ["edge", "node", "side"],
                    substrate: ["node", "edge", "side"],
                    cofactor:  ["side", "edge", "node"],
                })[config.emphasis ?? "enzyme"] ?? ["edge", "node", "side"];

                ctx.fillStyle = isCur ? "#e8f4f8" : "#8b939f";
                ctx.font = `${isCur ? 600 : 400} ${(isCur ? 15 : 12) * useDPR}px `
                         + `"IBM Plex Mono", monospace`;
                ctx.fillText(facts[order[0]], x + 20 * useDPR,
                             y + (isCur ? 5 : 4) * useDPR);

                if (isCur) {
                    ctx.fillStyle = "#78828e";
                    ctx.font = mono(10);
                    ctx.fillText(facts[order[1]], x + 20 * useDPR, y + 22 * useDPR);

                    // What this reaction SPENDS and MAKES. ATP and NADH
                    // are boundary species so the walk skips them --
                    // correct for pathfinding, but it meant the
                    // accounting that IS the lesson never appeared.
                    const spent = (f.step?.cofactorsIn ?? [])
                        .map(c => `-${c.q > 1 ? c.q + " " : ""}${c.name}`);
                    const made  = (f.step?.cofactorsOut ?? [])
                        .map(c => `+${c.q > 1 ? c.q + " " : ""}${c.name}`);
                    // REGULATION. Drawn, not simulated: nothing here
                    // computes whether ATP is currently high, so the
                    // symbols say "this step is controlled by these"
                    // rather than claiming a state. Honest, and it makes
                    // the single most important fact about
                    // phosphofructokinase visible at all -- that it is
                    // the regulated step, which the reaction arrows alone
                    // can never show.
                    //
                    //   ⊣  inhibitor, the standard bar-ended notation
                    //   ⊢  activator
                    const mods = f.step?.modifiers ?? [];
                    if (mods.length) {
                        ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                        let mx = x + 20 * useDPR;
                        for (const m of mods) {
                            const inhib = m.role === "inhibitor";
                            const name = fo.species?.[m.species]?.name ?? m.species;
                            const txt = `${inhib ? "\u22a3" : "\u22a2"} ${name}`;
                            ctx.fillStyle = inhib ? "#e0654a" : "#5cc24a";
                            ctx.fillText(txt, mx, y + 52 * useDPR);
                            mx += ctx.measureText(txt).width + 12 * useDPR;
                        }
                        ctx.fillStyle = "#5c6470";
                        ctx.fillText("regulated", mx + 2 * useDPR, y + 52 * useDPR);
                    }

                    // Skip the detail line when the emphasis has already
                    // promoted cofactors to one of the top two slots --
                    // otherwise they print twice on the same step.
                    const sideShown = order[0] === "side" || order[1] === "side";
                    if (!sideShown && (spent.length || made.length)) {
                        const n = f.step?.runs ?? 1;
                        ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                        ctx.fillStyle = "#e0654a";
                        ctx.fillText(spent.join("  "), x + 20 * useDPR, y + 37 * useDPR);
                        const w = ctx.measureText(spent.join("  ")).width;
                        ctx.fillStyle = "#5cc24a";
                        ctx.fillText(made.join("  "),
                                     x + 28 * useDPR + w, y + 37 * useDPR);
                        if (n > 1) {
                            ctx.fillStyle = "#5c6470";
                            ctx.fillText(`  \u00d7${n}`,
                                x + 34 * useDPR + w
                                  + ctx.measureText(made.join("  ")).width,
                                y + 37 * useDPR);
                        }
                    }
                }
                ctx.globalAlpha = 1;
            }

            const j = (fo.junctions ?? []).find(x => x.species === cur.from);
            if (j) {
                // Name the roads NOT taken, with the condition that
                // would have taken them -- "oxygen == 0 -> Lactate
                // dehydrogenase" says why, not just what.
                const active = new Set((fo.steps ?? []).map(s => s.id));
                const other = (j.options ?? [])
                    .filter(o => !active.has(o.id))
                    .map(o => `${o.when} \u2192 ${o.name}`);
                // One per line, and at most two. Joining them ran off the
                // card as soon as a junction had more than one
                // alternative -- glycolysis has two, so it overflowed
                // immediately.
                ctx.fillStyle = SPUR;
                ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.textAlign = "left";
                // Truncate to the space LEFT of the ledger, which now
                // occupies the bottom-right. Without this the condition
                // text runs straight through the ATP figures.
                const room = W * 0.62;
                other.slice(0, 2).forEach((line, i) => {
                    let s = `\u2942 ${line}`;
                    if (ctx.measureText(s).width > room) {
                        while (s.length > 6 && ctx.measureText(s + "\u2026").width > room) {
                            s = s.slice(0, -1);
                        }
                        s += "\u2026";
                    }
                    ctx.fillText(s, 20 * useDPR, H - (54 - i * 12) * useDPR);
                });
                if (other.length > 2) {
                    ctx.fillText(`\u2942 +${other.length - 2} more`,
                                 20 * useDPR, H - 30 * useDPR);
                }
            }

            if (onSpur) {
                ctx.fillStyle = SPUR;
                ctx.font = `600 ${10 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.textAlign = "left";
                ctx.fillText("\u21b3 side branch \u2014 rejoins the main path",
                             20 * useDPR, H - 26 * useDPR);
            }

            // The ledger for the WHOLE walk. "+/-" marks a cofactor that
            // is spent and remade in equal measure -- net zero, which in
            // fermentation is not nothing happening but the entire reason
            // the step exists.
            const led = (fo.cofactors ?? []).slice(0, 4);
            if (led.length) {
                ctx.textAlign = "right";
                ctx.font = mono(9);
                let ly = H - 58 * useDPR;
                ctx.fillStyle = "#5c6470";
                ctx.fillText(`${fo.vocabulary?.per ?? "per"} `
                             + (fo.start ? spName(fo.start) : "turn"),
                             W - 18 * useDPR, ly);
                for (const cf of led) {
                    ly += 12 * useDPR;
                    ctx.fillStyle = cf.balanced ? "#5c6470"
                                  : cf.net > 0 ? "#5cc24a" : "#e0654a";
                    const val = cf.balanced ? `\u00b1${cf.moved / 2}`
                              : `${cf.net > 0 ? "+" : ""}${cf.net}`;
                    ctx.fillText(`${cf.name} ${val}`, W - 18 * useDPR, ly);
                }
            }

            ctx.textAlign = "center";
            ctx.fillStyle = "#4a5260";
            ctx.font = mono(9);
            ctx.fillText(`${idx + 1} / ${frames.length}`, W / 2, H - 10 * useDPR);
        }

        draw(0, 0);
        startSweepLoop(sampleId, durationMs, e => {
            const t = (Number.isFinite(e) ? e : 0) / stepMs;
            const idx = Math.max(0, Math.min(frames.length - 1, Math.floor(t)));
            draw(idx, t - Math.floor(t));
        });
    },
});

})();
