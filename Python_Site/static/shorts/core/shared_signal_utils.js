// ---------------------------------------------------------------------------
// shared_signal_utils.js
// Genuinely generic signal-fetching AND charting/sweep-animation utilities
// -- extracted OUT of journeys/ecg/ecg_stage_blocks.js specifically so they can be reused
// WITHOUT dragging in that file's entire ECG-specific dependency tree
// (Pan-Tompkins, HRV metrics, both algorithm registries) just to get a
// handful of utility functions. Two genuinely different concerns
// (fetching vs. rendering) live in one file here rather than two, since
// both are small and both serve the same "reusable outside the main
// pipeline" purpose -- not worth over-splitting for a demo-support case.
//
// Zero dependency on the stage registry (registerStage/STAGE_DEFINITIONS)
// or any specific stage index -- renderWaveformSweep takes a duration
// directly rather than deriving one internally, precisely so code OUTSIDE
// the main pipeline (a standalone demo, for instance) can reuse the real
// sweep-animation machinery without silently inheriting pacing tuned for
// an unrelated ECG stage.
//
// Depends on rail_controls.js (THEMES, themeIndex)
// for the trace color and Real-speed-mode bookkeeping -- must be loaded
// before this file. Does NOT depend on stage_engine.js or
// journeys/ecg/ecg_stage_blocks.js at all.
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
// GLOBAL endpoint base for fetching raw signal data. Defaults to ECG endpoints.
// Fitness/other journeys can override this to "/api/fitness/samples" etc.
let globalSampleEndpointBase = "/shorts/api/sample";

async function fetchSignal(sampleId) {
    if (fetchedSignalCache.has(sampleId)) {
        return fetchedSignalCache.get(sampleId);
    }
    try {
        const res = await fetch(`${globalSampleEndpointBase}/${sampleId}/raw`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const payload = await res.json();
        const result = { signal: payload.signal, fs: payload.fs };
        fetchedSignalCache.set(sampleId, result);

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
const AXIS_LABEL_STYLE = { size: 13, color: "#9aa1ab", family: "IBM Plex Mono, monospace" };

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
    // Without this, calling startSweepLoop() again for the same sampleId
    // (e.g. rapidly clicking a rail button several times) does NOT stop
    // the PREVIOUS call's tick() loop -- each one keeps re-scheduling
    // itself independently via requestAnimationFrame, since overwriting
    // sweepAnimationHandles only replaces which handle is TRACKED, not
    // which ones are actually still pending. Multiple loops end up
    // running simultaneously, all writing to the same
    // activeSweepControl entry. This cancels whatever loop was
    // previously running for this card FIRST, guaranteeing at most one
    // active loop per card at any time, regardless of call frequency.
    cancelSweepAnimation(sampleId);

    activeSweepControl.set(sampleId, { totalDurationMs, drawFn, lastElapsedMs: startElapsedMs });

    if (startElapsedMs >= totalDurationMs) {
        drawFn(totalDurationMs);
        return;
    }

    const startTime = performance.now() - startElapsedMs;

    // ~30fps target for the actual expensive drawFn/Plotly.update() calls
    // -- NOT the requestAnimationFrame loop's own cadence, which keeps
    // running at the display's native rate purely to track elapsed time
    // accurately. Plotly.update() does a real SVG re-render on every call;
    // if the browser can't sustain that 60 times/second, frames get
    // dropped unevenly, which looks like judder. A steady, achievable
    // 30fps for the actual redraw looks smoother than an inconsistent,
    // stuttering attempt at 60fps.
    // Hoisted to module level so the dev FPS toggle can modify at runtime.
    // Without this, each startSweepLoop() call captures its own local
    // copy and the toggle would have no effect on already-running loops.
    const DRAW_THROTTLE_MS = globalThis._DEV_DRAW_THROTTLE_MS ?? 33;
    let lastDrawTime = -Infinity; // guarantees the very first tick always draws immediately, no initial delay

    function tick(now) {
        const elapsed = Math.min(now - startTime, totalDurationMs);
        const control = activeSweepControl.get(sampleId);
        if (control) control.lastElapsedMs = elapsed; // ALWAYS kept accurate regardless of draw throttling below -- pause/resume must never be thrown off by this

        const isFinalFrame = elapsed >= totalDurationMs;
        if (isFinalFrame || DRAW_THROTTLE_MS === 0 || now - lastDrawTime >= DRAW_THROTTLE_MS) {
            // Call via control.drawFn rather than the closure drawFn --
            // this allows renderers (e.g. chart_v1) to wrap/replace drawFn
            // on the control object from outside startSweepLoop, and have
            // the replacement actually execute. The closure drawFn would
            // always call the original regardless of any external wrapping.
            const fn = control ? control.drawFn : drawFn;
            fn(elapsed);
            lastDrawTime = now;
        }

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

// Shared by any RENDERER that's "just a waveform sweep" -- Stage 0's raw
// signal, Stage 1's corrected signal, any future simple waveform stage,
// and (via durationMs, not stageIdx) anything OUTSIDE the main pipeline
// too, like a standalone demo. Extracted here specifically because Stage 0
// and Stage 1 would otherwise be near-identical ~40-line renderers
// differing only in which array gets plotted -- exactly the kind of
// duplication worth catching on the SECOND occurrence. Stage 2 still
// writes its own renderer (needs an extra peak-marker trace), but reuses
// the same window/downsample helpers below either way.
//
// Takes durationMs directly rather than deriving it internally from a
// stage index -- this used to call getStageDuration(stageIdx, sampleId)
// itself, which meant genuinely reusing this function outside the real
// registry would have silently inherited whatever pacing happened to be
// tuned for an unrelated ECG stage. Callers decide their own duration now.
function renderWaveformSweep(container, sampleId, totalDurationMs, t, y, fs) {
    const yMin = Math.min(...y) - 0.1;
    const yMax = Math.max(...y) + 0.1;

    const ECG_WINDOW_SECONDS = 3; // was 5 -- 3s shows ~3-4 beats at once rather than 5-6, leading edge moves more slowly. Closer to real diagnostic monitor feel.
    const windowSamples = Math.round(ECG_WINDOW_SECONDS * fs);

    const trace = {
        x: [t[0]], y: [y[0]], mode: "lines",
        line: { color: THEMES[themeIndex].traceColor, width: 2, shape: "spline" },
        hoverinfo: "skip",
    };

    const layout = buildChartLayout(yMin, yMax, [t[0], t[0] + ECG_WINDOW_SECONDS]);
    Plotly.newPlot(container, [trace], layout, { staticPlot: true, responsive: true });

    const MAX_POINTS_PER_UPDATE = globalThis._DEV_MAX_POINTS ?? 500;
    const DOWNSAMPLE_STRIDE = Math.max(1, Math.ceil(windowSamples / MAX_POINTS_PER_UPDATE));
    const sampleAligned = makeSampleAligner(t, y, DOWNSAMPLE_STRIDE);

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