// ---------------------------------------------------------------------------
// renderers/pathway_view.js
// Weyland-Yutani Corp // Renaissance Station Avionics HUD (Alien: Romulus)
// ---------------------------------------------------------------------------

(function () {
"use strict";

function ROMULUS_BG() {
    const t = (typeof THEMES !== "undefined" && THEMES[themeIndex]) || {};
    return t.label === "Romulus" ? "#020503" : (t.bg || "#000000");
}

// Remembers which route each card was showing, so a condition change can
// be ANIMATED rather than appearing as new text in the same boxes. The
// renderer is rebuilt from scratch on every change, so without this it
// has no idea anything swapped.
const _lastRoute = new Map();
const _swapAt    = new Map();

registerRenderingAlgorithm("pathway_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";
        container.style.backgroundColor = ROMULUS_BG();

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff3333;font-family:'Courier New',monospace;padding:20px;letter-spacing:1px;">`
                + `[CRITICAL_SYS_ERROR]: ${dspOutput.error.toUpperCase()}</p>`;
            return;
        }
        const fo = dspOutput.finalOutput ?? {};
        const steps = fo.steps ?? [];
        if (!steps.length) {
            container.innerHTML = `<p style="color:#ff8b1f;font-family:'Courier New',monospace;padding:20px;">[SYS_IDLE]: NO_TRAJECTORY_DATA</p>`;
            return;
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

        const _theme   = (typeof THEMES !== "undefined" && THEMES[themeIndex]) || {};
        const ROMULUS  = _theme.label === "Romulus";
        const _accent  = _theme.traceColor || "#5cc24a";
        const FONT     = ROMULUS ? '"Courier New", monospace'
                                 : '"IBM Plex Mono", monospace';

        const CRT_AMBER    = ROMULUS ? "#ff9900" : _accent;
        const CRT_GREEN    = ROMULUS ? "#57e389" : "#9aa4b0";
        const CRT_CYAN     = ROMULUS ? "#2de2e6" : "#3b82f6";
        const CRT_WARN     = ROMULUS ? "#ff3b30" : "#e74c3c";
        const CRT_MUTED    = ROMULUS ? "#3d4b3d" : "#4a5260";
        const CRT_GRID     = "rgba(87, 227, 137, 0.05)";

        const ROUTE_COLS   = ["#ff9900", "#2de2e6", "#e0e722", "#ff5376"];
        const junctionIds  = new Set((fo.junctions ?? []).map(j => j.species));
        const activeIds    = new Set((fo.steps ?? []).map(s => s.id));
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

        const nodes = steps.map(s => {
            const main = Object.keys(s.reactants)
                .find(id => !fo.species?.[id]?.boundary) ?? Object.keys(s.reactants)[0];
            return { id: main, name: (fo.species?.[main]?.name ?? main).toUpperCase() };
        });

        // ── ROUTE SWAP ──────────────────────────────────────────────────
        // Identify the route by the reactions AFTER the fork. If that set
        // changed since the last render of this card, a condition was
        // flipped, and the next ~550ms crossfades: the outgoing branch
        // fades along what is now its ghost arm, the incoming one draws
        // in from the fork. Switching the labels in place reads as a
        // relabelling; this reads as taking a different road.
        const routeKey = FORK.at === -1 ? "none"
                       : steps.slice(FORK.at).map(s => s.id).join(">");
        const prevKey = _lastRoute.get(sampleId);
        if (prevKey !== routeKey) {
            if (prevKey !== undefined) _swapAt.set(sampleId, performance.now());
            _lastRoute.set(sampleId, routeKey);
        }
        // The ids the trunk used to hold. The outgoing branch is the ghost
        // that contains them -- knowing which one lets it be animated OUT
        // from the trunk's own positions rather than simply appearing in
        // its ghost slot.
        const prevIds = new Set((prevKey ?? "").split(">").filter(Boolean));
        const SWAP_MS = 550;
        const swapPhase = () => {
            const t0 = _swapAt.get(sampleId);
            if (!t0) return 1;
            const p = (performance.now() - t0) / SWAP_MS;
            return p >= 1 ? 1 : p;
        };

        const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10000;
        const stepMs = safeDuration / steps.length;

        function drawCRTOverlays(ctx, W, H) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
            for (let y = 0; y < H; y += 3 * useDPR) {
                ctx.fillRect(0, y, W, 1.2 * useDPR);
            }

            const pad = 12 * useDPR;
            const arm = 14 * useDPR;
            ctx.strokeStyle = "rgba(87, 227, 137, 0.35)";
            ctx.lineWidth = 1.2 * useDPR;

            [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]]
                .forEach(([x, y, dx, dy]) => {
                    ctx.beginPath();
                    ctx.moveTo(x, y + dy * arm);
                    ctx.lineTo(x, y);
                    ctx.lineTo(x + dx * arm, y);
                    ctx.stroke();
                });

            const vig = ctx.createRadialGradient(W / 2, H / 2, W * 0.35, W / 2, H / 2, W * 0.7);
            vig.addColorStop(0, "rgba(0,0,0,0)");
            vig.addColorStop(1, "rgba(0,10,2,0.65)");
            ctx.fillStyle = vig;
            ctx.fillRect(0, 0, W, H);
        }

        // Rotate-and-recede about the fork. The outgoing branch swings
        // back and shrinks away; the incoming swings forward from behind
        // it. Anchoring the transform at the FORK NODE is what makes it
        // read as one road giving way to another rather than the whole
        // diagram sliding -- everything before the fork is untouched.
        function withPivot(ctx, px, py, angle, scale, alpha, fn) {
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.translate(px, py);
            ctx.rotate(angle);
            ctx.scale(scale, scale);
            ctx.translate(-px, -py);
            fn();
            ctx.restore();
        }

        function draw(idx, frac) {
            const swap = swapPhase();
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);

            ctx.strokeStyle = CRT_GRID;
            ctx.lineWidth = 1 * useDPR;
            const gridSize = 24 * useDPR;
            for (let x = 0; x < W; x += gridSize) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            }
            for (let y = 0; y < H; y += gridSize) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            }

            const step = steps[idx];
            if (!step) return;

            const mono = (s, w = 400) => `${w} ${s * useDPR}px ${FONT}`;

            // Telemetry Header
            ctx.textAlign = "left";
            ctx.fillStyle = CRT_GREEN;
            ctx.font = mono(11, 700);
            ctx.fillText(`SYS.W-Y // RECON.NAV`, 18 * useDPR, 22 * useDPR);

            ctx.textAlign = "right";
            ctx.fillStyle = "rgba(87, 227, 137, 0.6)";
            ctx.font = mono(9);
            ctx.fillText(`SEQ_CYC: ${(frac * 100).toFixed(0).padStart(3, '0')}%`, W - 18 * useDPR, 22 * useDPR);

            ctx.textAlign = "center";
            ctx.fillStyle = CRT_AMBER;
            ctx.font = mono(14, 700);
            ctx.fillText((fo.name ?? "TRAJECTORY").toUpperCase(), W / 2, 38 * useDPR);

            ctx.fillStyle = "#788f78";
            ctx.font = mono(9);
            const V = fo.vocabulary ?? {};
            const shape = `[${fo.cyclic ? (V.cycle ?? "LOOP") : (V.chain ?? "LINEAR")}] \u00b7 STEP_${idx + 1}/${steps.length}`;
            ctx.fillText(shape.toUpperCase(), W / 2, 52 * useDPR);

            if (fo.conditionSummary) {
                ctx.fillStyle = FORK.col ?? CRT_AMBER;
                ctx.font = mono(9, 700);
                ctx.fillText(`VEC: ${fo.conditionSummary.toUpperCase()}`, W / 2, 65 * useDPR);
            }

            // ── POSITION CALCULATION (Shifted lower to prevent header collision) ──
            const cx = W / 2, cy = H * 0.55;
            const R  = Math.min(W, H) * 0.26;

            const pos = i => {
                if (fo.cyclic) {
                    const a = (i / steps.length) * Math.PI * 2 - Math.PI / 2;
                    return [cx + Math.cos(a) * R, cy + Math.sin(a) * R];
                }
                // Vertical layout shifted down (starts at 24% height rather than 18%)
                if (steps.length > 5) {
                    const top = H * 0.24, bot = H * 0.86;
                    return [W * 0.52, top + (i / Math.max(1, steps.length - 1)) * (bot - top)];
                }
                // Horizontal layout shifted down
                const span = W - 80 * useDPR;
                const cyHorizontal = H * 0.58;
                return [40 * useDPR + (i / Math.max(1, steps.length - 1)) * span, cyHorizontal];
            };

// ARCS
            // Geometry of the pivot, shared by the arcs and the nodes so
            // they move as one piece.
            const ease = swap * swap * (3 - 2 * swap);
            // One definition of where a side-branch sits, used by BOTH
            // halves of the swap: the incoming branch travels from here
            // to the trunk, the outgoing one travels from the trunk to
            // here. Two separate formulas would have them pass through
            // each other rather than trade places.
            const fanPos = (si, dir) => {
                const vert = !fo.cyclic && steps.length > 5;
                const side = vert ? -1 : 1;
                const [bx, by] = FORK.at === -1 ? [0, 0] : pos(FORK.at);
                return [bx + side * 34 * useDPR * (si + 1),
                        by + dir * (26 + 14 * si) * useDPR];
            };
            const [fx, fy] = FORK.at === -1 ? [0, 0] : pos(FORK.at);
            const inAngle = (1 - ease) * -0.42;      // swings forward from behind
            const inScale = 0.72 + 0.28 * ease;
            const inAlpha = 0.15 + 0.85 * ease;

            steps.forEach((s, i) => {
                const [x0, y0] = pos(i);
                const [x1, y1] = pos((i + 1) % steps.length);
                if (!fo.cyclic && i === steps.length - 1) return;
                const swinging = swap < 1 && FORK.at !== -1 && i >= FORK.at;
                if (swinging) {
                    ctx.save();
                    ctx.globalAlpha = inAlpha;
                    ctx.translate(fx, fy); ctx.rotate(inAngle);
                    ctx.scale(inScale, inScale); ctx.translate(-fx, -fy);
                }

                const state = s.blocked ? "blocked" : s.fired ? "fired" : "starved";
                const active = i === idx;
                const past = i < idx;
                const onRoute = FORK.at !== -1 && i >= FORK.at;
                const liveCol = onRoute ? FORK.col : CRT_AMBER;

                // 1. BASE TRACK / TRAVERSED PATH
                if (state !== "fired") {
                    // Starved or blocked interlock
                    ctx.strokeStyle = CRT_WARN;
                    ctx.lineWidth = 1.8 * useDPR;
                    ctx.setLineDash([4 * useDPR, 2 * useDPR]);
                } else if (past) {
                    // TRAVERSED: Solid, fully powered trace (illuminated)
                    ctx.strokeStyle = onRoute ? FORK.col : (ROMULUS ? CRT_GREEN : _accent);
                    ctx.lineWidth = 2.2 * useDPR;
                    ctx.setLineDash([]); // No dashes: stays solidly locked in
                } else {
                    // UPCOMING: Faint dashed inactive rail
                    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
                    ctx.lineWidth = 1.6 * useDPR;
                    ctx.setLineDash([4 * useDPR, 2 * useDPR]);
                }

                ctx.beginPath();
                ctx.moveTo(x0, y0);
                if (onRoute && swap < 1) {
                    // The new branch extends from the fork rather than
                    // being there already.
                    const e = swap * swap * (3 - 2 * swap);
                    ctx.lineTo(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
                } else {
                    ctx.lineTo(x1, y1);
                }
                ctx.stroke();
                ctx.setLineDash([]); // Reset dash state

                // 2. ACTIVE PROGRESSIVE BEAM (Bright leading current)
                if (active) {
                    const p = Math.min(1, Math.max(0, frac));
                    const e = p * p * (3 - 2 * p);
                    const xt = x0 + (x1 - x0) * e;
                    const yt = y0 + (y1 - y0) * e;

                    ctx.strokeStyle = liveCol;
                    ctx.lineWidth = 3.8 * useDPR;
                    ctx.shadowColor = liveCol;
                    ctx.shadowBlur = 9 * useDPR;
                    ctx.beginPath();
                    ctx.moveTo(x0, y0); ctx.lineTo(xt, yt);
                    ctx.stroke();
                    ctx.shadowBlur = 0;

                    // Leading beam particle
                    ctx.fillStyle = "#ffffff";
                    ctx.beginPath();
                    ctx.arc(xt, yt, 3.2 * useDPR, 0, Math.PI * 2);
                    ctx.fill();

                    // Active Reaction Badge
                    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
                    ctx.font = mono(10, 700);
                    const tw = ctx.measureText(s.name.toUpperCase()).width;
                    const pad = 6 * useDPR;
                    const vertical = !fo.cyclic && steps.length > 5;
                    const tx = vertical ? mx - 28 * useDPR : mx;
                    const ty = vertical ? my + 3 * useDPR : my - 8 * useDPR;
                    const left = vertical ? tx - tw - pad : tx - tw / 2 - pad;

                    ctx.fillStyle = "rgba(4, 12, 6, 0.95)";
                    ctx.strokeStyle = liveCol;
                    ctx.lineWidth = 1 * useDPR;
                    ctx.fillRect(left, ty - 12 * useDPR, tw + pad * 2, 16 * useDPR);
                    ctx.strokeRect(left, ty - 12 * useDPR, tw + pad * 2, 16 * useDPR);

                    ctx.fillStyle = liveCol;
                    ctx.textAlign = vertical ? "right" : "center";
                    ctx.fillText(s.name.toUpperCase(), tx, ty);
                    ctx.textAlign = "center";
                }
                if (swinging) ctx.restore();
            });

            // NODES
            nodes.forEach((n, i) => {
                // The incoming branch's nodes travel in from the fan slot
                // they occupied as a ghost, so the node you are about to
                // follow is visibly the one that was offered a moment ago.
                let [x, y] = [0, 0];
                const swingNode = swap < 1 && FORK.at !== -1 && i > FORK.at;
                if (swingNode) {
                    ctx.save();
                    ctx.globalAlpha = inAlpha;
                    ctx.translate(fx, fy); ctx.rotate(inAngle * 0.5);
                    ctx.scale(inScale, inScale); ctx.translate(-fx, -fy);
                }
                {
                    const [tx, ty] = pos(i);
                    if (swap < 1 && FORK.at !== -1 && i > FORK.at) {
                        const [gxp, gyp] = fanPos(i - FORK.at - 1, -1);
                        x = gxp + (tx - gxp) * ease;
                        y = gyp + (ty - gyp) * ease;
                    } else { x = tx; y = ty; }
                }
                const reached = i <= idx;
                const isCur = i === idx;
                const r = (isCur ? 9 : 6) * useDPR;

                ctx.strokeStyle = reached ? CRT_GREEN : CRT_MUTED;
                ctx.lineWidth = 1.4 * useDPR;

                if (isCur) {
                    ctx.strokeStyle = CRT_AMBER;
                    ctx.strokeRect(x - r - 4 * useDPR, y - r - 4 * useDPR, (r + 4 * useDPR) * 2, (r + 4 * useDPR) * 2);
                    ctx.fillStyle = "rgba(255, 153, 0, 0.15)";
                    ctx.fillRect(x - r - 4 * useDPR, y - r - 4 * useDPR, (r + 4 * useDPR) * 2, (r + 4 * useDPR) * 2);
                }

                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = reached ? (isCur ? CRT_AMBER : CRT_GREEN) : "#0a130c";
                ctx.fill();
                ctx.stroke();

                // ── GHOST ARMS ────────────────────────────────────────
                // The roads not taken, drawn in full rather than as a
                // stub. A stub says an alternative exists; this says
                // whether it is one step or three, and where it ends --
                // which is the thing the viewer actually wants to know
                // when they are about to flip a condition.
                //
                // Fanned above the fork so they never cross the trunk,
                // and dimmed so they read as context rather than as a
                // second pathway competing for attention.
                if (FORK.at !== -1 && i === FORK.at && (fo.ghostPaths ?? []).length) {
                    // Each alternative wears ITS OWN route colour, matched
                    // to the position it occupies in the junction's option
                    // list -- so the arm you would switch to is already
                    // the colour it will become. Painting every
                    // alternative red said only "not this one", which
                    // throws away the information the palette carries.
                    const optOrder = (fo.junctions ?? [])
                        .find(jj => jj.species === n.id)?.options ?? [];
                    const ghostCol = gp => {
                        const k = optOrder.findIndex(o => o.id === gp.optionId);
                        return ROUTE_COLS[(k < 0 ? 1 : k) % ROUTE_COLS.length];
                    };
                    const ghosts = [...fo.ghostPaths]
                        // The outgoing branch first, so it gets the
                        // nearer fan slot it is travelling into.
                        .sort((a, b) => (prevIds.has(b.optionId) ? 1 : 0)
                                      - (prevIds.has(a.optionId) ? 1 : 0))
                        .slice(0, 2);
                    // On a vertical chain the node NAMES already occupy
                    // the right-hand side, so ghosts fan LEFT; on a ring
                    // or short chain they fan right, where there is room.
                    const vert = !fo.cyclic && steps.length > 5;
                    const side = vert ? -1 : 1;
                    ghosts.forEach((gp, gi) => {
                        // The arm that WAS the trunk is always first in
                        // the list after a swap, so it gets the receding
                        // motion; the others are static context.
                        // Travelling out: this arm WAS the trunk, so its
                        // boxes start at the trunk's own node positions
                        // and move into the fan. Rotating it in place
                        // looked like a different branch appearing; this
                        // looks like the one you were on stepping aside.
                        const outgoing = swap < 1 && prevIds.has(gp.optionId);
                        const col = ghostCol(gp);
                        // Save UNCONDITIONALLY. Multiplying globalAlpha
                        // without a matching restore compounded on every
                        // draw call and faded the entire card to black --
                        // alpha is canvas-wide state, not per-shape.
                        ctx.save();
                        ctx.globalAlpha = outgoing ? (1 - ease * 0.45)
                                                   : (0.5 + 0.35 * (1 - swap));
                        const dir = gi === 0 ? -1 : 1;
                        const stepLen = 34 * useDPR;
                        let gx = x, gy = y;
                        ctx.font = mono(8);
                        gp.steps.slice(0, 3).forEach((gs, si) => {
                            let nx = gx + side * stepLen;
                            let ny = gy + dir * (si === 0 ? 26 : 14) * useDPR;
                            if (outgoing) {
                                // Lerp from where the trunk drew this
                                // step to where the ghost fan wants it.
                                const [tx0, ty0] = pos(Math.min(steps.length - 1,
                                                               FORK.at + 1 + si));
                                nx = tx0 + (nx - tx0) * ease;
                                ny = ty0 + (ny - ty0) * ease;
                            }
                            // Brighter during the swap: the arm being
                            // drawn was the trunk a moment ago, and
                            // watching it dim is what says "that road is
                            // the one you just left".
                            ctx.strokeStyle = col;
                            ctx.lineWidth = 1.2 * useDPR;
                            ctx.setLineDash([2 * useDPR, 2 * useDPR]);
                            ctx.beginPath();
                            ctx.moveTo(gx, gy); ctx.lineTo(nx, ny);
                            ctx.stroke();
                            ctx.setLineDash([]);
                            ctx.strokeRect(nx - 3 * useDPR, ny - 3 * useDPR,
                                           6 * useDPR, 6 * useDPR);
                            ctx.fillStyle = col;
                            ctx.textAlign = side < 0 ? "right" : "left";
                            ctx.fillText(gs.name.toUpperCase(),
                                         nx + side * 7 * useDPR, ny + 3 * useDPR);
                            gx = nx; gy = ny;
                        });
                        // What would have to change to take it.
                        ctx.fillStyle = col;
                        ctx.textAlign = side < 0 ? "right" : "left";
                        ctx.fillText(`IF ${(gp.when ?? "").toUpperCase()}`,
                                     x + side * 12 * useDPR, y + dir * 13 * useDPR);
                        ctx.textAlign = "center";
                        ctx.restore();
                    });
                }

                ctx.fillStyle = isCur ? "#ffffff" : reached ? "#9cb59c" : "#3b4d3b";
                ctx.font = mono(isCur ? 10 : 9, isCur ? 700 : 400);

                if (fo.cyclic) {
                    ctx.fillText(n.name, cx + (x - cx) * 1.38, cy + (y - cy) * 1.38 + 3 * useDPR);
                } else if (steps.length > 5) {
                    ctx.textAlign = "left";
                    ctx.fillText(n.name, x + 18 * useDPR, y + 3 * useDPR);
                    ctx.textAlign = "center";
                } else {
                    ctx.fillText(n.name, x, y + 22 * useDPR);
                }
                if (swingNode) ctx.restore();
            });

            // ── OUTGOING BRANCH ────────────────────────────────────────
            // Drawn as FULL NODES at the trunk's own positions, receding
            // into the fan. Previously the old branch simply stopped
            // being drawn and a small ghost box animated instead, so the
            // nodes you were following vanished the instant you tapped --
            // the one thing the transition is supposed to prevent.
            if (swap < 1 && FORK.at !== -1) {
                const out = (fo.ghostPaths ?? []).find(g => prevIds.has(g.optionId));
                if (out) {
                    ctx.save();
                    ctx.globalAlpha = 1 - ease * 0.75;
                    const [ox, oy] = pos(FORK.at);
                    ctx.translate(ox, oy);
                    ctx.rotate(ease * 0.5);              // swings back
                    ctx.scale(1 - ease * 0.35, 1 - ease * 0.35);
                    ctx.translate(-ox, -oy);

                    const col = ROUTE_COLS[0];
                    out.steps.slice(0, 3).forEach((os, si) => {
                        const [tx, ty] = pos(Math.min(steps.length - 1, FORK.at + 1 + si));
                        const [gxp, gyp] = fanPos(si, -1);
                        const nx = tx + (gxp - tx) * ease;
                        const ny = ty + (gyp - ty) * ease;

                        ctx.strokeStyle = col;
                        ctx.lineWidth = 1.6 * useDPR;
                        ctx.beginPath();
                        ctx.moveTo(ox, oy); ctx.lineTo(nx, ny);
                        ctx.stroke();

                        ctx.beginPath();
                        ctx.arc(nx, ny, 6 * useDPR, 0, Math.PI * 2);
                        ctx.fillStyle = col; ctx.fill();

                        ctx.fillStyle = col;
                        ctx.font = mono(9, 700);
                        ctx.textAlign = "left";
                        ctx.fillText(os.name.toUpperCase(),
                                     nx + 11 * useDPR, ny + 3 * useDPR);
                        ctx.textAlign = "center";
                    });
                    ctx.restore();
                }
            }

            // Console Footer Telemetry
            ctx.fillStyle = step.blocked ? CRT_WARN : step.fired ? "#7a9b7a" : CRT_WARN;
            ctx.font = mono(9);
            ctx.fillText(step.blocked ? "[SYS_HALTED]: INTERLOCK ENGAGED" : (step.tech ?? "").toUpperCase(), W / 2, H - 42 * useDPR);

            if (fo.feeders?.length) {
                ctx.fillStyle = CRT_AMBER;
                ctx.font = mono(8);
                ctx.fillText(`EXT_FEED: ${fo.feeders.map(f => f.name.toUpperCase()).join(", ")}`, W / 2, H - 54 * useDPR);
            }

            if (ROMULUS) drawCRTOverlays(ctx, W, H);
        }

        draw(0, 0);
        startSweepLoop(sampleId, safeDuration, e => {
            const raw = Math.floor((Number.isFinite(e) ? e : 0) / stepMs);
            const idx = Math.max(0, Math.min(steps.length - 1, Number.isFinite(raw) ? raw : 0));
            draw(idx, (e % stepMs) / stepMs || 0);
        });
    },
});

})();