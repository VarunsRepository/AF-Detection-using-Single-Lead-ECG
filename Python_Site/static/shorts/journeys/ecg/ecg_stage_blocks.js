// ---------------------------------------------------------------------------
// journeys/ecg/ecg_stage_blocks.js
// (previously ecg_stages.js -- renamed and refactored to REGISTER REUSABLE
// BLOCKS via registerStageBlock(), not directly wire the "ecg" journey via
// registerStage(). The actual DSP/rendering logic below is UNCHANGED --
// every processor and renderer function is identical to before. What
// changed is only the final registration call at the bottom of each
// section, and dependsOn moving OUT of the block definition entirely: a
// reusable block shouldn't hardcode its position in any specific
// sequence, since a future journey might want "peak_detection" to depend
// on something other than stage 1. dependsOn now lives in the RECIPE
// (see journeys_catalog.py's "ecg" entry), which journey_loader.js reads
// to wire these blocks into an actual journey via registerStage().
//
// The genuinely generic pieces (fetchSignal, buildChartLayout,
// renderWaveformSweep, the sweep loop) live in core/shared_signal_utils.js.
//
// Depends on shared_signal_utils.js, stage_block_library.js
// (registerStageBlock), baseline_correction_filter.js,
// pan_tompkins_filter.js, and rail_controls.js -- all must be loaded
// before this file, which itself must load before journey_loader.js
// actually interprets any recipe referencing these block names.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// BLOCK: raw_signal
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

registerStageBlock("raw_signal", {
    processor: rawSignalProcessor,
    renderer: rawSignalRenderer,
    label: {
        main: "Your Heartbeat",
        small: "Raw ECG Signal",
        blurb: "Every recording here is a real electrical signal from someone's heart -- the same kind of trace a hospital monitor shows.",
    },
});

// ---------------------------------------------------------------------------
// BLOCK: baseline_correction
// ---------------------------------------------------------------------------
function baselineCorrectionProcessor(input, sampleId) {
    const { t, y, fs } = input;

    const preFilter = typeof getSelectedPreFilter === "function"
        ? getSelectedPreFilter()
        : { apply: (y, fs) => removeBaselineWander(y, fs) };

    const corrected = preFilter.apply(y, fs);
    return { t, y: corrected, fs };
}

function baselineCorrectionRenderer(container, sampleId, output) {
    renderWaveformSweep(container, sampleId, getStageDuration(1, sampleId), output.t, output.y, output.fs);
}

registerStageBlock("baseline_correction", {
    processor: baselineCorrectionProcessor,
    renderer: baselineCorrectionRenderer,
    railControls: ["prefilter"],
    label: {
        main: "Cleaning It Up",
        small: "Baseline Correction",
        blurb: "Breathing and movement can make the signal drift. We flatten that out first, so nothing gets mistaken for a heartbeat.",
    },
});

// ---------------------------------------------------------------------------
// BLOCK: peak_detection
// ---------------------------------------------------------------------------
function peakDetectionProcessor(input, sampleId) {
    const { t, y, fs } = input;

    const detector = typeof getSelectedDetector === "function"
        ? getSelectedDetector()
        : { detect: panTompkinsDetectPeaks };

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

registerStageBlock("peak_detection", {
    processor: peakDetectionProcessor,
    renderer: peakDetectionRenderer,
    railControls: ["algo"],
    label: {
        main: "Finding Each Beat",
        small: "Peak Detection",
        blurb: "A filter automatically spots each beat in the signal, the same way a nurse would count pulses on a monitor.",
    },
});

// ---------------------------------------------------------------------------
// BLOCK: hrv_metrics
// ---------------------------------------------------------------------------
function hrvMetricsProcessor(input, sampleId) {
    const { peakIndices, fs } = input;
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
            scaleanchor: "x",
        },
    };
}

function hrvMetricsRenderer(container, sampleId, output) {
    if (output.insufficient) {
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

    const axisMax = Math.max(...rrN, ...rrN1) * 1.15;

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

registerStageBlock("hrv_metrics", {
    processor: hrvMetricsProcessor,
    renderer: hrvMetricsRenderer,
    label: {
        main: "Rhythm Patterns",
        small: "HRV Metrics",
        blurb: "The timing between beats tells a story -- steady and even, or scattered and irregular.",
    },
});

// ---------------------------------------------------------------------------
// BLOCK: verdict
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

    const badge = container.querySelector(".verdict-badge");
    requestAnimationFrame(() => badge.classList.add("revealed"));
}

registerStageBlock("verdict", {
    processor: verdictProcessor,
    renderer: verdictRenderer,
    label: {
        main: "The Result",
        small: "Verdict",
        blurb: "Each card ends with what the pattern suggests. Tap the ? on any step to see how it actually works.",
    },
});
