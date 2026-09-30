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

        // ── SKIN ────────────────────────────────────────────────────────
        // The Theme button cycles THEMES; this renderer reads the active
        // one and dresses itself accordingly. Romulus gets the amber
        // phosphor palette, Courier, scanlines and a vignette; every
        // other theme gets its own trace colour and none of the CRT
        // treatment.
        //
        // Skinning rather than a second renderer keeps ONE implementation
        // of the walk: a Romulus copy would drift from the original the
        // first time either was fixed.
        const _theme   = (typeof THEMES !== "undefined" && THEMES[themeIndex]) || {};
        const ROMULUS  = _theme.label === "Romulus";
        const _accent  = _theme.traceColor || "#5cc24a";
        const FONT     = ROMULUS ? '"Courier New", monospace'
                                 : '"IBM Plex Mono", monospace';


        // Romulus Phosphor Avionics Palette
        const CRT_AMBER    = ROMULUS ? "#ff9900" : _accent; // Primary Weyland Amber Phosphor
        const CRT_GREEN    = ROMULUS ? "#57e389" : "#9aa4b0"; // Sub-system Green Phosphor
        const CRT_CYAN     = ROMULUS ? "#2de2e6" : "#3b82f6"; // Nav telemetry
        const CRT_WARN     = ROMULUS ? "#ff3b30" : "#e74c3c"; // Hull Breach / Failure
        const CRT_MUTED    = ROMULUS ? "#3d4b3d" : "#4a5260"; // Dim cathode background
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

        const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10000;
        const stepMs = safeDuration / steps.length;

        function drawCRTOverlays(ctx, W, H) {
            // Horizontal scanlines
            ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
            for (let y = 0; y < H; y += 3 * useDPR) {
                ctx.fillRect(0, y, W, 1.2 * useDPR);
            }

            // CRT Corner Brackets & Graticules
            const pad = 12 * useDPR;
            const arm = 14 * useDPR;
            ctx.strokeStyle = "rgba(87, 227, 137, 0.35)";
            ctx.lineWidth = 1.2 * useDPR;

            // TL, TR, BL, BR
            [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]]
                .forEach(([x, y, dx, dy]) => {
                    ctx.beginPath();
                    ctx.moveTo(x, y + dy * arm);
                    ctx.lineTo(x, y);
                    ctx.lineTo(x + dx * arm, y);
                    ctx.stroke();
                });

            // Outer Screen Vignette
            const vig = ctx.createRadialGradient(W / 2, H / 2, W * 0.35, W / 2, H / 2, W * 0.7);
            vig.addColorStop(0, "rgba(0,0,0,0)");
            vig.addColorStop(1, "rgba(0,10,2,0.65)");
            ctx.fillStyle = vig;
            ctx.fillRect(0, 0, W, H);
        }

        function draw(idx, frac) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);

            // Subtle dark grid background
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

            const cx = W / 2, cy = H * 0.53;
            const R  = Math.min(W, H) * 0.28;

            const pos = i => {
                if (fo.cyclic) {
                    const a = (i / steps.length) * Math.PI * 2 - Math.PI / 2;
                    return [cx + Math.cos(a) * R, cy + Math.sin(a) * R];
                }
                if (steps.length > 5) {
                    const top = H * 0.18, bot = H * 0.82;
                    return [W * 0.52, top + (i / Math.max(1, steps.length - 1)) * (bot - top)];
                }
                const span = W - 80 * useDPR;
                return [40 * useDPR + (i / Math.max(1, steps.length - 1)) * span, cy];
            };

            // ARCS
            steps.forEach((s, i) => {
                const [x0, y0] = pos(i);
                const [x1, y1] = pos((i + 1) % steps.length);
                if (!fo.cyclic && i === steps.length - 1) return;

                const state = s.blocked ? "blocked" : s.fired ? "fired" : "starved";
                const active = i === idx;
                const onRoute = FORK.at !== -1 && i >= FORK.at;
                const liveCol = onRoute ? FORK.col : CRT_AMBER;

                // Static Track
                ctx.strokeStyle = state === "fired"
                    ? (i <= idx ? "rgba(87, 227, 137, 0.25)" : "rgba(255, 255, 255, 0.08)")
                    : CRT_WARN;
                ctx.lineWidth = 1.8 * useDPR;
                ctx.setLineDash([4 * useDPR, 2 * useDPR]);
                ctx.beginPath();
                ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
                ctx.stroke();
                ctx.setLineDash([]);

                // Progressive Active Beam
                if (active) {
                    const p = Math.min(1, Math.max(0, frac));
                    const e = p * p * (3 - 2 * p);
                    const xt = x0 + (x1 - x0) * e;
                    const yt = y0 + (y1 - y0) * e;

                    ctx.strokeStyle = liveCol;
                    ctx.lineWidth = 3.5 * useDPR;
                    ctx.shadowColor = liveCol;
                    ctx.shadowBlur = 8 * useDPR;
                    ctx.beginPath();
                    ctx.moveTo(x0, y0); ctx.lineTo(xt, yt);
                    ctx.stroke();
                    ctx.shadowBlur = 0; // reset

                    // Beam Particle Head
                    ctx.fillStyle = "#ffffff";
                    ctx.beginPath();
                    ctx.arc(xt, yt, 3 * useDPR, 0, Math.PI * 2);
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
            });

            // NODES (Avionics Graticules)
            nodes.forEach((n, i) => {
                const [x, y] = pos(i);
                const reached = i <= idx;
                const isCur = i === idx;
                const r = (isCur ? 9 : 6) * useDPR;

                ctx.strokeStyle = reached ? CRT_GREEN : CRT_MUTED;
                ctx.lineWidth = 1.4 * useDPR;

                // Boxy CRT reticle for current node
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

                // Branch offshoot
                if (FORK.at !== -1 && i === FORK.at && FORK.others.length) {
                    const sx = x + 16 * useDPR, sy = y - 20 * useDPR;
                    ctx.strokeStyle = "rgba(255, 83, 118, 0.4)";
                    ctx.setLineDash([2 * useDPR, 2 * useDPR]);
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(sx, sy); ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.strokeRect(sx - 3 * useDPR, sy - 3 * useDPR, 6 * useDPR, 6 * useDPR);
                    ctx.fillStyle = "#ff5376";
                    ctx.font = mono(8);
                    ctx.textAlign = "left";
                    ctx.fillText(`ALT: ${FORK.others[0].name.toUpperCase()}`, sx + 6 * useDPR, sy + 3 * useDPR);
                    ctx.textAlign = "center";
                }

                // Labels
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
            });

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