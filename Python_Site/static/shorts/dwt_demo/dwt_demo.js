// ---------------------------------------------------------------------------
// dwt_demo.js
// Standalone demo -- NOT part of the main 5-stage pipeline, deliberately.
// Fetches one real signal via the EXISTING /shorts/api/sample/<id>/raw
// endpoint (no new backend route needed), runs a real multi-level Haar
// DWT, and shows each level as a tappable tab -- same step-tab pattern as
// algorithm_explainer.js's scrub bar, since that's already a proven,
// familiar interaction for exactly this kind of "step through an
// algorithm's stages" use case.
//
// Kept genuinely separate from core/stage_engine.js and friends: this does
// NOT call registerStage(), does NOT participate in dependsOn resolution,
// does NOT share the Journey/Stage navigation model at all. If DWT ever
// earns a real place as its own pipeline, that would mean building the
// pipeline-namespacing fix in stage_engine.js first (STAGE_DEFINITIONS is
// currently a single flat table, keyed by bare stageIdx -- a second
// pipeline would collide with the first). This demo intentionally
// sidesteps that prerequisite to let the actual math/visualization idea
// get tested today, cheaply.
// ---------------------------------------------------------------------------

async function fetchDemoSignal(sampleId) {
    const res = await fetch(`/shorts/api/sample/${sampleId}/raw`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const payload = await res.json();
    return { signal: payload.signal, fs: payload.fs };
}

function buildDwtChartLayout(yMin, yMax, xLabel) {
    const rootStyle = getComputedStyle(document.documentElement);
    const gridColor = rootStyle.getPropertyValue("--grid-color").trim() || "rgba(116,125,140,0.18)";

    return {
        margin: { t: 10, r: 10, b: 30, l: 40 },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        showlegend: false,
        xaxis: {
            title: { text: xLabel, font: { size: 9, color: "#747d8c" } },
            tickfont: { size: 9, color: "#747d8c" },
            showgrid: true,
            gridcolor: gridColor,
            zeroline: false,
        },
        yaxis: {
            title: { text: "Amplitude", font: { size: 9, color: "#747d8c" } },
            tickfont: { size: 9, color: "#747d8c" },
            showgrid: true,
            gridcolor: gridColor,
            zeroline: true,
            zerolinecolor: "rgba(116,125,140,0.4)",
            range: [yMin, yMax],
        },
    };
}

function drawDwtLevel(container, data, xLabel) {
    const yMin = Math.min(...data) - 0.1;
    const yMax = Math.max(...data) + 0.1;
    const trace = {
        x: data.map((_, i) => i),
        y: data,
        mode: "lines",
        line: { color: "#2dd4bf", width: 1.5 },
        hoverinfo: "skip",
    };
    Plotly.newPlot(container, [trace], buildDwtChartLayout(yMin, yMax, xLabel), { staticPlot: true, responsive: true });
}

async function runDwtDemo(sampleId) {
    const status = document.getElementById("dwt-status");
    const chartContainer = document.getElementById("dwt-chart");
    const tabsContainer = document.getElementById("dwt-tabs");

    status.textContent = "Loading signal…";
    tabsContainer.innerHTML = "";
    chartContainer.innerHTML = "";

    let fetched;
    try {
        fetched = await fetchDemoSignal(sampleId);
    } catch (err) {
        status.textContent = `Failed to load sample "${sampleId}": ${err.message}`;
        return;
    }

    const { signal, fs } = fetched;
    status.textContent = `Loaded ${signal.length} samples at ${fs} Hz. Running Haar DWT…`;

    const decomposition = multiLevelHaarDWT(signal, 6);
    status.textContent = `Decomposed into ${decomposition.length} levels (each level halves the resolution of the one before it).`;

    const allTabs = [
        { label: "Original", data: signal, xLabel: "Sample index" },
        ...decomposition.flatMap(d => [
            { label: `L${d.level} Approx`, data: d.approx, xLabel: `Sample index (level ${d.level})` },
            { label: `L${d.level} Detail`, data: d.detail, xLabel: `Sample index (level ${d.level})` },
        ]),
    ];

    allTabs.forEach((tab, i) => {
        const btn = document.createElement("button");
        btn.className = "dwt-tab-btn";
        btn.textContent = tab.label;
        btn.addEventListener("click", () => {
            tabsContainer.querySelectorAll(".dwt-tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            drawDwtLevel(chartContainer, tab.data, tab.xLabel);
        });
        tabsContainer.appendChild(btn);
        if (i === 0) {
            btn.classList.add("active");
            drawDwtLevel(chartContainer, tab.data, tab.xLabel);
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("dwt-sample-form");
    const input = document.getElementById("dwt-sample-input");

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const sampleId = input.value.trim();
        if (sampleId) runDwtDemo(sampleId);
    });

    if (input.value.trim()) runDwtDemo(input.value.trim());
});
