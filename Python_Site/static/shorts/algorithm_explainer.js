// ---------------------------------------------------------------------------
// algorithm_explainer.js
// Opt-in "how does this actually work" scrub bar. Lets someone step through
// an algorithm's own intermediate results (e.g. Pan-Tompkins' bandpass ->
// derivative -> squared -> integrated -> peaks) as full, static plots of the
// WHOLE recording -- not the windowed sweep the normal view uses, since the
// point here is seeing the shape of the transformation end to end, not
// watching a monitor-style animation.
//
// Depends on stage_engine.js (getCachedStageOutput), stage_renderers.js (buildChartLayout,
// cancelSweepAnimation) and stage_machine.js (clearAutoAdvance) -- both
// must be loaded before this file. Deliberately DECOUPLED from
// stage_renderers.js though: that file only calls attachAlgorithmExplainer()
// if it happens to exist (a `typeof` check), so this whole feature can be
// added or removed without stage_renderers.js needing to change at all.
// ---------------------------------------------------------------------------

const explainerBuilt = new Set(); // "sampleId-stageIdx" keys that already have their toggle/panel wired, so re-entering a stage doesn't duplicate DOM

function attachAlgorithmExplainer(container, sampleId) {
    const key = `${sampleId}-2`;
    const stageContent = container.closest(".stage-content");
    if (!stageContent || explainerBuilt.has(key)) return;
    explainerBuilt.add(key);

    const toggle = document.createElement("button");
    toggle.className = "explain-toggle";
    toggle.textContent = "?";
    toggle.title = "See how this works, step by step";

    const panel = document.createElement("div");
    panel.className = "explain-panel";

    stageContent.appendChild(toggle);
    stageContent.appendChild(panel);

    toggle.addEventListener("click", (e) => {
        e.stopPropagation(); // don't let this also trigger the stage tap-zones underneath
        openExplainer(sampleId, container, panel);
    });
}

function openExplainer(sampleId, container, panel) {
    // Reads Stage 2's already-computed output straight from the engine's
    // own cache -- no separate cache to keep in sync anymore.
    const cached = getCachedStageOutput(sampleId, 2);
    if (!cached) return;

    // freeze the normal sweep/timer while exploring -- both functions are
    // already global (from stage_renderers.js / stage_machine.js), so no
    // new coupling is needed to pause the card's usual behavior
    cancelSweepAnimation(sampleId);
    clearAutoAdvance(sampleId);

    // The Squared step's amplitude range is nothing like the original mV
    // scale (squaring makes everything positive and inflates the dynamic
    // range) -- the y-axis range itself is still calculated correctly for
    // that data, but the normal sweep view's small, fixed aspect-ratio box
    // just doesn't give it enough physical room to read comfortably. This
    // is a static, full-recording inspection view anyway, not the compact
    // sweep, so it can afford to take up much more of the screen.
    const stageContent = container.closest(".stage-content");
    if (stageContent) stageContent.classList.add("explaining");

    const { steps, peakIndices, t, y } = cached;
    const allSteps = [...steps, { label: "Heartbeats Found", tech: "Detected Peaks", data: y, peaks: peakIndices }];

    panel.innerHTML = "";
    panel.classList.add("open");

    allSteps.forEach((step) => {
        const btn = document.createElement("button");
        btn.className = "explain-step-btn";
        btn.textContent = step.label;
        if (step.tech) btn.title = step.tech; // technical term, still there for anyone curious -- just a tooltip, not competing with the plain label for space
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            panel.querySelectorAll(".explain-step-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            drawFullStep(container, t, step);
        });
        panel.appendChild(btn);
    });

    const closeBtn = document.createElement("button");
    closeBtn.className = "explain-close-btn";
    closeBtn.textContent = "\u2715"; // ×
    closeBtn.title = "Close and resume";
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeExplainer(sampleId, panel);
    });
    panel.appendChild(closeBtn);

    // show the first step (raw) immediately on open
    panel.querySelector(".explain-step-btn").classList.add("active");
    drawFullStep(container, t, allSteps[0]);
}

// Plots ONE step's data across the ENTIRE recording, statically -- no
// sliding window, no animation. The whole point here is seeing the shape
// of a transformation start to finish, which a windowed sweep would hide.
function drawFullStep(container, t, step) {
    const data = step.data;
    const yMin = Math.min(...data) - 0.1;
    const yMax = Math.max(...data) + 0.1;

    const traces = [{
        x: t, y: data, mode: "lines",
        line: { color: TRACE_COLORS[colorIndex], width: 1.5, shape: "spline" },
        hoverinfo: "skip",
    }];

    if (step.peaks) {
        traces.push({
            x: step.peaks.map(idx => t[idx]),
            y: step.peaks.map(idx => data[idx]),
            mode: "markers",
            marker: { color: "#ff4d4d", size: 7, line: { color: "#fff", width: 1 } },
            hoverinfo: "skip",
        });
    }

    const layout = buildChartLayout(yMin, yMax, [t[0], t[t.length - 1]]); // FULL range, not a sliding window
    Plotly.newPlot(container, traces, layout, { staticPlot: true, responsive: true });
}

function closeExplainer(sampleId, panel) {
    panel.classList.remove("open");

    const card = document.querySelector(`.card[data-sample-id="${sampleId}"]`);
    const stageContent = card && card.querySelector('.stage-content[data-stage="2"]');
    if (stageContent) stageContent.classList.remove("explaining");

    // Re-enter stage 2 cleanly by reusing the EXISTING, already-correct
    // enterStage() flow -- a synthesized click on the stage's own segment
    // button does exactly that, since segment clicks already call
    // enterStage(i). No new coupling into stage_machine.js's closures needed.
    const segment = card && card.querySelector('.segment[data-stage="2"]');
    if (segment) segment.click();
}