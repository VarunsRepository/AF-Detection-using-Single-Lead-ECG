// ---------------------------------------------------------------------------
// stage_renderers.js
// Everything that actually draws a stage's chart. Fetches (with caching),
// builds Plotly layouts, and drives each stage's animated reveal via a
// requestAnimationFrame sweep loop. Depends on stage_filters.js (for
// panTompkinsDetectPeaks) and rail_controls.js (for TRACE_COLORS,
// invertedSamples, getStageDuration) -- both must be loaded before this file.
// ---------------------------------------------------------------------------

const renderedCharts = new Set(); // "sampleId-stageIdx" keys already drawn, so we never re-animate a chart twice
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

// Populated by drawPeakDetectionStage -- holds each sample's full set of
// Pan-Tompkins intermediate results (Raw, Bandpass, Derivative, Squared,
// Integrated) plus its peak indices, t-axis, and fs. Exists purely so an
// optional "explain how this works" view can plot any step on demand
// without recomputing the filter. Safe to ignore if no such view is loaded.
const stageStepsCache = new Map(); // sampleId -> { steps, peakIndices, t, y, fs }

// Shared by every stage that needs the raw signal (stage 0's sweep, stage 2's
// peak detection, and future stages too) -- cache-aware, so only the FIRST
// stage to touch a given sample ever actually hits the network.
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
        // if a user reaches Stage 2 before ever viewing Stage 0 in a session
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

    return {
        margin: { t: 10, r: 10, b: 30, l: 40 },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        showlegend: false,
        xaxis: {
            visible: true,
            title: { text: "Time (s)", font: AXIS_LABEL_STYLE },
            tickfont: AXIS_LABEL_STYLE,
            showgrid: true, // REAL gridlines now, calibrated to actual seconds --
                              // not the old decorative CSS pattern, which never
                              // corresponded to genuine time/amplitude values
            gridcolor: "rgba(116, 125, 140, 0.18)",
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
            gridcolor: "rgba(116, 125, 140, 0.18)",
            gridwidth: 1,
            dtick: yStep,
            zeroline: true, // horizontal reference line at 0 mV -- shows which
                              // way a beat deflects relative to baseline, and
                              // matters more now that Invert can flip polarity
            zerolinecolor: "rgba(116, 125, 140, 0.4)", // brighter than the grid -- 0 mV still reads as a distinct reference, not just another box edge
            zerolinewidth: 1,
            ticks: "outside",
            tickcolor: "#30363d",
            range: [yMin, yMax], // static for the whole sweep -- cheap, no per-frame recompute
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
        if (control) control.lastElapsedMs = elapsed; // kept current every frame, so a pause at ANY moment has an accurate value
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

// ---------------------------------------------------------------------------
// Stage 0 renderer: fetches the REAL raw signal for this sample from the
// pipeline, then draws it as an animated left-to-right sweep.
// ---------------------------------------------------------------------------
async function drawRawSignalStage(container, sampleId) {
    const key = `${sampleId}-0`;
    if (renderedCharts.has(key)) return; // already drawn once, don't re-animate
    renderedCharts.add(key);

    cancelSweepAnimation(sampleId); // guard against a leftover loop from a rapid toggle

    container.classList.add("loading");

    const fetched = await fetchSignal(sampleId);
    if (!fetched) {
        renderedCharts.delete(key); // allow a retry if the user revisits this card
        container.classList.remove("loading");
        return;
    }
    const { signal, fs } = fetched;

    // per-sample inversion, applied here so every downstream calculation
    // (min/max, the sweep itself) already sees the corrected polarity
    const rawY = signal;
    const y = invertedSamples.has(sampleId) ? rawY.map(v => -v) : rawY;
    const t = y.map((_, i) => i / fs);
    const yMin = Math.min(...y) - 0.1;
    const yMax = Math.max(...y) + 0.1;

    // Fixed-width scrolling window, in real ECG seconds -- NOT the whole
    // recording. Solves the "crowding" problem: a 30-90s recording no longer
    // ends up with every beat overlapping on screen at once. A window this
    // wide typically shows 4-6 beats at a time, similar to a bedside monitor.
    const ECG_WINDOW_SECONDS = 5;
    const windowSamples = Math.round(ECG_WINDOW_SECONDS * fs);

    const trace = {
        x: [t[0]],
        y: [y[0]],
        mode: "lines",
        line: { color: TRACE_COLORS[colorIndex], width: 2, shape: "spline" },
        hoverinfo: "skip",
    };

    const layout = buildChartLayout(yMin, yMax, [t[0], t[0] + ECG_WINDOW_SECONDS]);

    Plotly.newPlot(container, [trace], layout, { staticPlot: true, responsive: true });
    container.classList.remove("loading");

    // Downsamples a window's worth of points down to a fixed maximum, via
    // simple stride sampling. A line only needs a few hundred points to
    // look smooth -- capping this keeps every update cheap regardless of
    // how many raw samples fall inside the current window.
    const MAX_POINTS_PER_UPDATE = 200;

    // FIXED stride, computed ONCE from the steady-state window size -- not
    // recomputed from the current slice length every tick. This matters:
    // if the stride were recalculated per-tick, tiny rounding fluctuations
    // in the slice length could occasionally flip it between two adjacent
    // integer values, which would itself reshuffle which points get kept.
    const DOWNSAMPLE_STRIDE = Math.max(1, Math.ceil(windowSamples / MAX_POINTS_PER_UPDATE));

    // Picks points using a grid ANCHORED TO ABSOLUTE SAMPLE POSITION in the
    // recording (index % stride === 0), not counted fresh from wherever the
    // window currently starts. This is the actual fix for the peak-jumping
    // artifact: with the old relative-to-window-start counting, the set of
    // kept points subtly shifted every frame as the window slid, so a sharp
    // peak would sometimes land exactly on a kept sample and sometimes fall
    // into a gap between them -- rendering its height as flickering between
    // frames. Anchoring to absolute position means the same underlying
    // samples are chosen consistently; only the window's edges move.
    function sampleAligned(startIdx, endIdx, stride) {
        const dsX = [], dsY = [];
        const firstAligned = Math.ceil(startIdx / stride) * stride;
        for (let absIdx = firstAligned; absIdx < endIdx; absIdx += stride) {
            dsX.push(t[absIdx]);
            dsY.push(y[absIdx]);
        }
        // always include the true leading-edge sample, so the sweep's tip
        // never visibly lags behind where the data actually is
        const lastAbs = endIdx - 1;
        if (dsX.length === 0 || dsX[dsX.length - 1] !== t[lastAbs]) {
            dsX.push(t[lastAbs]);
            dsY.push(y[lastAbs]);
        }
        return { x: dsX, y: dsY };
    }

    // ------------------------------------------------------------------
    // requestAnimationFrame-driven sweep: updates on every real screen
    // refresh (~60fps) instead of a small fixed number of discrete jumps.
    // ------------------------------------------------------------------
    const totalDurationMs = getStageDuration(0, sampleId);

    function drawAtElapsed(elapsed) {
        const progress = Math.min(1, elapsed / totalDurationMs);
        const currentIndex = Math.max(2, Math.round(progress * (t.length - 1)) + 1);

        const startIdx = Math.max(0, currentIndex - windowSamples);
        const rangeStart = startIdx === 0 ? t[0] : t[startIdx];
        const rangeEnd = startIdx === 0 ? t[0] + ECG_WINDOW_SECONDS : t[currentIndex - 1];

        const { x: dsX, y: dsY } = sampleAligned(startIdx, currentIndex, DOWNSAMPLE_STRIDE);

        Plotly.update(container,
            { x: [dsX], y: [dsY] },
            { "xaxis.range": [rangeStart, rangeEnd] } // dot-path patch -- only the range changes; y-axis is static and title/tick styling from buildChartLayout() is left untouched
        );
    }

    startSweepLoop(sampleId, totalDurationMs, drawAtElapsed);
}

// ---------------------------------------------------------------------------
// Stage 2 renderer: peak detection. The FILTER (panTompkinsDetectPeaks, in
// stage_filters.js) runs ONCE, eagerly, computing every peak in the whole
// recording up front. This function's own drawAtElapsed only ever decides
// which ALREADY-FOUND peaks fall within the current sweep window -- no
// detection work happens per frame. Same shape as stage 0's sweep,
// deliberately, since that shape is exactly what made pause-free,
// always-fresh restarts trivial there too.
//
// NOTE: runs directly on the RAW signal, not a baseline-corrected one --
// Stage 1 (Corrected) isn't built yet. Pan-Tompkins' own bandpass step
// already does most of that work internally, so this is a reasonable stand-
// in for now, not a hack that will need throwing away once Stage 1 exists.
// ---------------------------------------------------------------------------
async function drawPeakDetectionStage(container, sampleId) {
    const key = `${sampleId}-2`;
    if (renderedCharts.has(key)) return;
    renderedCharts.add(key);

    cancelSweepAnimation(sampleId);
    container.classList.add("loading");

    const fetched = await fetchSignal(sampleId);
    if (!fetched) {
        renderedCharts.delete(key);
        container.classList.remove("loading");
        return;
    }
    const { signal, fs } = fetched;

    const rawY = signal;
    const y = invertedSamples.has(sampleId) ? rawY.map(v => -v) : rawY;
    const t = y.map((_, i) => i / fs);
    const yMin = Math.min(...y) - 0.1;
    const yMax = Math.max(...y) + 0.1;

    // FILTER runs here, once, before any animation starts
    const { peakIndices, steps } = panTompkinsDetectPeaks(y, fs);

    // Cached so an "explain how this works" view (algorithm_explainer.js,
    // if loaded) can plot any intermediate step without recomputing the
    // whole filter. Deliberately NOT required -- stage_renderers.js works
    // fine with no explainer file present at all; see the hook call below.
    stageStepsCache.set(sampleId, { steps, peakIndices, t, y, fs });

    const ECG_WINDOW_SECONDS = 5;
    const windowSamples = Math.round(ECG_WINDOW_SECONDS * fs);

    const lineTrace = {
        x: [t[0]], y: [y[0]], mode: "lines",
        line: { color: TRACE_COLORS[colorIndex], width: 2, shape: "spline" },
        hoverinfo: "skip",
    };
    const peakTrace = {
        x: [], y: [], mode: "markers",
        marker: { color: "#ff4d4d", size: 9, line: { color: "#fff", width: 1 } },
        hoverinfo: "skip",
    };

    const layout = buildChartLayout(yMin, yMax, [t[0], t[0] + ECG_WINDOW_SECONDS]);

    Plotly.newPlot(container, [lineTrace, peakTrace], layout, { staticPlot: true, responsive: true });
    container.classList.remove("loading");

    // Optional hook -- only fires if algorithm_explainer.js happens to be
    // loaded. stage_renderers.js has no hard dependency on that file at all.
    if (typeof attachAlgorithmExplainer === "function") {
        attachAlgorithmExplainer(container, sampleId);
    }

    const MAX_POINTS_PER_UPDATE = 200;
    const DOWNSAMPLE_STRIDE = Math.max(1, Math.ceil(windowSamples / MAX_POINTS_PER_UPDATE));

    function sampleAligned(startIdx, endIdx, stride) {
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
    }

    const totalDurationMs = getStageDuration(2, sampleId);

    function drawAtElapsed(elapsed) {
        const progress = Math.min(1, elapsed / totalDurationMs);
        const currentIndex = Math.max(2, Math.round(progress * (t.length - 1)) + 1);
        const startIdx = Math.max(0, currentIndex - windowSamples);
        const rangeStart = startIdx === 0 ? t[0] : t[startIdx];
        const rangeEnd = startIdx === 0 ? t[0] + ECG_WINDOW_SECONDS : t[currentIndex - 1];

        const { x: dsX, y: dsY } = sampleAligned(startIdx, currentIndex, DOWNSAMPLE_STRIDE);

        // RENDERER only: peaks were already fully computed above. This just
        // filters which already-known peaks fall inside the current window.
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

function renderStageChart(sampleId, stageIdx, container) {
    switch (stageIdx) {
        case 0:
            drawRawSignalStage(container, sampleId);
            break;
        case 2:
            drawPeakDetectionStage(container, sampleId);
            break;
        // case 1, 3, 4 -- corrected signal, metrics, verdict -- still to be built.
        default:
            break;
    }
}