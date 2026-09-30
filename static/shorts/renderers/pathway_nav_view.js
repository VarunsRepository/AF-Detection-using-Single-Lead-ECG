// ---------------------------------------------------------------------------
// renderers/pathway_nav_view.js
// Weyland-Yutani Corp // Navigation Telemetry Tape (Alien: Romulus)
// ---------------------------------------------------------------------------

(function () {
"use strict";

function ROMULUS_BG() {
    const t = (typeof THEMES !== "undefined" && THEMES[themeIndex]) || {};
    return t.label === "Romulus" ? "#020503" : (t.bg || "#000000");
}

registerRenderingAlgorithm("pathway_nav_view", {

    choices(envelope) {
        const V = envelope?.meta?.pathway?.vocabulary ?? {};
        const cap = s => s ? s.toUpperCase() : s;
        return [{
            key: "emphasis",
            label: "DATA_REG",
            values: ["enzyme", "substrate", "cofactor"],
            display: {
                enzyme:    cap(V.edge ?? "EDGE"),
                substrate: cap(V.node ?? "NODE"),
                cofactor:  cap(V.side ?? "AUX"),
            },
        }];
    },

    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";
        container.style.backgroundColor = ROMULUS_BG();

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff3b30;font-family:'Courier New',monospace;padding:20px;">`
                + `[COMM_FAULT]: ${dspOutput.error.toUpperCase()}</p>`;
            return;
        }
        const fo = dspOutput.finalOutput ?? {};
        const tape = fo.tape ?? [];
        const moves = tape.filter(t => t.type === "move");
        if (!moves.length) {
            container.innerHTML = `<p style="color:#ff8b1f;font-family:'Courier New',monospace;padding:20px;">[EMPTY_TAPE_BUFFER]</p>`;
            return;
        }

        const byId = {};
        (fo.steps ?? []).forEach(s => { byId[s.id] = s; });
        const spName = id => (fo.species?.[id]?.name ?? id ?? "").toUpperCase();

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


        // Industrial Phosphor Constants
        const CRT_AMBER    = ROMULUS ? "#ff9900" : _accent;
        const CRT_GREEN    = ROMULUS ? "#57e389" : "#9aa4b0";
        const CRT_CYAN     = ROMULUS ? "#2de2e6" : "#3b82f6";
        const CRT_WARN     = ROMULUS ? "#ff3b30" : "#e74c3c";
        const SPUR         = "#ff8b1f";
        const ROUTE_COLS   = ["#ff9900", "#2de2e6", "#e0e722", "#ff5376"];

        const junctionIds = new Set((fo.junctions ?? []).map(j => j.species));
        const activeIds   = new Set((fo.steps ?? []).map(s => s.id));
        const forkFrame   = frames.findIndex(f => junctionIds.has(f.from));
        const takenIdx = (() => {
            if (forkFrame === -1) return 0;
            const j = (fo.junctions ?? []).find(x => x.species === frames[forkFrame].from);
            const i = (j?.options ?? []).findIndex(o => activeIds.has(o.id));
            return i < 0 ? 0 : i;
        })();
        const FORK = ROUTE_COLS[takenIdx % ROUTE_COLS.length];
        const stepMs = Math.max(1, durationMs) / frames.length;

        const at = i => {
            if (fo.cyclic) return frames[((i % frames.length) + frames.length) % frames.length];
            return (i < 0 || i >= frames.length) ? null : frames[i];
        };

        function drawCRTOverlays(ctx, W, H) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
            for (let y = 0; y < H; y += 3 * useDPR) {
                ctx.fillRect(0, y, W, 1.2 * useDPR);
            }
            const vig = ctx.createRadialGradient(W / 2, H / 2, W * 0.4, W / 2, H / 2, W * 0.72);
            vig.addColorStop(0, "rgba(0,0,0,0)");
            vig.addColorStop(1, "rgba(0,10,2,0.65)");
            ctx.fillStyle = vig;
            ctx.fillRect(0, 0, W, H);
        }

        function drawHud(ctx, W, H, idx) {
            const r = 24 * useDPR;
            const cx = W - r - 20 * useDPR, cy = r + 24 * useDPR;
            const trunk = frames.filter(f => f.depth === 0);
            const cur = frames[idx];
            let pos = trunk.indexOf(cur);
            if (pos === -1) {
                for (let k = idx; k >= 0; k--) {
                    const p = trunk.indexOf(frames[k]);
                    if (p !== -1) { pos = p; break; }
                }
            }

            // Radar Enclosure
            ctx.strokeStyle = "rgba(87, 227, 137, 0.25)";
            ctx.lineWidth = 1.2 * useDPR;
            ctx.strokeRect(cx - r - 8 * useDPR, cy - r - 8 * useDPR, (r + 8 * useDPR) * 2, (r + 8 * useDPR) * 2);

            if (fo.cyclic) {
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
                trunk.forEach((f, i) => {
                    const a = (i / trunk.length) * Math.PI * 2 - Math.PI / 2;
                    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
                    ctx.fillStyle = i === pos ? CRT_AMBER : "rgba(87, 227, 137, 0.35)";
                    ctx.fillRect(px - 2 * useDPR, py - 2 * useDPR, 4 * useDPR, 4 * useDPR);
                });
            } else {
                ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
                trunk.forEach((f, i) => {
                    const x = (cx - r) + (i / Math.max(1, trunk.length - 1)) * (r * 2);
                    ctx.fillStyle = i === pos ? CRT_AMBER : "rgba(87, 227, 137, 0.35)";
                    ctx.fillRect(x - 2 * useDPR, cy - 2 * useDPR, 4 * useDPR, 4 * useDPR);
                });
            }

            ctx.fillStyle = CRT_GREEN;
            ctx.font = `${8 * useDPR}px ${FONT}`;
            ctx.textAlign = "center";
            ctx.fillText(cur.depth > 0 ? "DETOUR // SPUR" : (fo.cyclic ? "LOOP_SYS" : "REL_TRACK"),
                         cx, cy + r + 15 * useDPR);
        }

        function draw(idx, frac = 0) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);
            const mono = (s, w = 400) => `${w} ${s * useDPR}px ${FONT}`;

            const cur = frames[idx];
            if (!cur) return;

            // Terminal Header Banner
            ctx.textAlign = "left";
            ctx.fillStyle = CRT_AMBER;
            ctx.font = mono(12, 700);
            ctx.fillText(`WY-TERM // ${(fo.name ?? "TRACK").toUpperCase()}`, 18 * useDPR, 26 * useDPR);

            if (fo.conditions) {
                ctx.font = mono(9);
                let cx2 = 18 * useDPR;
                Object.entries(fo.conditions).forEach(([k, v]) => {
                    const spec  = fo.declaredConditions?.[k] ?? {};
                    const shown = spec.display?.[String(v)] ?? v;
                    const txt   = `${(spec.label ?? k).toUpperCase()}:${String(shown).toUpperCase()}  `;
                    ctx.fillStyle = CRT_GREEN;
                    ctx.fillText(txt, cx2, 42 * useDPR);
                    cx2 += ctx.measureText(txt).width + 8 * useDPR;
                });
            }

            drawHud(ctx, W, H, idx);

            const cy = H * 0.54;
            const gap = Math.min(H * 0.135, 62 * useDPR);
            const raw = Math.max(0, (frac - 0.62) / 0.38);
            const slide = raw * raw * (3 - 2 * raw);

            for (let k = -3; k <= 3; k++) {
                const f = at(idx + k);
                if (!f) continue;
                const off = k - slide;
                const y = cy + off * gap;
                const dist = Math.abs(off);
                if (dist > 2.6) continue;

                const isCur = dist < 0.5;
                const past = off < -0.5;
                const atFork = junctionIds.has(f.from);
                const onRoute = forkFrame !== -1 && (idx + k) >= forkFrame;
                const alpha = Math.max(0.12, Math.min(1, 1 - dist * 0.42));

                const col = f.depth > 0 ? SPUR
                          : onRoute     ? FORK
                          : isCur       ? CRT_AMBER
                          : past        ? "rgba(87, 227, 137, 0.4)"
                                        : "rgba(255, 255, 255, 0.25)";

                ctx.globalAlpha = alpha;
                const x = 24 * useDPR + (f.depth > 0 ? 18 * useDPR : 0);

                // Industrial Reticle Points
                ctx.strokeStyle = col;
                ctx.lineWidth = (isCur ? 2.2 : 1.2) * useDPR;
                ctx.strokeRect(x - (isCur ? 6 : 4) * useDPR, y - (isCur ? 6 : 4) * useDPR,
                               (isCur ? 12 : 8) * useDPR, (isCur ? 12 : 8) * useDPR);

                if (isCur) {
                    ctx.fillStyle = col;
                    ctx.fillRect(x - 2 * useDPR, y - 2 * useDPR, 4 * useDPR, 4 * useDPR);
                }

                // Connector Trace
                if (k < 3 && at(idx + k + 1)) {
                    const top = y + 7 * useDPR;
                    const bot = y + gap - 7 * useDPR;
                    ctx.strokeStyle = "rgba(87, 227, 137, 0.15)";
                    ctx.lineWidth = 1.2 * useDPR;
                    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();

                    const grow = isCur ? Math.min(1, Math.max(0, slide / 0.999)) : (off < 0 ? 1 : 0);
                    if (grow > 0) {
                        ctx.strokeStyle = col;
                        ctx.lineWidth = 2 * useDPR;
                        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + (bot - top) * grow); ctx.stroke();
                    }
                }

                const facts = {
                    edge: (f.step?.name ?? f.reaction).toUpperCase(),
                    node: `${spName(f.from)} -> ${spName(f.to)}`,
                    side: [
                        ...(f.step?.cofactorsIn  ?? []).map(cc => `-${cc.name.toUpperCase()}`),
                        ...(f.step?.cofactorsOut ?? []).map(cc => `+${cc.name.toUpperCase()}`),
                    ].join(" ") || "NONE",
                };
                const order = ({
                    enzyme:    ["edge", "node", "side"],
                    substrate: ["node", "edge", "side"],
                    cofactor:  ["side", "edge", "node"],
                })[config.emphasis ?? "enzyme"] ?? ["edge", "node", "side"];

                // Data Callouts
                ctx.fillStyle = isCur ? "#ffffff" : "rgba(255, 255, 255, 0.4)";
                ctx.font = mono(isCur ? 12 : 10, isCur ? 700 : 400);
                ctx.textAlign = "left";
                ctx.fillText(facts[order[0]], x + 18 * useDPR, y + (isCur ? 4 : 3) * useDPR);

                if (isCur) {
                    ctx.fillStyle = CRT_GREEN;
                    ctx.font = mono(9);
                    ctx.fillText(`>> ${facts[order[1]]}`, x + 18 * useDPR, y + 19 * useDPR);

                    // Cofactors / Modifiers
                    const spent = (f.step?.cofactorsIn ?? []).map(c => `-${c.name.toUpperCase()}`);
                    const made  = (f.step?.cofactorsOut ?? []).map(c => `+${c.name.toUpperCase()}`);
                    if (spent.length || made.length) {
                        ctx.font = mono(8);
                        ctx.fillStyle = CRT_WARN;
                        ctx.fillText(spent.join(" "), x + 18 * useDPR, y + 33 * useDPR);
                        const w = ctx.measureText(spent.join(" ")).width;
                        ctx.fillStyle = CRT_GREEN;
                        ctx.fillText(made.join(" "), x + 24 * useDPR + w, y + 33 * useDPR);
                    }

                    const mods = f.step?.modifiers ?? [];
                    if (mods.length) {
                        ctx.font = mono(8, 700);
                        let mx = x + 18 * useDPR;
                        for (const m of mods) {
                            const inhib = m.role === "inhibitor";
                            const txt = `[${inhib ? "INHIB" : "ACT"}:${m.species.toUpperCase()}]`;
                            ctx.fillStyle = inhib ? CRT_WARN : CRT_CYAN;
                            ctx.fillText(txt, mx, y + 46 * useDPR);
                            mx += ctx.measureText(txt).width + 8 * useDPR;
                        }
                    }
                }
                ctx.globalAlpha = 1;
            }

            // Ledger / Bottom Console
            const led = (fo.cofactors ?? []).slice(0, 3);
            if (led.length) {
                ctx.textAlign = "right";
                ctx.font = mono(8);
                let ly = H - 54 * useDPR;
                ctx.fillStyle = "#5c6d5c";
                ctx.fillText(`-- AUX LEDGER --`, W - 18 * useDPR, ly);
                for (const cf of led) {
                    ly += 11 * useDPR;
                    ctx.fillStyle = cf.net > 0 ? CRT_GREEN : cf.net < 0 ? CRT_WARN : "#8b9f8b";
                    ctx.fillText(`${cf.name.toUpperCase()}: ${cf.net > 0 ? "+" : ""}${cf.net}`, W - 18 * useDPR, ly);
                }
            }

            ctx.textAlign = "center";
            ctx.fillStyle = CRT_GREEN;
            ctx.font = mono(8);
            ctx.fillText(`FRAME [${String(idx + 1).padStart(2, '0')}/${String(frames.length).padStart(2, '0')}] // W-Y BIOS VER 4.22`, W / 2, H - 12 * useDPR);

            if (ROMULUS) drawCRTOverlays(ctx, W, H);
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