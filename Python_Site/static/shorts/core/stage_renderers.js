// ---------------------------------------------------------------------------
// stage_renderers.js
// Registers Stage 0 (raw signal), Stage 1 (baseline correction), Stage 2
// (peak detection), Stage 3 (HRV metrics), and Stage 4 (verdict) with the
// generic engine from stage_engine.js -- see registerStage() calls at the
// bottom of each section.
//
// The genuinely generic pieces (fetchSignal, buildChartLayout,
// renderWaveformSweep, the sweep loop) now live in shared_signal_utils.js,
// extracted out so they can be reused WITHOUT dragging in this file's
// entire ECG-specific dependency tree (Pan-Tompkins, HRV metrics, both
// algorithm registries) -- e.g. by a standalone demo that only needs the
// charting/fetch utilities, not the actual ECG stage registrations.
//
// Depends on shared_signal_utils.js (fetchSignal, buildChartLayout,
// renderWaveformSweep, makeSampleAligner, startSweepLoop,
// cancelSweepAnimation), stage_engine.js (registerStage,
// invalidateFromStage), baseline_correction_filter.js
// (removeBaselineWander), pan_tompkins_filter.js (panTompkinsDetectPeaks),
// and rail_controls.js (THEMES, invertedSamples, getStageDuration) -- all
// five must be loaded before this file.
// ---------------------------------------------------------------------------

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
    renderWaveformSweep(container, sampleId, getStageDuration(0, sampleId), output.t, output.y, output.fs);
}

registerStage("ecg", 0, {
    // no dependsOn -- Stage 0 IS the raw entry point, starts fresh from the fetch
    processor: rawSignalProcessor,
    renderer: rawSignalRenderer,
    label: {
        main: "Your Heartbeat",
        small: "Raw ECG Signal",
        blurb: "Every recording here is a real electrical signal from someone's heart -- the same kind of trace a hospital monitor shows.",
    },
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

    // Whichever pre-filter is currently selected in the registry runs here
    // -- same mechanism as Stage 2's plug-and-play peak detector selection.
    const preFilter = typeof getSelectedPreFilter === "function"
        ? getSelectedPreFilter()
        : { apply: (y, fs) => removeBaselineWander(y, fs) }; // safe fallback if the registry file somehow isn't loaded

    const corrected = preFilter.apply(y, fs);
    return { t, y: corrected, fs };
}

function baselineCorrectionRenderer(container, sampleId, output) {
    renderWaveformSweep(container, sampleId, getStageDuration(1, sampleId), output.t, output.y, output.fs);
}

registerStage("ecg", 1, {
    dependsOn: 0, // Stage 0's {t, y, fs} raw waveform
    processor: baselineCorrectionProcessor,
    renderer: baselineCorrectionRenderer,
    railControls: ["prefilter"], // the pre-filter cycle button only makes sense while THIS stage is active
    label: {
        main: "Cleaning It Up",
        small: "Baseline Correction",
        blurb: "Breathing and movement can make the signal drift. We flatten that out first, so nothing gets mistaken for a heartbeat.",
    },
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

    // Whichever detector is currently selected in the registry runs here --
    // this line is the entire "plug and play" mechanism. Nothing else in
    // this file needs to change to add a third algorithm later.
    const detector = typeof getSelectedDetector === "function"
        ? getSelectedDetector()
        : { detect: panTompkinsDetectPeaks }; // safe fallback if the registry file somehow isn't loaded

    const { peakIndices, steps } = detector.detect(y, fs);
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

    // The explainer hook used to live here, hardcoded to this one renderer.
    // It's now centralized in stage_engine.js's renderStageChart -- ANY
    // stage whose output has a `steps` array gets it automatically, not
    // just this one. Nothing to call here anymore.

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

registerStage("ecg", 2, {
    // Was dependsOn: 0 -- now correctly points at Stage 1's cleaned output
    // instead of Stage 0's raw one. This one-line change is the entire
    // retrofit Stage 2 needed; its processor and renderer are untouched.
    dependsOn: 1,
    processor: peakDetectionProcessor,
    renderer: peakDetectionRenderer,
    railControls: ["algo"], // the peak-detector cycle button only makes sense while THIS stage is active
    label: {
        main: "Finding Each Beat",
        small: "Peak Detection",
        blurb: "A filter automatically spots each beat in the signal, the same way a nurse would count pulses on a monitor.",
    },
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

registerStage("ecg", 3, {
    dependsOn: 2, // Stage 2's peak indices
    processor: hrvMetricsProcessor,
    renderer: hrvMetricsRenderer,
    label: {
        main: "Rhythm Patterns",
        small: "HRV Metrics",
        blurb: "The timing between beats tells a story -- steady and even, or scattered and irregular.",
    },
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

registerStage("ecg", 4, {
    dependsOn: 3, // Stage 3's HRV metrics, passed through plus the true label
    processor: verdictProcessor,
    renderer: verdictRenderer,
    label: {
        main: "The Result",
        small: "Verdict",
        blurb: "Each card ends with what the pattern suggests. Tap the ? on any step to see how it actually works.",
    },
});