// ---------------------------------------------------------------------------
// stage_renderers.js
// Fetches (with caching), builds Plotly layouts, and drives each stage's
// animated reveal via a requestAnimationFrame sweep loop. Registers Stage 0
// (raw signal), Stage 1 (baseline correction), and Stage 2 (peak detection)
// with the generic engine from stage_engine.js -- see registerStage() calls
// at the bottom of each section.
//
// Depends on stage_engine.js (registerStage, invalidateFromStage),
// baseline_correction_filter.js (removeBaselineWander),
// pan_tompkins_filter.js (panTompkinsDetectPeaks), and rail_controls.js
// (THEMES, invertedSamples, getStageDuration) -- all four must be loaded
// before this file.
// ---------------------------------------------------------------------------

const sweepAnimationHandles = new Map(); // sampleId -> requestAnimationFrame handle, for cancellation

// Tracks the CURRENTLY ACTIVE sweep for whichever stage is being drawn --
// purely LIVE state, reset fresh every enterStage() call. This is deliberately
// NOT cross-visit persistence: scrolling away and back still restarts at
// zero regardless of this map. It exists only so a genuine, deliberate,
// WITHIN-view pause (center tap, handled in stage_machine.js) can resume
// from exactly where it stopped, the same way a real pause button would.
const activeSweepControl = new Map(); // sampleId -> { totalDurationMs, drawFn, lastElapsedMs }

// Caches the raw fetch result per sample, so toggling color/invert/speed --
// none of which actually need fresh data from the server -- can redraw
// instantly instead of re-fetching every time.
const fetchedSignalCache = new Map(); // sampleId -> { signal, fs }

// Shared by every stage that needs the raw signal -- cache-aware, so only
// the FIRST stage to touch a given sample ever actually hits the network.
async function fetchSignal(sampleId) {
    if (fetchedSignalCache.has(sampleId)) {
        return fetchedSignalCache.get(sampleId);
    }
    try {
        const res = await fetch(`/shorts/api/sample/${sampleId}/raw`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const payload = await res.json();
        const result = { signal: payload.signal, fs: payload.fs };
        fetchedSignalCache.set(sampleId, result);

        // populated HERE, centrally, regardless of which stage triggers the
        // first fetch -- needed so "Real" speed mode works correctly even
        // if a user reaches a later stage before ever viewing Stage 0
        recordingDurationMs.set(sampleId, Math.round((result.signal.length / result.fs) * 1000));

        return result;
    } catch (err) {
        console.error(`Failed to load raw signal for ${sampleId}:`, err);
        return null;
    }
}

// Shared by every stage renderer that plots the ECG against time -- keeps
// axis styling consistent as more stages get built, and means a future
// styling tweak only needs to happen in one place. Y-axis range is meant to
// be STATIC for the life of one sweep (cheap, computed once); X-axis range
// is expected to change every frame during a sliding-window sweep, which
// does cost a bit of per-frame tick recomputation -- a deliberate trade-off
// for legible units over strict monitor-authenticity (real monitors mostly
// skip numeric axes in favor of a calibration pulse + known sweep speed).
const AXIS_LABEL_STYLE = { size: 9, color: "#747d8c", family: "IBM Plex Mono, monospace" };

// Picks a "nice," round grid step (0.1, 0.2, 0.5, 1, 2, 5, ...times a power
// of ten) close to `range / targetTicks` -- the same kind of rounding real
// chart libraries use for tick spacing. This is what turns the grid from
// decoration into something a non-clinician can actually read: "count the
// boxes" only works if a box represents a clean, memorable amount.
function niceStep(range, targetTicks = 5) {
    if (range <= 0) return 1;
    const rawStep = range / targetTicks;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const residual = rawStep / magnitude;
    let niceResidual;
    if (residual < 1.5) niceResidual = 1;
    else if (residual < 3) niceResidual = 2;
    else if (residual < 7) niceResidual = 5;
    else niceResidual = 10;
    return niceResidual * magnitude;
}

function buildChartLayout(yMin, yMax, initialXRange) {
    const yStep = niceStep(yMax - yMin, 4); // aim for ~4-5 horizontal lines
    const xStep = 1; // 1 second per vertical line -- simple, round, legible across the 5s window

    // Read straight from CSS -- these two colors used to be hardcoded here,
    // duplicating what should be a single source of truth. Plotly can't
    // reference a CSS variable directly (it only accepts a literal string
    // at render time), so this is the one necessary hop: read the CSS
    // variable's live value, then hand that literal string to Plotly.
    const rootStyle = getComputedStyle(document.documentElement);
    const gridColor = rootStyle.getPropertyValue("--grid-color").trim();
    const zeroLineColor = rootStyle.getPropertyValue("--zero-line-color").trim();

    return {
        margin: { t: 10, r: 10, b: 30, l: 40 },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        showlegend: false,
        xaxis: {
            visible: true,
            title: { text: "Time (s)", font: AXIS_LABEL_STYLE },
            tickfont: AXIS_LABEL_STYLE,
            showgrid: true,
            gridcolor: gridColor,
            gridwidth: 1,
            dtick: xStep,
            zeroline: false,
            ticks: "outside",
            tickcolor: "#30363d",
            range: initialXRange,
        },
        yaxis: {
            visible: true,
            title: { text: "mV", font: AXIS_LABEL_STYLE },
            tickfont: AXIS_LABEL_STYLE,
            showgrid: true,
            gridcolor: gridColor,
            gridwidth: 1,
            dtick: yStep,
            zeroline: true,
            zerolinecolor: zeroLineColor,
            zerolinewidth: 1,
            ticks: "outside",
            tickcolor: "#30363d",
            range: [yMin, yMax],
        },
        annotations: [{
            xref: "paper", yref: "paper",
            x: 0.02, y: 0.96,
            xanchor: "left", yanchor: "top",
            text: `□ = ${xStep}s / ${yStep}mV`,
            showarrow: false,
            font: { size: 9, color: "#747d8c", family: "IBM Plex Mono, monospace" },
        }],
    };
}

// startElapsedMs defaults to 0 (a fresh entry); a non-zero value is only
// ever passed when resuming from a live pause (see stage_machine.js's
// togglePause()).
function startSweepLoop(sampleId, totalDurationMs, drawFn, startElapsedMs = 0) {
    activeSweepControl.set(sampleId, { totalDurationMs, drawFn, lastElapsedMs: startElapsedMs });

    if (startElapsedMs >= totalDurationMs) {
        drawFn(totalDurationMs);
        return;
    }

    const startTime = performance.now() - startElapsedMs;

    function tick(now) {
        const elapsed = Math.min(now - startTime, totalDurationMs);
        const control = activeSweepControl.get(sampleId);
        if (control) control.lastElapsedMs = elapsed;
        drawFn(elapsed);

        if (elapsed < totalDurationMs) {
            sweepAnimationHandles.set(sampleId, requestAnimationFrame(tick));
        } else {
            sweepAnimationHandles.delete(sampleId);
        }
    }

    sweepAnimationHandles.set(sampleId, requestAnimationFrame(tick));
}

function cancelSweepAnimation(sampleId) {
    if (sweepAnimationHandles.has(sampleId)) {
        cancelAnimationFrame(sweepAnimationHandles.get(sampleId));
        sweepAnimationHandles.delete(sampleId);
    }
}

// Shared by any sweep-style renderer -- downsamples a window's worth of
// points to a fixed maximum via a grid ANCHORED TO ABSOLUTE SAMPLE POSITION
// (not counted fresh from wherever the window currently starts). Anchoring
// to absolute position is what keeps a sharp peak from flickering as the
// window slides: the same underlying samples get chosen consistently every
// frame, only the window's edges move.
function makeSampleAligner(t, y, stride) {
    return function sampleAligned(startIdx, endIdx) {
        const dsX = [], dsY = [];
        const firstAligned = Math.ceil(startIdx / stride) * stride;
        for (let absIdx = firstAligned; absIdx < endIdx; absIdx += stride) {
            dsX.push(t[absIdx]);
            dsY.push(y[absIdx]);
        }
        const lastAbs = endIdx - 1;
        if (dsX.length === 0 || dsX[dsX.length - 1] !== t[lastAbs]) {
            dsX.push(t[lastAbs]);
            dsY.push(y[lastAbs]);
        }
        return { x: dsX, y: dsY };
    };
}

// Shared by any stage that's "just a waveform sweep" -- Stage 0's raw
// signal, Stage 1's corrected signal, and any future simple waveform stage.
// Extracted here specifically because Stage 0 and Stage 1 would otherwise
// be near-identical ~40-line renderers differing only in which array gets
// plotted -- exactly the kind of duplication worth catching on the SECOND
// occurrence, not after a third or fourth stage copies it again. Stage 2
// still writes its own renderer, since it needs an extra peak-marker trace,
// but reuses the same window/downsample helpers below either way.
function renderWaveformSweep(container, sampleId, stageIdx, t, y, fs) {
    const yMin = Math.min(...y) - 0.1;
    const yMax = Math.max(...y) + 0.1;

    const ECG_WINDOW_SECONDS = 5;
    const windowSamples = Math.round(ECG_WINDOW_SECONDS * fs);

    const trace = {
        x: [t[0]], y: [y[0]], mode: "lines",
        line: { color: THEMES[themeIndex].traceColor, width: 2, shape: "spline" },
        hoverinfo: "skip",
    };

    const layout = buildChartLayout(yMin, yMax, [t[0], t[0] + ECG_WINDOW_SECONDS]);
    Plotly.newPlot(container, [trace], layout, { staticPlot: true, responsive: true });

    const MAX_POINTS_PER_UPDATE = 200;
    const DOWNSAMPLE_STRIDE = Math.max(1, Math.ceil(windowSamples / MAX_POINTS_PER_UPDATE));
    const sampleAligned = makeSampleAligner(t, y, DOWNSAMPLE_STRIDE);

    const totalDurationMs = getStageDuration(stageIdx, sampleId);

    function drawAtElapsed(elapsed) {
        const progress = Math.min(1, elapsed / totalDurationMs);
        const currentIndex = Math.max(2, Math.round(progress * (t.length - 1)) + 1);

        const startIdx = Math.max(0, currentIndex - windowSamples);
        const rangeStart = startIdx === 0 ? t[0] : t[startIdx];
        const rangeEnd = startIdx === 0 ? t[0] + ECG_WINDOW_SECONDS : t[currentIndex - 1];

        const { x: dsX, y: dsY } = sampleAligned(startIdx, currentIndex);

        Plotly.update(container,
            { x: [dsX], y: [dsY] },
            { "xaxis.range": [rangeStart, rangeEnd] }
        );
    }

    startSweepLoop(sampleId, totalDurationMs, drawAtElapsed);
}

// ---------------------------------------------------------------------------
// STAGE 0 -- Raw signal.
//
// Processor: takes the raw {signal, fs} fetch, applies per-sample inversion,
// builds the time axis. Very little real "processing" happens here -- this
// is the true entry point, not a DSP step itself.
// ---------------------------------------------------------------------------
function rawSignalProcessor(input, sampleId) {
    const rawY = input.signal;
    const y = invertedSamples.has(sampleId) ? rawY.map(v => -v) : rawY;
    const fs = input.fs;
    const t = y.map((_, i) => i / fs);
    return { t, y, fs };
}

function rawSignalRenderer(container, sampleId, output) {
    renderWaveformSweep(container, sampleId, 0, output.t, output.y, output.fs);
}

registerStage(0, {
    // no dependsOn -- Stage 0 IS the raw entry point, starts fresh from the fetch
    processor: rawSignalProcessor,
    renderer: rawSignalRenderer,
});

// ---------------------------------------------------------------------------
// STAGE 1 -- Corrected signal (baseline wander removal).
//
// Processor: takes Stage 0's output {t, y, fs} and removes baseline wander
// via a high-pass filter (baseline_correction_filter.js). This is the FIRST
// real DSP step in the chain -- Stage 0 is just the entry point, Stage 1 is
// where actual signal processing begins.
// ---------------------------------------------------------------------------
function baselineCorrectionProcessor(input, sampleId) {
    const { t, y, fs } = input; // Stage 0's output, resolved by the engine
    const corrected = removeBaselineWander(y, fs);
    return { t, y: corrected, fs };
}

function baselineCorrectionRenderer(container, sampleId, output) {
    renderWaveformSweep(container, sampleId, 1, output.t, output.y, output.fs);
}

registerStage(1, {
    dependsOn: 0, // Stage 0's {t, y, fs} raw waveform
    processor: baselineCorrectionProcessor,
    renderer: baselineCorrectionRenderer,
});

// ---------------------------------------------------------------------------
// STAGE 2 -- Peak detection.
//
// Processor: takes STAGE 1's output (not Stage 0's directly anymore) and
// runs the Pan-Tompkins filter once, eagerly. This dependsOn change is the
// actual payoff of the engine: updating ONE line here is all it took to
// wire Stage 2 onto the newly-real Stage 1, with zero changes to Stage 2's
// own processor/renderer code below.
// ---------------------------------------------------------------------------
function peakDetectionProcessor(input, sampleId) {
    const { t, y, fs } = input; // previous stage's output, resolved by the engine
    const { peakIndices, steps } = panTompkinsDetectPeaks(y, fs);
    return { t, y, fs, peakIndices, steps };
}

function peakDetectionRenderer(container, sampleId, output) {
    const { t, y, fs, peakIndices } = output;
    const yMin = Math.min(...y) - 0.1;
    const yMax = Math.max(...y) + 0.1;

    const ECG_WINDOW_SECONDS = 5;
    const windowSamples = Math.round(ECG_WINDOW_SECONDS * fs);

    const lineTrace = {
        x: [t[0]], y: [y[0]], mode: "lines",
        line: { color: THEMES[themeIndex].traceColor, width: 2, shape: "spline" },
        hoverinfo: "skip",
    };
    const peakTrace = {
        x: [], y: [], mode: "markers",
        marker: { color: "#ff4d4d", size: 9, line: { color: "#fff", width: 1 } },
        hoverinfo: "skip",
    };

    const layout = buildChartLayout(yMin, yMax, [t[0], t[0] + ECG_WINDOW_SECONDS]);
    Plotly.newPlot(container, [lineTrace, peakTrace], layout, { staticPlot: true, responsive: true });

    // Optional hook -- only fires if algorithm_explainer.js happens to be
    // loaded. This file has no hard dependency on that file at all; it
    // reads this stage's output straight from the engine's cache
    // (getCachedStageOutput(sampleId, 2)) rather than a separate cache.
    if (typeof attachAlgorithmExplainer === "function") {
        attachAlgorithmExplainer(container, sampleId);
    }

    const MAX_POINTS_PER_UPDATE = 200;
    const DOWNSAMPLE_STRIDE = Math.max(1, Math.ceil(windowSamples / MAX_POINTS_PER_UPDATE));
    const sampleAligned = makeSampleAligner(t, y, DOWNSAMPLE_STRIDE);

    const totalDurationMs = getStageDuration(2, sampleId);

    function drawAtElapsed(elapsed) {
        const progress = Math.min(1, elapsed / totalDurationMs);
        const currentIndex = Math.max(2, Math.round(progress * (t.length - 1)) + 1);
        const startIdx = Math.max(0, currentIndex - windowSamples);
        const rangeStart = startIdx === 0 ? t[0] : t[startIdx];
        const rangeEnd = startIdx === 0 ? t[0] + ECG_WINDOW_SECONDS : t[currentIndex - 1];

        const { x: dsX, y: dsY } = sampleAligned(startIdx, currentIndex);

        // RENDERER only: peaks were already fully computed by the processor.
        // This just filters which already-known peaks fall inside the
        // current window -- no detection work happens per frame.
        const visiblePeaks = peakIndices.filter(idx => idx >= startIdx && idx < currentIndex);

        Plotly.update(container,
            {
                x: [dsX, visiblePeaks.map(idx => t[idx])],
                y: [dsY, visiblePeaks.map(idx => y[idx])],
            },
            { "xaxis.range": [rangeStart, rangeEnd] }
        );
    }

    startSweepLoop(sampleId, totalDurationMs, drawAtElapsed);
}

registerStage(2, {
    // Was dependsOn: 0 -- now correctly points at Stage 1's cleaned output
    // instead of Stage 0's raw one. This one-line change is the entire
    // retrofit Stage 2 needed; its processor and renderer are untouched.
    dependsOn: 1,
    processor: peakDetectionProcessor,
    renderer: peakDetectionRenderer,
});

// ---------------------------------------------------------------------------
// STAGE 3 -- HRV metrics (RR intervals, SDNN/RMSSD/pNN50, Poincaré SD1/SD2).
//
// Processor: takes Stage 2's peak indices, runs the pure HRV math from
// hrv_metrics_filter.js. Can genuinely fail to produce a meaningful result
// (too few beats detected) -- that's signaled by returning null from the
// FILTER, then explicitly re-wrapped here as {insufficient: true} so the
// RENDERER can show an honest "not enough data" state instead of either
// crashing or rendering a blank chart with no explanation.
//
// Renderer: NOT a sweep -- this is a scatter plot (Poincaré), a genuinely
// different chart shape than Stages 0-2's sweeping line. The engine never
// required renderers to be sweeps; this is the proof of that.
// ---------------------------------------------------------------------------
function hrvMetricsProcessor(input, sampleId) {
    const { peakIndices, fs } = input; // Stage 2's output
    const metrics = computeHRVMetrics(peakIndices, fs);
    if (!metrics) {
        return { insufficient: true, peakCount: peakIndices.length };
    }
    return { ...metrics, insufficient: false };
}

function buildPoincareLayout(axisMax) {
    const rootStyle = getComputedStyle(document.documentElement);
    const gridColor = rootStyle.getPropertyValue("--grid-color").trim();

    return {
        margin: { t: 10, r: 10, b: 40, l: 50 },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        showlegend: false,
        xaxis: {
            visible: true,
            title: { text: "RR[n] (ms)", font: AXIS_LABEL_STYLE },
            tickfont: AXIS_LABEL_STYLE,
            showgrid: true,
            gridcolor: gridColor,
            gridwidth: 1,
            zeroline: false,
            ticks: "outside",
            tickcolor: "#30363d",
            range: [0, axisMax],
        },
        yaxis: {
            visible: true,
            title: { text: "RR[n+1] (ms)", font: AXIS_LABEL_STYLE },
            tickfont: AXIS_LABEL_STYLE,
            showgrid: true,
            gridcolor: gridColor,
            gridwidth: 1,
            zeroline: false,
            ticks: "outside",
            tickcolor: "#30363d",
            range: [0, axisMax],
            scaleanchor: "x", // keeps the plot visually square -- SD1/SD2's
                                // ellipse shape only reads correctly if one
                                // ms on x equals one ms on y
        },
    };
}

function hrvMetricsRenderer(container, sampleId, output) {
    if (output.insufficient) {
        // Reuses .early-exit-label, defined long ago for exactly this kind
        // of honest "couldn't complete" state, never actually wired up
        // until now.
        container.innerHTML = `
            <div class="plain-content-overlay">
                <div class="early-exit-label">
                    Only ${output.peakCount} heartbeat${output.peakCount === 1 ? "" : "s"} detected --
                    not enough for reliable rhythm analysis.
                </div>
            </div>
        `;
        return;
    }

    const { rrN, rrN1, meanHR, sdnn, rmssd, pnn50, sd1, sd2 } = output;

    const axisMax = Math.max(...rrN, ...rrN1) * 1.15; // headroom so points near the edge aren't clipped

    const identityLine = {
        x: [0, axisMax], y: [0, axisMax], mode: "lines",
        line: { color: "rgba(116, 125, 140, 0.5)", width: 1, dash: "dash" },
        hoverinfo: "skip", showlegend: false,
    };
    const pointsTrace = {
        x: [], y: [], mode: "markers",
        marker: { color: THEMES[themeIndex].traceColor, size: 8, opacity: 0.75 },
        hoverinfo: "skip", showlegend: false,
    };

    const layout = buildPoincareLayout(axisMax);
    Plotly.newPlot(container, [identityLine, pointsTrace], layout, { staticPlot: true, responsive: true });

    // Small numeric readout, tallied alongside the scatter -- the discrete-
    // point equivalent of the sweep views' axis calibration label.
    const readout = document.createElement("div");
    readout.className = "hrv-readout";
    readout.innerHTML = `
        <span>HR ${meanHR.toFixed(0)} bpm</span>
        <span>SDNN ${sdnn.toFixed(0)}ms</span>
        <span>RMSSD ${rmssd.toFixed(0)}ms</span>
        <span>pNN50 ${pnn50.toFixed(0)}%</span>
        <span>SD1 ${sd1.toFixed(0)}ms</span>
        <span>SD2 ${sd2.toFixed(0)}ms</span>
    `;
    container.appendChild(readout);

    // Points reveal progressively over the stage duration, same "watch it
    // build" feel as the sweeping stages -- just revealing discrete points
    // instead of sliding a continuous window. No downsampling needed here;
    // there are far fewer peaks than raw samples.
    const totalDurationMs = getStageDuration(3, sampleId);

    function drawAtElapsed(elapsed) {
        const progress = Math.min(1, elapsed / totalDurationMs);
        const visibleCount = Math.max(1, Math.round(progress * rrN.length));

        Plotly.update(container,
            { x: [null, rrN.slice(0, visibleCount)], y: [null, rrN1.slice(0, visibleCount)] },
            {}
        );
    }

    startSweepLoop(sampleId, totalDurationMs, drawAtElapsed);
}

registerStage(3, {
    dependsOn: 2, // Stage 2's peak indices
    processor: hrvMetricsProcessor,
    renderer: hrvMetricsRenderer,
});

// ---------------------------------------------------------------------------
// STAGE 4 -- Verdict.
//
// Processor: mostly a pass-through of Stage 3's metrics, with the sample's
// TRUE label attached -- looked up from sampleLabels (populated in
// shorts_feed.js when each card is built from real backend data), not by
// reading the DOM from inside a processor, which would mix concerns and be
// fragile if the card element ever changed shape.
//
// Renderer: not a sweep, not a scatter -- a single categorical reveal. The
// payoff the whole feed was built around.
// ---------------------------------------------------------------------------
const VERDICT_DISPLAY = {
    N: { name: "Normal", color: "var(--accent)" },
    A: { name: "Atrial Fibrillation", color: "var(--danger)" },
    O: { name: "Other", color: "var(--warn)" },
    "~": { name: "Noisy", color: "var(--text-dim)" },
};

function verdictProcessor(input, sampleId) {
    const trueLabel = typeof sampleLabels !== "undefined" ? sampleLabels.get(sampleId) : undefined;
    return { ...input, trueLabel };
}

function verdictRenderer(container, sampleId, output) {
    const display = VERDICT_DISPLAY[output.trueLabel] || { name: "Unknown", color: "var(--text-dim)" };

    const supportingLine = output.insufficient
        ? ""
        : `<div class="verdict-support">Mean HR ${output.meanHR.toFixed(0)} bpm</div>`;

    container.innerHTML = `
        <div class="plain-content-overlay">
            <div class="verdict-badge" style="border-color:${display.color}; color:${display.color};">
                ${display.name}
            </div>
            ${supportingLine}
        </div>
    `;

    // "slam in" -- add the reveal class one frame after insertion, so the
    // browser registers the initial (scaled-down, transparent) state before
    // transitioning, rather than skipping straight to the end state
    const badge = container.querySelector(".verdict-badge");
    requestAnimationFrame(() => badge.classList.add("revealed"));
}

registerStage(4, {
    dependsOn: 3, // Stage 3's HRV metrics, passed through plus the true label
    processor: verdictProcessor,
    renderer: verdictRenderer,
});