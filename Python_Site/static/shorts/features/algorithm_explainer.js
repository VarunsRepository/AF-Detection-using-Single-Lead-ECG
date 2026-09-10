// ---------------------------------------------------------------------------
// algorithm_explainer.js
// Opt-in "how does this actually work" scrub bar. Lets someone step through
// a stage's own intermediate results (e.g. Pan-Tompkins' bandpass ->
// derivative -> squared -> integrated -> peaks) as full, static plots of the
// WHOLE recording -- not the windowed sweep the normal view uses, since the
// point here is seeing the shape of the transformation end to end, not
// watching a monitor-style animation.
//
// GENERIC across any stage now, not hardcoded to Stage 2. Whether a stage
// gets this explainer at all is decided purely by its OUTPUT SHAPE: if the
// stage's processor returns a `steps` array, it gets the explainer,
// automatically, via the hook centralized in stage_engine.js's
// renderStageChart -- no per-stage flag to declare, no per-renderer hook
// call to remember. An earlier version hardcoded stage index "2" in three
// separate places throughout this file; a future Stage 3/5 explainer would
// have needed this whole file duplicated with different numbers swapped
// in. Every function here now takes stageIdx as a real parameter instead.
//
// Depends on stage_engine.js (getStageLabel), stage_renderers.js
// (buildChartLayout, cancelSweepAnimation), and stage_machine.js
// (clearAutoAdvance) -- all three must be loaded before this file.
// Deliberately DECOUPLED from stage_renderers.js though: the engine only
// calls attachAlgorithmExplainer() if it happens to exist (a `typeof`
// check), so this whole feature can be added or removed without
// stage_engine.js needing to change at all.
// ---------------------------------------------------------------------------

const explainerBuilt = new Set(); // "sampleId-stageIdx" keys that already have their toggle/panel wired, so re-entering a stage doesn't duplicate DOM

// Called by the engine after EVERY stage renders, for every stage --
// output is whatever that stage's processor produced. Self-gating: if
// there's no `steps` array, this stage simply isn't explainer-worthy, and
// nothing gets attached. No separate boolean flag to declare and forget.
function attachAlgorithmExplainer(container, sampleId, stageIdx, output) {
    if (!output || !output.steps) return;

    const key = `${sampleId}-${stageIdx}`;
    const stageContent = container.closest(".stage-content");
    if (!stageContent || explainerBuilt.has(key)) return;
    explainerBuilt.add(key);

    const toggle = document.createElement("button");
    toggle.className = "explain-toggle";
    toggle.textContent = "?";
    toggle.title = "What does this mean?";

    const simplePanel = document.createElement("div");
    simplePanel.className = "explain-simple-panel";

    const panel = document.createElement("div");
    panel.className = "explain-panel";

    stageContent.appendChild(toggle);
    stageContent.appendChild(simplePanel);
    stageContent.appendChild(panel);

    toggle.addEventListener("click", (e) => {
        e.stopPropagation(); // don't let this also trigger the stage tap-zones underneath
        openSimpleExplainer(sampleId, container, simplePanel, panel, stageIdx, output);
    });
}

// The plain-English layer: one sentence, a "see how it works" button that
// drops into the technical panel, and a close button. The sentence is
// NOT a separate hardcoded string per stage -- it reuses label.blurb, the
// EXACT same text onboarding.js already shows for this stage. One source
// of truth, two consumers; they can't drift apart the way a duplicated
// string could.
function openSimpleExplainer(sampleId, container, simplePanel, panel, stageIdx, output) {
    cancelSweepAnimation(sampleId);
    clearAutoAdvance(sampleId);

    const label = typeof getStageLabel === "function" ? getStageLabel(stageIdx) : null;
    const blurb = (label && label.blurb) || "Here's what happens in this step.";

    simplePanel.innerHTML = `
        <p class="explain-simple-text">${blurb}</p>
        <div class="explain-simple-actions">
            <button class="explain-simple-deeper">See how it works &rarr;</button>
            <button class="explain-close-btn" title="Close and resume">&#10005;</button>
        </div>
    `;
    simplePanel.classList.add("open");

    simplePanel.querySelector(".explain-simple-deeper").addEventListener("click", (e) => {
        e.stopPropagation();
        simplePanel.classList.remove("open"); // hand off to the technical panel -- only one shown at a time
        openExplainer(sampleId, container, panel, stageIdx, output);
    });
    simplePanel.querySelector(".explain-close-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        closeExplainer(sampleId, simplePanel, stageIdx);
    });
}

function openExplainer(sampleId, container, panel, stageIdx, output) {
    cancelSweepAnimation(sampleId);
    clearAutoAdvance(sampleId);

    // Some steps (e.g. after a squaring operation) have a wildly different
    // amplitude scale than the original signal -- the normal sweep view's
    // small fixed box doesn't give that enough room to read comfortably.
    // This is a static, full-recording inspection view anyway, so it can
    // afford to take up much more of the screen while open.
    const stageContent = container.closest(".stage-content");
    if (stageContent) stageContent.classList.add("explaining");

    const { steps, t, y } = output;

    // The synthetic "final result" step (e.g. Peak Detection's "Heartbeats
    // Found") only makes sense for stages that actually produce indices to
    // mark -- conditional on output.peakIndices existing, not assumed.
    // A future stage with `steps` but no comparable index list (e.g. a
    // wavelet decomposition) simply won't get this extra step appended.
    const allSteps = output.peakIndices
        ? [...steps, { label: "Result", tech: "Detected Points", data: y, peaks: output.peakIndices }]
        : steps;

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
        closeExplainer(sampleId, panel, stageIdx);
    });
    panel.appendChild(closeBtn);

    // show the first step immediately on open
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
        line: { color: THEMES[themeIndex].traceColor, width: 1.5, shape: "spline" },
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

function closeExplainer(sampleId, panel, stageIdx) {
    panel.classList.remove("open");

    const card = document.querySelector(`.card[data-sample-id="${sampleId}"]`);
    const stageContent = card && card.querySelector(`.stage-content[data-stage="${stageIdx}"]`);
    if (stageContent) stageContent.classList.remove("explaining");

    // Re-enter this stage cleanly by reusing the EXISTING, already-correct
    // enterStage() flow -- a synthesized click on the stage's own segment
    // button does exactly that, since segment clicks already call
    // enterStage(i). No new coupling into stage_machine.js's closures needed.
    const segment = card && card.querySelector(`.segment[data-stage="${stageIdx}"]`);
    if (segment) segment.click();
}