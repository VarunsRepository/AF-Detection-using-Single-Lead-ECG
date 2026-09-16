// ---------------------------------------------------------------------------
// renderers/aes_state_grid.js
//
// Renders the AES state as a 4x4 byte grid, stepping through the DSPE's
// interimOutputs rather than sweeping over time.
//
// HOW THIS DIFFERS FROM EVERY OTHER RENDERER HERE
//   chart_v1_canvas and friends read finalOutput and animate along a TIME
//   axis -- the signal is the product, the intermediates are a byproduct.
//   AES inverts that: there is no meaningful "final answer" beyond a hex
//   string, and the whole explanation IS the sequence of intermediate
//   states. So this renderer consumes interimOutputs directly and its
//   axis is STEPS, not seconds.
//
//   durationMs therefore means "budget for the whole sequence" rather
//   than real elapsed signal time. It is divided across steps, weighted
//   by repeatRole (see below).
//
// BYTE ORDER -- verified, not assumed
//   FIPS-197 state is COLUMN-MAJOR: byte k sits at row k%4, column k//4.
//   This was checked against the ShiftRows shuffle mask in the original
//   C++ rather than inferred. Rendering it row-major would produce a grid
//   that looks entirely plausible and is transposed, so the mapping is
//   done in exactly one place (cellIndex) to keep it auditable.
//
// DEPTH
//   config.depth selects which level of the capture tree to show:
//     1  round-level    plaintext, whitening, "Round 1".."Round 10"
//     2  step-level     SubBytes, ShiftRows, MixColumns, AddRoundKey
//     3  inside a step  per-column within MixColumns
//   Filtering happens here at DISPLAY time -- the DSPE already captured
//   everything in one run, so changing depth costs nothing and never
//   re-runs the cipher. (That only holds because AES states are 16 bytes;
//   a CNN would have to gate at capture time instead.)
//
// REPETITION
//   Rounds 2-9 are structurally identical to round 1. Captures tagged
//   repeatRole:"repeat" get a fraction of the time budget -- the viewer
//   learns the mechanism from the exemplar and sees only the variety
//   from the rest. Watching round 7 at full speed teaches nothing new.
//
// Self-registers into RENDER_ALGORITHMS (rendering_registry.js must load first).
// ---------------------------------------------------------------------------

registerRenderingAlgorithm("aes_state_grid", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const all = dspOutput.interimOutputs ?? [];
        if (all.length === 0) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">No interim outputs to render.</p>`;
            return;
        }

        // ── Select which captures to show ────────────────────────────────
        const depth  = config.depth ?? 2;
        const parent = config.drillParent ?? null;
        // phase separates key expansion from encryption. expandKey always
        // runs (encryption needs the round keys), so both sets of captures
        // are present in every result -- without filtering on phase a
        // depth-1 view would interleave "Round key 6" with "Round 1".
        const phase  = config.phase ?? "encrypt";

        let steps = all.filter(c => c.phase === phase && c.depth === depth);
        if (parent) steps = steps.filter(c => c.parent === parent);
        // Falling back rather than rendering nothing: a recipe asking for a
        // depth this DSPE never emitted should degrade, not break.
        if (steps.length === 0) steps = all.filter(c => c.phase === phase && c.depth === 1);

        // ── Time budget, weighted by repeatRole ──────────────────────────
        // An exemplar is worth several repeats. Weights are relative, then
        // normalised to durationMs, so the whole sequence always fits the
        // stage duration regardless of how many steps there are.
        const WEIGHT = { exemplar: 3, repeat: 1, summary: 0.4 };
        const weights   = steps.map(s => WEIGHT[s.repeatRole] ?? 2);
        const weightSum = weights.reduce((a, b) => a + b, 0);
        const stepMs    = weights.map(w => (w / weightSum) * durationMs);

        // Cumulative boundaries -- lets elapsed time map to a step index
        // with a single scan rather than recomputing each frame.
        const bounds = [];
        let acc = 0;
        for (const ms of stepMs) { acc += ms; bounds.push(acc); }

        // ── Theme ────────────────────────────────────────────────────────
        const root       = getComputedStyle(document.documentElement);
        const accent     = (typeof THEMES !== "undefined" && THEMES[themeIndex]?.traceColor)
                           || root.getPropertyValue("--accent").trim() || "#5cc24a";
        const dimText    = "#78828e";
        const cellBg     = "rgba(255,255,255,0.04)";
        const cellBorder = "rgba(255,255,255,0.10)";

        // ── DOM ──────────────────────────────────────────────────────────
        const wrap = document.createElement("div");
        wrap.style.cssText = `
            display:flex; flex-direction:column; align-items:center;
            justify-content:center; height:100%; gap:14px;
            font-family:'IBM Plex Mono',ui-monospace,monospace;`;

        const stepLabel = document.createElement("div");
        stepLabel.style.cssText =
            `font-size:15px; font-weight:600; color:${accent}; text-align:center;`;

        const stepTech = document.createElement("div");
        stepTech.style.cssText =
            `font-size:11px; color:${dimText}; text-align:center;
             min-height:15px; margin-top:-8px; padding:0 12px;`;

        const grid = document.createElement("div");
        grid.style.cssText = `
            display:grid; grid-template-columns:repeat(4,1fr);
            gap:5px; width:min(70vw,250px); aspect-ratio:1;`;

        // 16 cells, created once and mutated per step. Rebuilding them each
        // frame would restart the CSS transition that drives the highlight.
        const cells = [];
        for (let i = 0; i < 16; i++) {
            const cell = document.createElement("div");
            cell.style.cssText = `
                display:flex; align-items:center; justify-content:center;
                background:${cellBg}; border:1px solid ${cellBorder};
                border-radius:5px; font-size:clamp(11px,3.4vw,16px);
                font-weight:500; color:#d6dde5;
                transition:background .22s ease, color .22s ease,
                           border-color .22s ease;`;
            cell.textContent = "00";
            grid.appendChild(cell);
            cells.push(cell);
        }

        const hexLine = document.createElement("div");
        hexLine.style.cssText = `
            font-size:10px; color:${dimText}; letter-spacing:.06em;
            word-break:break-all; text-align:center;
            max-width:min(78vw,300px); line-height:1.5;`;

        const progress = document.createElement("div");
        progress.style.cssText = `font-size:10px; color:${dimText};`;

        wrap.append(stepLabel, stepTech, grid, hexLine, progress);
        container.appendChild(wrap);

        // ── Column-major mapping, in exactly one place ───────────────────
        // Grid position (row, col) -> byte index. FIPS-197 fills the state
        // down columns, so index = row + 4*col. Every read of the state
        // goes through here.
        function cellIndex(row, col) { return row + 4 * col; }

        // ── Draw one step ────────────────────────────────────────────────
        let lastDrawn = -1;
        function drawStep(idx) {
            if (idx === lastDrawn) return;      // cheap guard -- this is
            const step = steps[idx];            // called every frame
            if (!step) return;

            const bytes = step.data;
            const prev  = idx > 0 ? steps[idx - 1].data : null;

            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 4; col++) {
                    const k    = cellIndex(row, col);
                    const cell = cells[row * 4 + col];   // visual position
                    const b    = bytes[k] ?? 0;
                    cell.textContent = b.toString(16).padStart(2, "0");

                    // Highlight bytes this step actually changed. That is
                    // the entire point of the grid: ShiftRows moves bytes
                    // without altering values, SubBytes alters every value
                    // without moving anything, and the difference is only
                    // visible if changes are marked.
                    const changed = prev && prev[k] !== b;
                    cell.style.background   = changed ? accent : cellBg;
                    cell.style.color        = changed ? "#0b0d10" : "#d6dde5";
                    cell.style.borderColor  = changed ? accent : cellBorder;
                }
            }

            stepLabel.textContent = step.label;
            stepTech.textContent  = step.tech ?? "";
            hexLine.textContent   = Array.from(bytes)
                .map(b => b.toString(16).padStart(2, "0")).join("");

            const roleNote = step.repeatRole === "repeat" ? "  \u00b7 compressed" : "";
            progress.textContent = `${idx + 1} / ${steps.length}${roleNote}`;

            lastDrawn = idx;
        }

        drawStep(0);

        // ── Drive it off the shared sweep loop ───────────────────────────
        // Reusing startSweepLoop rather than a private rAF: pause, resume,
        // speed and restart already work through activeSweepControl, and a
        // separate loop would silently ignore all four.
        function drawAtElapsed(elapsed) {
            let idx = bounds.findIndex(b => elapsed < b);
            if (idx === -1) idx = steps.length - 1;
            drawStep(idx);
        }

        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});
