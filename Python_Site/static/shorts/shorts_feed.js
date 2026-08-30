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
let speedModeIndex = 0;

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
let themeIndex = 0;

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

const STORAGE_KEY = "ecg_shorts_progress";

function loadProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

function saveProgress(progress) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

const progress = loadProgress();
let cardsViewedThisSession = 0;
let activeTimers = new Map();
const renderedCharts = new Set(); // "sampleId-stageIdx" keys already drawn, so we never re-animate a chart twice
const sweepAnimationHandles = new Map(); // sampleId -> requestAnimationFrame handle, for cancellation

// ---------------------------------------------------------------------------
// Stage 0 renderer: fetches the REAL raw signal for this sample from the
// pipeline (via RawSignalStore on the backend), then draws it as an
// animated left-to-right sweep -- same fetch-then-Plotly pattern already
// used in control_panel.js / plot_renderers.js.
// ---------------------------------------------------------------------------
async function drawRawSignalStage(container, sampleId) {
    const key = `${sampleId}-0`;
    if (renderedCharts.has(key)) return; // already drawn once, don't re-animate
    renderedCharts.add(key);

    cancelSweepAnimation(sampleId); // guard against a leftover loop from a rapid toggle

    container.classList.add("loading");

    let signal, fs;
    if (fetchedSignalCache.has(sampleId)) {
        // color/invert/speed changes redraw via this same function, but
        // none of them need fresh data -- reuse what we already fetched
        ({ signal, fs } = fetchedSignalCache.get(sampleId));
    } else {
        try {
            const res = await fetch(`/shorts/api/sample/${sampleId}/raw`);
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            const payload = await res.json();
            signal = payload.signal;
            fs = payload.fs;
            fetchedSignalCache.set(sampleId, { signal, fs });
        } catch (err) {
            console.error(`Failed to load raw signal for ${sampleId}:`, err);
            renderedCharts.delete(key); // allow a retry if the user revisits this card
            container.classList.remove("loading");
            return;
        }
    }

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

    const layout = {
        margin: { t: 10, r: 10, b: 10, l: 10 },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        xaxis: { visible: false, range: [t[0], t[0] + ECG_WINDOW_SECONDS] },
        yaxis: { visible: false, range: [yMin, yMax] },
        showlegend: false,
    };

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
    // Position is derived from actual ELAPSED TIME, not a step counter --
    // so the line's progress is always exactly where it should be for
    // however long has really passed, regardless of frame-rate hiccups.
    // ------------------------------------------------------------------
    const totalDurationMs = getStageDuration(0, sampleId);
    const startTime = performance.now();

    function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / totalDurationMs);
        const currentIndex = Math.max(2, Math.round(progress * (t.length - 1)) + 1);

        const startIdx = Math.max(0, currentIndex - windowSamples);
        const rangeStart = startIdx === 0 ? t[0] : t[startIdx];
        const rangeEnd = startIdx === 0 ? t[0] + ECG_WINDOW_SECONDS : t[currentIndex - 1];

        const { x: dsX, y: dsY } = sampleAligned(startIdx, currentIndex, DOWNSAMPLE_STRIDE);

        Plotly.update(container,
            { x: [dsX], y: [dsY] },
            { xaxis: { visible: false, range: [rangeStart, rangeEnd] }, yaxis: { visible: false, range: [yMin, yMax] } }
        );

        if (progress < 1) {
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

function renderStageChart(sampleId, stageIdx, container) {
    switch (stageIdx) {
        case 0:
            drawRawSignalStage(container, sampleId);
            break;
        // case 1, 2, 3, 4 -- corrected signal, peaks, metrics, verdict --
        // still to be built.
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
    return card;
}

// Fetches real record IDs and populates the feed before anything else runs.
async function loadFeedCards(limit = 10) {
    const feed = document.getElementById("feed");
    try {
        const res = await fetch(`/shorts/api/samples?limit=${limit}`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const { samples } = await res.json();

        if (samples.length === 0) {
            feed.innerHTML = '<p style="color:#747d8c;text-align:center;margin-top:40vh;">No records found in cache.</p>';
            return;
        }

        samples.forEach(({ record_id, label }) => feed.appendChild(buildCardElement(record_id, label)));
    } catch (err) {
        console.error("Failed to load sample list:", err);
        feed.innerHTML = '<p style="color:#a32638;text-align:center;margin-top:40vh;">Could not load records.</p>';
    }
}

// ---------------------------------------------------------------------------
// Per-card stage controller
// ---------------------------------------------------------------------------
function initCard(cardEl) {
    const sampleId = cardEl.dataset.sampleId;
    const bar = cardEl.querySelector(".stage-bar");
    const segments = Array.from(bar.querySelectorAll(".segment"));
    const stageEls = Array.from(cardEl.querySelectorAll(".stage-content"));
    const maxStage = stageEls.length - 1;

    let currentStage = progress[sampleId]?.stage ?? 0;
    currentStage = Math.min(currentStage, maxStage);

    function showStage(stageIdx, options) {
        const animate = !(options && options.animate === false);
        currentStage = stageIdx;

        stageEls.forEach(el => {
            const isActive = Number(el.dataset.stage) === stageIdx;
            el.classList.toggle("active", isActive);
            if (isActive) {
                const container = el.querySelector(".chart-frame");
                if (container) renderStageChart(sampleId, stageIdx, container);
            }
        });

        segments.forEach((seg, i) => {
            seg.classList.remove("completed", "current");
            const fill = seg.querySelector(".fill");
            if (i < stageIdx) {
                seg.classList.add("completed");
            } else if (i === stageIdx) {
                seg.classList.add("current");
                fill.style.animationDuration = `${getStageDuration(stageIdx, sampleId)}ms`; // matches this stage's real timing
            }
        });

        progress[sampleId] = { stage: stageIdx, seenAt: Date.now() };
        saveProgress(progress);
    }

    function advance() {
        if (currentStage < maxStage) {
            showStage(currentStage + 1);
            scheduleNextAdvance(); // each stage re-schedules using ITS OWN duration
        } else {
            clearAutoAdvance(sampleId); // reached the verdict -- hold, no further advancing
        }
    }

    function scheduleNextAdvance() {
        clearAutoAdvance(sampleId); // never let two timers stack for the same card
        const handle = setTimeout(advance, getStageDuration(currentStage, sampleId));
        activeTimers.set(sampleId, handle);
    }

    function startAutoAdvance() {
        scheduleNextAdvance(); // begins the chain from whatever stage we're currently on
    }

    segments.forEach((seg, i) => {
        seg.addEventListener("click", () => {
            showStage(i);
            startAutoAdvance();
        });
    });

    const viewport = cardEl.querySelector(".stage-viewport");
    viewport.addEventListener("click", (e) => {
        const rect = viewport.getBoundingClientRect();
        const tappedRight = (e.clientX - rect.left) > rect.width / 2;
        if (tappedRight) {
            advance();
        } else if (currentStage > 0) {
            showStage(currentStage - 1);
        }
        startAutoAdvance();
    });

    showStage(currentStage, { animate: false });

    // Called by the global speed toggle when its mode flips -- if this card
    // is currently showing stage 0, re-draw it immediately (using whichever
    // duration now applies) and reschedule the auto-advance timer to match.
    // Cards NOT on stage 0 right now just pick up the new mode naturally the
    // next time their stage 0 becomes active (no action needed for those).
    function refreshStage0IfActive() {
        if (currentStage !== 0) return;
        const stage0El = stageEls.find(el => Number(el.dataset.stage) === 0);
        const container = stage0El && stage0El.querySelector(".chart-frame");
        if (!container) return;

        renderedCharts.delete(`${sampleId}-0`); // allow drawRawSignalStage to run again
        renderStageChart(sampleId, 0, container);

        const fill = segments[0].querySelector(".fill");
        fill.style.animationDuration = `${getStageDuration(0, sampleId)}ms`;

        startAutoAdvance(); // re-schedule using the new duration
    }

    return { startAutoAdvance, sampleId, refreshStage0IfActive };
}

function clearAutoAdvance(sampleId) {
    if (activeTimers.has(sampleId)) {
        clearTimeout(activeTimers.get(sampleId)); // setTimeout now, not setInterval -- see advance()/scheduleNextAdvance()
        activeTimers.delete(sampleId);
    }
}

let currentlyVisibleController = null; // updated by initFeed's observer below

function initFeed() {
    const cards = Array.from(document.querySelectorAll(".card"));
    const controllers = new Map(cards.map(card => [card, initCard(card)]));

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const controller = controllers.get(entry.target);
            if (!controller) return;
            if (entry.isIntersecting) {
                controller.startAutoAdvance();
                currentlyVisibleController = controller;
                onCardEntered(entry.target);
            } else {
                clearAutoAdvance(controller.sampleId);
                cancelSweepAnimation(controller.sampleId); // stop the rAF loop too, not just the stage timer
            }
        });
    }, { threshold: 0.6 });

    cards.forEach(card => observer.observe(card));
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
