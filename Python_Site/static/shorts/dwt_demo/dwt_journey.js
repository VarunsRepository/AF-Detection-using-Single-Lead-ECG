// ---------------------------------------------------------------------------
// dwt_journey.js
// A genuine 2-Stage Journey for the DWT demo -- Stage 0 (Raw Signal, an
// animated sweep) and Stage 1 (Decomposition, a MULTI-SELECT comparison
// view). Stage 1 deliberately does NOT use the single-select sweep pattern
// Stage 0 and the main app's explainer both use: comparing shapes/scales
// ACROSS wavelet levels (e.g. is baseline wander showing up in A5 but not
// D1?) genuinely needs several plots visible simultaneously, which a
// "pick one, see one" interaction can't do. Toggling a level on/off adds
// or removes its own small static chart in a scrollable stack -- multiple
// can be active at once, independently.
//
// Reuses the REAL sweep-animation machinery from shared_signal_utils.js
// for Stage 0 (fetchSignal, renderWaveformSweep, cancelSweepAnimation,
// buildChartLayout) -- the same functions the main ECG pipeline's Stage
// 0/1 renderers call.
//
// Deliberately NOT using stage_engine.js's registerStage()/dependsOn or
// stage_machine.js's initCard(): those are tightly coupled to the main
// pipeline's Journey/Card system (pagination, the feed, per-sample
// invert/theme state). This is a much smaller, standalone 2-stage
// navigator, purpose-built for this one demo -- reusing the RENDERING
// machinery, not the full navigation engine.
//
// Depends on shared_signal_utils.js (fetchSignal, renderWaveformSweep,
// cancelSweepAnimation, buildChartLayout), rail_controls.js (THEMES,
// themeIndex), and filters/dwt_filter.js (multiLevelHaarDWT) -- all must
// be loaded before this file.
// ---------------------------------------------------------------------------

const DWT_JOURNEY_STAGE_DURATION_MS = 3000; // fixed pace for this demo -- not tied to the main app's Speed control, deliberately decoupled

function initDwtJourney(sampleId) {
    const stageEls = Array.from(document.querySelectorAll("#dwt-viewport .stage-content"));
    const segments = Array.from(document.querySelectorAll("#dwt-stage-bar .segment"));
    const maxStage = stageEls.length - 1;

    let currentStage = 0;
    let decomposition = null; // filled once Stage 1 is first reached
    let rawSignal = null;
    let rawFs = null;

    function enterStage(stageIdx) {
        currentStage = Math.max(0, Math.min(stageIdx, maxStage));

        stageEls.forEach(el => el.classList.toggle("active", Number(el.dataset.stage) === currentStage));
        segments.forEach((seg, i) => {
            seg.classList.toggle("completed", i < currentStage);
            seg.classList.toggle("current", i === currentStage);
        });

        cancelSweepAnimation(sampleId);

        if (currentStage === 0) {
            renderStage0();
        } else {
            renderStage1();
        }
    }

    async function renderStage0() {
        const container = document.getElementById("dwt-chart-0");
        const fetched = await fetchSignal(sampleId);
        if (!fetched) return;
        rawSignal = fetched.signal;
        rawFs = fetched.fs;

        const t = rawSignal.map((_, i) => i / rawFs);
        renderWaveformSweep(container, sampleId, DWT_JOURNEY_STAGE_DURATION_MS, t, rawSignal, rawFs);
    }

    function renderStage1() {
        const container = document.getElementById("dwt-chart-1"); // now a STACK CONTAINER, not a single chart
        const picker = document.getElementById("dwt-level-picker");

        if (!rawSignal) return; // Stage 0 hasn't fetched yet -- shouldn't normally happen since navigation is linear, but a safe guard

        // Once a sweep is running here, cancel it -- this stage is now a
        // static, side-by-side comparison view, not an animation.
        cancelSweepAnimation(sampleId);

        // THE PIPELINE -- computed once per Journey, not per toggle tap.
        if (!decomposition) {
            decomposition = multiLevelHaarDWT(rawSignal, 6);
        }

        // Standard wavelet convention: every level's DETAIL is independently
        // meaningful (D1..Dn), but only the FINAL level's APPROXIMATION is --
        // A1..A(n-1) are just intermediate steps on the way to the last one,
        // not something anyone examines on its own. Exposing all of them as
        // toggle options would just be noise.
        const finalLevel = decomposition[decomposition.length - 1];
        const allOptions = [
            { id: "original", label: "Original", data: rawSignal },
            ...decomposition.map(d => ({ id: `d${d.level}`, label: `D${d.level}`, data: d.detail })),
            { id: `a${finalLevel.level}`, label: `A${finalLevel.level}`, data: finalLevel.approx },
        ];

        // Independent toggles now, not exclusive selection -- tapping one
        // does NOT clear any other's state. "Original" starts pre-toggled
        // so there's always at least one reference view on screen.
        const activeIds = new Set(["original"]);

        function renderStack() {
            container.innerHTML = "";
            allOptions
                .filter(opt => activeIds.has(opt.id))
                .forEach(opt => {
                    const item = document.createElement("div");
                    item.className = "dwt-stack-item";
                    item.innerHTML = `
                        <div class="dwt-stack-item-label">${opt.label}</div>
                        <div class="dwt-stack-item-chart"></div>
                    `;
                    container.appendChild(item);
                    drawStaticLevel(item.querySelector(".dwt-stack-item-chart"), opt.data);
                });
        }

        picker.innerHTML = "";
        allOptions.forEach((opt) => {
            const btn = document.createElement("button");
            btn.className = "explain-step-btn";
            btn.textContent = opt.label;
            btn.classList.toggle("active", activeIds.has(opt.id));
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (activeIds.has(opt.id)) {
                    activeIds.delete(opt.id); // toggle OFF -- independent of every other button's state
                } else {
                    activeIds.add(opt.id); // toggle ON -- doesn't touch any other button
                }
                btn.classList.toggle("active", activeIds.has(opt.id));
                renderStack();
            });
            picker.appendChild(btn);
        });

        renderStack();
    }

    // Static, full-recording plot -- no sweep, no animation. Multiple of
    // these sit on screen simultaneously (one per toggled-on level), which
    // is the entire point: comparing shapes and scales across levels needs
    // them all visible together, not revealed one at a time.
    //
    // DOWNSAMPLED before plotting -- this was missing entirely, and is the
    // actual cause of the freeze on this page: "Original" can be 9,000+
    // points, D1 roughly half that, and toggling several levels on at once
    // meant SEVERAL full-resolution Plotly charts rendering synchronously
    // in one JS frame. Every other chart in this app downsamples (via
    // makeSampleAligner); this static comparison view was the one place
    // that never got that treatment.
    const MAX_STATIC_PLOT_POINTS = 600;

    function downsampleForStaticPlot(data) {
        if (data.length <= MAX_STATIC_PLOT_POINTS) return data.map((v, i) => [i, v]);
        const stride = Math.ceil(data.length / MAX_STATIC_PLOT_POINTS);
        const points = [];
        for (let i = 0; i < data.length; i += stride) points.push([i, data[i]]);
        // always include the true last sample, so the shape's actual endpoint is never silently cut off
        const lastIdx = data.length - 1;
        if (points[points.length - 1][0] !== lastIdx) points.push([lastIdx, data[lastIdx]]);
        return points;
    }

    function drawStaticLevel(chartDiv, data) {
        const points = downsampleForStaticPlot(data);
        const t = points.map(p => p[0]);
        const y = points.map(p => p[1]);
        const yMin = Math.min(...y) - 0.1;
        const yMax = Math.max(...y) + 0.1;

        const trace = {
            x: t, y: y, mode: "lines",
            line: { color: THEMES[themeIndex].traceColor, width: 1.2 },
            hoverinfo: "skip",
        };
        const layout = buildChartLayout(yMin, yMax, [t[0], t[t.length - 1]]);
        layout.margin = { t: 4, r: 6, b: 20, l: 34 }; // tighter than the default -- these are small stacked charts, not full-screen ones
        Plotly.newPlot(chartDiv, [trace], layout, { staticPlot: true, responsive: true });
    }

    // Minimal left/right tap zones -- same convention as the main app
    // (left = previous, right = advance), without the pause/resume/speed
    // machinery, which is real added complexity not needed for a 2-stage demo.
    const viewport = document.getElementById("dwt-viewport");
    viewport.addEventListener("click", (e) => {
        if (e.target.closest(".explain-step-btn")) return; // toggle taps handle themselves
        if (e.target.closest(".dwt-stack-container")) return; // scrolling/interacting with the stacked charts shouldn't trigger navigation
        const rect = viewport.getBoundingClientRect();
        const tappedRight = (e.clientX - rect.left) > rect.width / 2;
        if (tappedRight) {
            if (currentStage < maxStage) enterStage(currentStage + 1);
        } else {
            if (currentStage > 0) enterStage(currentStage - 1);
        }
    });

    enterStage(0);
}

document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const sampleId = params.get("sample") || "A00001";
    initDwtJourney(sampleId);
});