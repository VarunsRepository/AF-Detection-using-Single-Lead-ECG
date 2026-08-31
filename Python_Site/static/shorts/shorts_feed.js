// ---------------------------------------------------------------------------
// shorts_feed.js
// Drives the horizontal stage machine (auto-advance + tap-to-jump) inside
// each vertically-snapped card. Vertical scrolling itself needs NO JS at all
// -- that's native browser scroll-snap, per shorts_feed.css.
// ---------------------------------------------------------------------------

// Per-stage durations, in ms. Stage 0 (raw sweep) gets a bit longer since
// it's the one stage actively "drawing" rather than just revealing a
// number/badge. Verdict (last stage) never auto-advances regardless of what
// duration is listed here -- advance() already stops the timer once it
// reaches the final stage, so its duration value is unused in practice.
const STAGE_DURATIONS_MS = [2800, 2000, 2500, 2200, 2000];
const DEFAULT_STAGE_DURATION_MS = 2200; // fallback if a card has more stages than durations listed

// Each sample's real recording length, in ms, populated the first time its
// raw signal is fetched. Needed regardless of speed mode, since "Real-time"
// mode has no single fixed number -- every recording is a different length.
const recordingDurationMs = new Map();

// ---------------------------------------------------------------------------
// SPEED -- three real states now, not just a binary toggle, cycled via the
// rail's speed button. Only stage 0 (the sweep) is affected right now, same
// as before.
// ---------------------------------------------------------------------------
const SPEED_MODES = [
    { label: "1×", duration: () => STAGE_DURATIONS_MS[0] },
    { label: "3×", duration: () => STAGE_DURATIONS_MS[0] * 3 },
    { label: "Real", duration: (sampleId) => recordingDurationMs.get(sampleId) ?? STAGE_DURATIONS_MS[0] },
];
let speedModeIndex = 2; // default to "Real" -- was 0 ("1×")

// ---------------------------------------------------------------------------
// TRACE COLOR -- now a cycling palette (rail's color button), not a fixed
// constant. Deliberately excludes the UI's own green (--accent) so the data
// trace never looks like an interactive control.
// ---------------------------------------------------------------------------
const TRACE_COLORS = ["#4fd1ff", "#ffb84f", "#ffffff", "#ff6ec7"]; // cyan, amber, white, pink
let colorIndex = 0;

// ---------------------------------------------------------------------------
// BACKGROUND THEME -- now three presets, cycled the same way as Speed/Color
// (no longer a strict binary toggle, since a third option was added).
// Purely a display preference -- reversible, visible, no manipulation.
// ---------------------------------------------------------------------------
const THEME_PRESETS = [
    { label: "Charcoal", bg: "#0d1117", cardBg: "#161b22" },
    { label: "True Black", bg: "#000000", cardBg: "#0a0a0c" },
    { label: "Purple Black", bg: "#0e0a14", cardBg: "#1a1424" },
];
let themeIndex = 1; // default to "True Black" -- was 0 ("Charcoal")

// ---------------------------------------------------------------------------
// INVERSION -- per-sample, not global (unlike speed/color). Flips the
// signal's polarity for whichever specific recordings this is toggled on
// for. This is a manual, on-demand preview of exactly what the future
// Stage 1 "orientation correction" filter will eventually do automatically.
// ---------------------------------------------------------------------------
const invertedSamples = new Set();

// Caches the raw fetch result per sample, so toggling color/invert/speed --
// none of which actually need fresh data from the server -- can redraw
// instantly instead of re-fetching every time.
const fetchedSignalCache = new Map(); // sampleId -> { signal, fs }

function getStageDuration(stageIdx, sampleId) {
    if (stageIdx === 0) {
        return SPEED_MODES[speedModeIndex].duration(sampleId);
    }
    return STAGE_DURATIONS_MS[stageIdx] ?? DEFAULT_STAGE_DURATION_MS;
}

const SESSION_SUMMARY_EVERY = 10; // show the "nice session" card every N cards viewed

// NOTE: no localStorage progress tracking anymore. Under the new rule --
// every card always starts at stage 0, every time you scroll to it, no
// exceptions -- there's nothing to remember across visits. This removes an
// entire category of state (and the bugs that came with keeping it in sync).
let cardsViewedThisSession = 0;
let activeTimers = new Map();
const renderedCharts = new Set(); // "sampleId-stageIdx" keys already drawn, so we never re-animate a chart twice
const sweepAnimationHandles = new Map(); // sampleId -> requestAnimationFrame handle, for cancellation

// These three together make pause/resume possible. Without them, leaving a
// ---------------------------------------------------------------------------
// Stage 0 renderer: fetches the REAL raw signal for this sample from the
// pipeline (via RawSignalStore on the backend), then draws it as an
// animated left-to-right sweep -- same fetch-then-Plotly pattern already
// used in control_panel.js / plot_renderers.js.
// ---------------------------------------------------------------------------
// Shared by every stage that needs the raw signal (stage 0's sweep, stage 2's
// peak detection, and future stages too) -- cache-aware, so only the FIRST
// stage to touch a given sample ever actually hits the network.
// Shared by every stage renderer that plots the ECG against time -- keeps
// axis styling consistent as more stages get built, and means a future
// styling tweak only needs to happen in one place. Y-axis range is meant to
// be STATIC for the life of one sweep (cheap, computed once); X-axis range
// is expected to change every frame during a sliding-window sweep, which
// does cost a bit of per-frame tick recomputation -- a deliberate trade-off
// for legible units over strict monitor-authenticity (real monitors mostly
// skip numeric axes in favor of a calibration pulse + known sweep speed).
const AXIS_LABEL_STYLE = { size: 9, color: "#747d8c", family: "IBM Plex Mono, monospace" };

function buildChartLayout(yMin, yMax, initialXRange) {
    return {
        margin: { t: 10, r: 10, b: 30, l: 40 },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        showlegend: false,
        xaxis: {
            visible: true,
            title: { text: "Time (s)", font: AXIS_LABEL_STYLE },
            tickfont: AXIS_LABEL_STYLE,
            showgrid: false,
            zeroline: false,
            ticks: "outside",
            tickcolor: "#30363d",
            range: initialXRange,
        },
        yaxis: {
            visible: true,
            title: { text: "mV", font: AXIS_LABEL_STYLE },
            tickfont: AXIS_LABEL_STYLE,
            showgrid: false,
            zeroline: true, // horizontal reference line at 0 mV -- shows which
                              // way a beat deflects relative to baseline, and
                              // matters more now that Invert can flip polarity
            zerolinecolor: "rgba(116, 125, 140, 0.4)", // subtle -- a reference, not a gridline competing with the trace
            zerolinewidth: 1,
            ticks: "outside",
            tickcolor: "#30363d",
            range: [yMin, yMax], // static for the whole sweep -- cheap, no per-frame recompute
        },
    };
}

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
        return result;
    } catch (err) {
        console.error(`Failed to load raw signal for ${sampleId}:`, err);
        return null;
    }
}

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

    // real duration of this specific recording, stored BEFORE getStageDuration
    // is called below, so a redraw triggered by the toggle (or a first draw
    // while already in "real" mode) picks up the correct value immediately
    recordingDurationMs.set(sampleId, Math.round((y.length / fs) * 1000));

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

// Tracks the CURRENTLY ACTIVE sweep for whichever stage is being drawn --
// purely LIVE state, reset fresh every enterStage() call. This is deliberately
// NOT the same thing as the cross-visit persistence we removed earlier:
// scrolling away and back still restarts at zero regardless of this map.
// It exists only so a genuine, deliberate, WITHIN-view pause (center tap)
// can resume from exactly where it stopped, the same way a real pause
// button on a video would.
const activeSweepControl = new Map(); // sampleId -> { totalDurationMs, drawFn, lastElapsedMs }

// startElapsedMs defaults to 0 (a fresh entry); a non-zero value is only
// ever passed when resuming from a live pause.
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
// FILTER: simplified Pan-Tompkins R-peak detection. Pure computation, no
// rendering, no animation timing -- runs once, eagerly, the moment a stage
// needs it. This is the "filter" half of the filter/renderer split: it
// produces a finished result (peak indices) that a renderer can later
// reveal at whatever pace it wants, without recomputing anything.
//
// This is a SIMPLIFIED version of the classic 1985 algorithm -- a single
// fixed threshold with a refractory period, not the full adaptive dual-
// threshold + search-back scheme from the original paper. Good enough to
// visibly find R-peaks on reasonably clean recordings for testing/demo
// purposes; not a clinical-grade implementation.
// ---------------------------------------------------------------------------

function bandpassFilter(x, fs, lowCutHz = 5, highCutHz = 15) {
    const dt = 1 / fs;

    // single-pole high-pass -- removes baseline wander below lowCutHz
    const rcHigh = 1 / (2 * Math.PI * lowCutHz);
    const alphaHigh = rcHigh / (rcHigh + dt);
    const hp = new Array(x.length);
    hp[0] = x[0];
    for (let i = 1; i < x.length; i++) {
        hp[i] = alphaHigh * (hp[i - 1] + x[i] - x[i - 1]);
    }

    // single-pole low-pass -- smooths above highCutHz
    const rcLow = 1 / (2 * Math.PI * highCutHz);
    const alphaLow = dt / (rcLow + dt);
    const bp = new Array(x.length);
    bp[0] = hp[0];
    for (let i = 1; i < x.length; i++) {
        bp[i] = bp[i - 1] + alphaLow * (hp[i] - bp[i - 1]);
    }
    return bp;
}

function derivativeFilter(x) {
    // classic PT 5-point derivative approximation
    const y = new Array(x.length).fill(0);
    for (let i = 4; i < x.length; i++) {
        y[i] = (2 * x[i] + x[i - 1] - x[i - 3] - 2 * x[i - 4]) / 8;
    }
    return y;
}

function movingWindowIntegration(x, fs, windowMs = 150) {
    const windowSize = Math.max(1, Math.round((fs * windowMs) / 1000));
    const y = new Array(x.length).fill(0);
    let sum = 0;
    for (let i = 0; i < x.length; i++) {
        sum += x[i];
        if (i >= windowSize) sum -= x[i - windowSize];
        y[i] = sum / windowSize;
    }
    return y;
}

function panTompkinsDetectPeaks(rawY, fs) {
    const bp = bandpassFilter(rawY, fs);
    const derivative = derivativeFilter(bp);
    const squared = derivative.map(v => v * v);
    const integrated = movingWindowIntegration(squared, fs);

    // threshold set from the signal's own scale (99th percentile, robust to
    // a handful of unusually large spikes) rather than a fixed magic number
    const sorted = [...integrated].sort((a, b) => b - a);
    const robustMax = sorted[Math.floor(sorted.length * 0.01)] ?? Math.max(...integrated);
    const threshold = robustMax * 0.35;

    const refractorySamples = Math.round(fs * 0.2); // ~200ms minimum gap between beats
    const rawPeaks = [];
    let lastPeakIdx = -Infinity;

    for (let i = 1; i < integrated.length - 1; i++) {
        if (
            integrated[i] > threshold &&
            integrated[i] > integrated[i - 1] &&
            integrated[i] >= integrated[i + 1] &&
            i - lastPeakIdx > refractorySamples
        ) {
            rawPeaks.push(i);
            lastPeakIdx = i;
        }
    }

    // The derivative + integration stages introduce a processing DELAY --
    // a detected peak's index lags behind the true R-wave in the raw
    // signal. Refine each one by searching a short window backward in the
    // ORIGINAL signal for the true local maximum, so markers land on the
    // actual R-wave rather than the delayed integrated-signal peak.
    const searchWindow = Math.round(fs * 0.1); // ~100ms back-search
    const refined = rawPeaks.map(idx => {
        const start = Math.max(0, idx - searchWindow);
        let bestIdx = start, bestVal = rawY[start];
        for (let i = start; i <= idx; i++) {
            if (rawY[i] > bestVal) { bestVal = rawY[i]; bestIdx = i; }
        }
        return bestIdx;
    });

    return [...new Set(refined)].sort((a, b) => a - b); // de-duplicate in case refinement collapsed two detections together
}

// ---------------------------------------------------------------------------
// Stage 2 renderer: peak detection. The FILTER (panTompkinsDetectPeaks) runs
// ONCE, eagerly, computing every peak in the whole recording up front. This
// function's own drawAtElapsed only ever decides which ALREADY-FOUND peaks
// fall within the current sweep window -- no detection work happens per
// frame. Same shape as stage 0's sweep, deliberately, since that shape is
// exactly what made pause-free, always-fresh restarts trivial there too.
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
    const peakIndices = panTompkinsDetectPeaks(y, fs);

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

// ---------------------------------------------------------------------------
// Dynamic card construction. Builds the same DOM structure the static demo
// cards used to have, but from a real sample_id fetched from the backend.
// stageCount defaults to 5 (raw -> corrected -> peaks -> metrics -> verdict);
// only stage 0 actually renders anything real right now -- 1-4 stay empty
// placeholders until those renderers exist.
// ---------------------------------------------------------------------------
function buildCardElement(sampleId, label, stageCount = 5) {
    const stageNames = ["Raw signal", "Corrected", "Peak detection", "HRV metrics", "Verdict"];

    const card = document.createElement("section");
    card.className = "card";
    card.dataset.sampleId = sampleId;
    card.dataset.trueLabel = label ?? ""; // stored for later use -- rarity framing,
                                            // guess-before-reveal, verdict stage.
                                            // Not displayed anywhere yet.

    // shown/hidden purely via the .paused class on the card itself (see
    // togglePause() in initCard) -- no JS-driven show/hide logic needed here
    const pauseIndicator = document.createElement("div");
    pauseIndicator.className = "pause-indicator";
    pauseIndicator.innerHTML = "&#10074;&#10074;"; // ⏸ rendered as two bars, safe across fonts

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    bar.dataset.stageCount = stageCount;

    const viewport = document.createElement("div");
    viewport.className = "stage-viewport";

    for (let i = 0; i < stageCount; i++) {
        const segment = document.createElement("div");
        segment.className = "segment";
        segment.dataset.stage = i;
        segment.innerHTML = '<div class="fill"></div>';
        bar.appendChild(segment);

        const stageContent = document.createElement("div");
        stageContent.className = i === 0 ? "stage-content active" : "stage-content";
        stageContent.dataset.stage = i;
        stageContent.innerHTML = `
            <div class="stage-label${i === stageCount - 1 ? " verdict-label" : ""}">${stageNames[i] || `Stage ${i}`}</div>
            <div class="chart-frame${i === stageCount - 1 ? " verdict-frame" : ""}" id="chart-${sampleId}-${i}"></div>
        `;
        viewport.appendChild(stageContent);
    }

    const footer = document.createElement("div");
    footer.className = "card-footer";
    footer.innerHTML = `
        <span class="sample-id">#${sampleId}</span>
        <span class="tap-hint">tap right to advance &middot; swipe up for next</span>
    `;

    // Right-side control rail, YT Shorts-style positioning. Speed and color
    // are GLOBAL state (same across every card); invert is PER-SAMPLE, so
    // its pressed-state reflects only THIS card's own inverted status.
    const rail = document.createElement("div");
    rail.className = "stage-rail";
    rail.innerHTML = `
        <button class="rail-btn rail-speed" data-role="speed" title="Playback speed">${SPEED_MODES[speedModeIndex].label}</button>
        <button class="rail-btn rail-color" data-role="color" title="Trace color" style="--swatch:${TRACE_COLORS[colorIndex]}"></button>
        <button class="rail-btn rail-invert" data-role="invert" title="Invert signal" aria-pressed="${invertedSamples.has(sampleId)}">⇅</button>
        <button class="rail-btn rail-theme" data-role="theme" title="Background theme" style="--swatch:${THEME_PRESETS[themeIndex].bg}"></button>
    `;

    card.appendChild(bar);
    card.appendChild(viewport);
    card.appendChild(footer);
    card.appendChild(rail);
    card.appendChild(pauseIndicator);
    return card;
}

// Fetches real record IDs and populates the feed before anything else runs.
// ---------------------------------------------------------------------------
// Pagination state. PAGE_SIZE controls how many cards load per batch --
// both the initial load AND every subsequent "load more" as the sentinel
// is reached. totalAvailable is filled in from the server's first response,
// so we know exactly when to stop trying (genuinely out of records) rather
// than requesting forever.
// ---------------------------------------------------------------------------
const PAGE_SIZE = 10;
let loadedCount = 0;
let totalAvailable = null;
let isLoadingMore = false;

async function fetchSamplesPage(offset) {
    const res = await fetch(`/shorts/api/samples?limit=${PAGE_SIZE}&offset=${offset}`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    return res.json(); // { samples, total, offset }
}

async function loadFeedCards() {
    const feed = document.getElementById("feed");
    try {
        const { samples, total } = await fetchSamplesPage(0);
        totalAvailable = total;

        if (samples.length === 0) {
            feed.innerHTML = '<p style="color:#747d8c;text-align:center;margin-top:40vh;">No records found in cache.</p>';
            return;
        }

        samples.forEach(({ record_id, label }) => feed.appendChild(buildCardElement(record_id, label)));
        loadedCount = samples.length;
    } catch (err) {
        console.error("Failed to load sample list:", err);
        feed.innerHTML = '<p style="color:#a32638;text-align:center;margin-top:40vh;">Could not load records.</p>';
    }
}

// Called by the sentinel observer (see initFeed) whenever it comes into
// view -- appends the next page, and hooks each new card into the SAME
// controller map + visibility observer as the original batch, via the
// registerCard callback initFeed provides.
async function loadMoreCards(registerCard) {
    if (isLoadingMore) return; // guard against a double-trigger while a fetch is already in flight
    if (totalAvailable !== null && loadedCount >= totalAvailable) return; // genuinely out of records

    isLoadingMore = true;
    try {
        const { samples } = await fetchSamplesPage(loadedCount);
        const feed = document.getElementById("feed");
        const sentinel = document.getElementById("load-more-sentinel");

        samples.forEach(({ record_id, label }) => {
            const card = buildCardElement(record_id, label);
            feed.insertBefore(card, sentinel); // new cards go BEFORE the sentinel, so it stays last
            registerCard(card);
        });
        loadedCount += samples.length;
    } catch (err) {
        console.error("Failed to load more samples:", err);
    } finally {
        isLoadingMore = false;
    }
}

// ---------------------------------------------------------------------------
// Per-card stage controller
// ---------------------------------------------------------------------------
const RESTART_THRESHOLD_MS = 400; // left-tap within this window of entering a
                                    // stage means "go to previous"; beyond it
                                    // means "restart current" -- same pattern
                                    // as Spotify/YouTube's "previous" button

function initCard(cardEl) {
    const sampleId = cardEl.dataset.sampleId;
    const bar = cardEl.querySelector(".stage-bar");
    const segments = Array.from(bar.querySelectorAll(".segment"));
    const stageEls = Array.from(cardEl.querySelectorAll(".stage-content"));
    const maxStage = stageEls.length - 1;

    let currentStage = 0; // always -- no cross-visit memory anymore
    let stageEnteredAt = performance.now(); // live, in-the-moment only; not persisted
    let isPaused = false; // live pause state -- reset fresh every enterStage(), never survives leaving the card

    // THE canonical entry point. Advancing, restarting, going to a previous
    // stage, and a card's very first activation all funnel through here --
    // one function, always producing a genuinely fresh state. No exceptions,
    // no partial-resume branches to keep in sync with each other.
    function enterStage(stageIdx) {
        currentStage = Math.max(0, Math.min(stageIdx, maxStage));
        stageEnteredAt = performance.now();
        isPaused = false; // entering (or re-entering) a stage always starts unpaused

        stageEls.forEach(el => {
            el.classList.toggle("active", Number(el.dataset.stage) === currentStage);
        });

        segments.forEach((seg, i) => {
            const fill = seg.querySelector(".fill");
            seg.classList.remove("completed", "current");

            // force a reflow between removing and re-adding "current" --
            // without this, RESTARTING the segment you're already on (e.g.
            // left-tap on a fresh stage) might not replay the CSS keyframe
            // from the start, since browsers can coalesce a same-frame
            // remove+re-add of the same class into a no-op visually
            fill.style.animation = "none";
            void fill.offsetWidth;
            fill.style.animationPlayState = "running"; // in case a prior pause left this frozen

            if (i < currentStage) {
                seg.classList.add("completed");
            } else if (i === currentStage) {
                fill.style.animation = ""; // restore the CSS-defined fillBar animation
                seg.classList.add("current");
                fill.style.animationDuration = `${getStageDuration(currentStage, sampleId)}ms`;
            }
        });

        // always a genuinely fresh render -- no memory of any prior visit
        const key = `${sampleId}-${currentStage}`;
        renderedCharts.delete(key);
        cancelSweepAnimation(sampleId);
        const activeEl = stageEls.find(el => Number(el.dataset.stage) === currentStage);
        const container = activeEl && activeEl.querySelector(".chart-frame");
        if (container) renderStageChart(sampleId, currentStage, container);

        cardEl.classList.remove("paused");
        startAutoAdvance();
    }

    function startAutoAdvance(overrideDurationMs = null) {
        clearAutoAdvance(sampleId); // never let two timers stack for the same card
        const duration = overrideDurationMs ?? getStageDuration(currentStage, sampleId);
        const handle = setTimeout(onTapRight, duration);
        activeTimers.set(sampleId, handle);
    }

    function onTapRight() {
        if (currentStage < maxStage) {
            enterStage(currentStage + 1);
        } else {
            clearAutoAdvance(sampleId); // reached the verdict -- hold, no further advancing
        }
    }

    function onTapLeft() {
        const elapsedInStage = performance.now() - stageEnteredAt;
        if (elapsedInStage > RESTART_THRESHOLD_MS) {
            enterStage(currentStage); // still mid-stage -- restart it from zero
        } else if (currentStage > 0) {
            enterStage(currentStage - 1); // just arrived -- go to the previous stage instead
        }
        // else: already at stage 0, just entered -- nothing before it, no-op
    }

    // Center tap -- pause/resume, same convention as YouTube Shorts/Reels.
    // This is a genuine, deliberate WITHIN-view pause: it freezes the sweep,
    // the stage-advance countdown, and the progress-bar fill all together,
    // and resuming continues from exactly the same point. It does NOT
    // survive leaving the card -- scrolling away still restarts at zero
    // regardless of whether you left mid-pause, per the broader "always
    // fresh" rule elsewhere in this file.
    function togglePause() {
        if (!isPaused) {
            isPaused = true;
            cardEl.classList.add("paused");

            clearAutoAdvance(sampleId); // stop the stage-advance countdown
            cancelSweepAnimation(sampleId); // freeze the chart's rAF loop

            const fill = segments[currentStage]?.querySelector(".fill");
            if (fill) fill.style.animationPlayState = "paused"; // freeze the CSS bar too -- it runs on its own clock otherwise
        } else {
            isPaused = false;
            cardEl.classList.remove("paused");

            const fill = segments[currentStage]?.querySelector(".fill");
            if (fill) fill.style.animationPlayState = "running";

            const control = activeSweepControl.get(sampleId);
            const elapsedAtPause = control ? control.lastElapsedMs : (performance.now() - stageEnteredAt);

            // shift the reference point forward so future elapsed-since
            // calculations (e.g. a left-tap right after resuming) stay
            // consistent, as if the pause never happened time-wise
            stageEnteredAt = performance.now() - elapsedAtPause;

            const remaining = Math.max(0, getStageDuration(currentStage, sampleId) - elapsedAtPause);
            startAutoAdvance(remaining); // resume the countdown with only what's LEFT, not a fresh full duration

            if (control) {
                startSweepLoop(sampleId, control.totalDurationMs, control.drawFn, elapsedAtPause);
            }
        }
    }

    segments.forEach((seg, i) => {
        seg.addEventListener("click", () => enterStage(i));
    });

    // Three tap zones now, not two: left third = restart/previous (see
    // onTapLeft), middle third = pause/resume, right third = advance.
    const CENTER_ZONE_FRACTION = 0.34;
    const viewport = cardEl.querySelector(".stage-viewport");
    viewport.addEventListener("click", (e) => {
        const rect = viewport.getBoundingClientRect();
        const relativeX = (e.clientX - rect.left) / rect.width; // 0 to 1
        const centerStart = 0.5 - CENTER_ZONE_FRACTION / 2;
        const centerEnd = 0.5 + CENTER_ZONE_FRACTION / 2;

        if (relativeX >= centerStart && relativeX <= centerEnd) {
            togglePause();
        } else if (relativeX > centerEnd) {
            onTapRight();
        } else {
            onTapLeft();
        }
    });

    // Every time this card becomes visible, it starts at stage 0, no
    // exceptions -- per the new rule, there's no "first time" special case
    // to guard against; enterStage() is always safe to call again.
    function activate() {
        enterStage(0);
    }

    // Called by the global speed toggle when its mode flips -- if this card
    // is currently showing stage 0, restart it with the new setting applied.
    // Cards NOT on stage 0 right now just pick up the new mode naturally the
    // next time their stage 0 becomes active (no action needed for those).
    function refreshStage0IfActive() {
        if (currentStage === 0) enterStage(0);
    }

    return { sampleId, activate, refreshStage0IfActive };
}

function clearAutoAdvance(sampleId) {
    if (activeTimers.has(sampleId)) {
        clearTimeout(activeTimers.get(sampleId)); // setTimeout now, not setInterval -- see startAutoAdvance()
        activeTimers.delete(sampleId);
    }
}

let currentlyVisibleController = null; // updated by initFeed's observer below

function initFeed() {
    // controllers and cardObserver both live in this closure, but are
    // reachable via registerCard -- so loadMoreCards() can add NEW cards
    // into the exact same visibility system as the original batch, rather
    // than those cards being invisible to the observer entirely.
    const controllers = new Map();

    const cardObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const controller = controllers.get(entry.target);
            if (!controller) return;
            if (entry.isIntersecting) {
                controller.activate(); // always starts fresh at stage 0 -- see enterStage()
                currentlyVisibleController = controller;
                onCardEntered(entry.target);
            } else {
                clearAutoAdvance(controller.sampleId);
                cancelSweepAnimation(controller.sampleId); // stop the rAF loop -- nothing needs to resume it anymore
            }
        });
    }, { threshold: 0.6 });

    function registerCard(cardEl) {
        const controller = initCard(cardEl);
        controllers.set(cardEl, controller);
        cardObserver.observe(cardEl);
    }

    Array.from(document.querySelectorAll(".card")).forEach(registerCard);

    // Sentinel: a thin, invisible element kept as the LAST child of #feed.
    // When it scrolls into view, we're near the bottom -- time to fetch the
    // next page. Reusing IntersectionObserver here rather than a manual
    // scroll-position calculation keeps this consistent with how the rest
    // of the feed already detects visibility.
    const sentinel = document.createElement("div");
    sentinel.id = "load-more-sentinel";
    sentinel.style.height = "1px";
    document.getElementById("feed").appendChild(sentinel);

    const sentinelObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            loadMoreCards(registerCard);
        }
    }, { threshold: 0.01 }); // trivial threshold -- sentinel is 1px tall, any visibility at all counts

    sentinelObserver.observe(sentinel);
}

const seenThisSession = new Set();

function onCardEntered(cardEl) {
    const sampleId = cardEl.dataset.sampleId;
    if (seenThisSession.has(sampleId)) return;
    seenThisSession.add(sampleId);
    cardsViewedThisSession++;
    if (cardsViewedThisSession % SESSION_SUMMARY_EVERY === 0) {
        showSessionSummary();
    }
}

function showSessionSummary() {
    const overlay = document.getElementById("session-summary");
    document.getElementById("summary-count").textContent = cardsViewedThisSession;
    overlay.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", async () => {
    // set this FIRST, before any chart can render, so the CSS glow always
    // matches whatever color is currently selected in the palette
    document.documentElement.style.setProperty("--ecg-trace-color", TRACE_COLORS[colorIndex]);

    await loadFeedCards(); // build real cards first...
    initFeed();             // ...then wire up stage machinery + scroll watching

    const dismissBtn = document.getElementById("summary-dismiss");
    if (dismissBtn) {
        dismissBtn.addEventListener("click", () => {
            document.getElementById("session-summary").classList.add("hidden");
        });
    }

    // ------------------------------------------------------------------
    // Rail controls -- ONE delegated listener on #feed, rather than
    // wiring 3 buttons x N cards individually. Matters once pagination
    // adds many more cards later; this scales regardless of card count.
    // ------------------------------------------------------------------
    document.getElementById("feed").addEventListener("click", (e) => {
        const speedBtn = e.target.closest(".rail-speed");
        const colorBtn = e.target.closest(".rail-color");
        const invertBtn = e.target.closest(".rail-invert");
        const themeBtn = e.target.closest(".rail-theme");
        if (!speedBtn && !colorBtn && !invertBtn && !themeBtn) return;

        e.stopPropagation(); // don't let this also trigger stage tap-navigation
        const cardEl = e.target.closest(".card");
        const sampleId = cardEl?.dataset.sampleId;

        if (speedBtn) cycleSpeedMode();
        if (colorBtn) cycleTraceColor();
        if (invertBtn && sampleId) toggleInvert(sampleId);
        if (themeBtn) cycleTheme();
    });
});

function cycleTheme() {
    themeIndex = (themeIndex + 1) % THEME_PRESETS.length;
    const preset = THEME_PRESETS[themeIndex];
    // theme only touches CSS background variables -- no chart data is
    // affected, so unlike speed/color/invert this never needs a redraw
    document.documentElement.style.setProperty("--bg", preset.bg);
    document.documentElement.style.setProperty("--card-bg", preset.cardBg);
    document.querySelectorAll(".rail-theme").forEach(btn => {
        btn.style.setProperty("--swatch", preset.bg);
        btn.title = `Background theme (${preset.label})`;
    });
}

function cycleSpeedMode() {
    speedModeIndex = (speedModeIndex + 1) % SPEED_MODES.length;
    document.querySelectorAll(".rail-speed").forEach(btn => {
        btn.textContent = SPEED_MODES[speedModeIndex].label;
    });
    if (currentlyVisibleController) currentlyVisibleController.refreshStage0IfActive();
}

function cycleTraceColor() {
    colorIndex = (colorIndex + 1) % TRACE_COLORS.length;
    document.documentElement.style.setProperty("--ecg-trace-color", TRACE_COLORS[colorIndex]);
    document.querySelectorAll(".rail-color").forEach(btn => {
        btn.style.setProperty("--swatch", TRACE_COLORS[colorIndex]);
    });
    if (currentlyVisibleController) currentlyVisibleController.refreshStage0IfActive();
}

function toggleInvert(sampleId) {
    if (invertedSamples.has(sampleId)) {
        invertedSamples.delete(sampleId);
    } else {
        invertedSamples.add(sampleId);
    }
    // only THIS sample's rail button reflects the change -- invert is
    // per-sample, unlike speed/color which are global
    document.querySelectorAll(`.card[data-sample-id="${sampleId}"] .rail-invert`).forEach(btn => {
        btn.setAttribute("aria-pressed", invertedSamples.has(sampleId));
    });
    if (currentlyVisibleController && currentlyVisibleController.sampleId === sampleId) {
        currentlyVisibleController.refreshStage0IfActive();
    }
}
