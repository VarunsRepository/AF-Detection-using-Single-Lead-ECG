// ---------------------------------------------------------------------------
// prefilter_registry.js
// Same plug-and-play pattern as peak_detector_registry.js, applied to Stage
// 1 instead of Stage 2. Every entry shares the contract (y, fs) -> y --
// that shared shape is what makes them swappable without touching
// stage_renderers.js's baselineCorrectionProcessor at all.
//
// Lives in core/, not filters/ -- same reasoning as the peak detector
// registry: this file touches the DOM and drives UI state (cycling,
// invalidation, label updates), unlike the pure computation files it
// catalogs. Categorized by what it DOES, not what it's about.
//
// IDs are stable strings, not array positions -- same shareable-link
// reasoning as every other registry in this app.
// ---------------------------------------------------------------------------

const PRE_FILTERS = [
    { id: "baseline-correction", label: "BC", fullName: "Baseline Correction", apply: (y, fs) => removeBaselineWander(y, fs) },
    { id: "savitzky-golay", label: "SG", fullName: "Savitzky-Golay Smoothing", apply: (y, fs) => savitzkyGolaySmooth(y, 11, 3) },
    {
        id: "baseline-then-savgol",
        label: "BC+SG",
        fullName: "Baseline Correction + Savitzky-Golay",
        // Order matters here -- these aren't commutative. Baseline
        // correction removes slow drift FIRST; smoothing runs on the
        // already-de-drifted signal, giving it a stable baseline to fit
        // against rather than a moving target.
        apply: (y, fs) => savitzkyGolaySmooth(removeBaselineWander(y, fs), 11, 3),
    },
];

let selectedPreFilterId = "baseline-correction";

function getSelectedPreFilter() {
    return PRE_FILTERS.find(f => f.id === selectedPreFilterId) || PRE_FILTERS[0];
}

// Same cycling pattern as cyclePeakDetector()/cycleTheme() -- tap advances
// to the next entry and wraps around.
function cyclePreFilter() {
    const currentIndex = PRE_FILTERS.findIndex(f => f.id === selectedPreFilterId);
    const nextFilter = PRE_FILTERS[(currentIndex + 1) % PRE_FILTERS.length];
    selectedPreFilterId = nextFilter.id;

    // Changing the pre-filter changes Stage 1's OUTPUT -- every sample's
    // cached Stage 1 (and downstream Stage 2/3/4) result is now stale.
    // Global choice (like Speed/Theme/peak detector), not per-sample.
    if (typeof invalidateFromStageForAllSamples === "function") {
        invalidateFromStageForAllSamples("ecg", 1);
    }

    document.querySelectorAll(".rail-prefilter-label").forEach(el => {
        el.textContent = nextFilter.label;
    });

    if (typeof currentlyVisibleController !== "undefined" && currentlyVisibleController) {
        currentlyVisibleController.refreshActiveStage();
    }
}