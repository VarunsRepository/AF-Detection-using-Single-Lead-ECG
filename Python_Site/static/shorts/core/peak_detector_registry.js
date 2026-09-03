// ---------------------------------------------------------------------------
// peak_detector_registry.js
// The plug-and-play catalog of interchangeable peak-detection algorithms.
// Every entry shares the SAME contract: (y, fs) -> {peakIndices, steps} --
// that shared shape is exactly what makes them swappable in Stage 2's slot
// without touching stage_renderers.js at all.
//
// Pure client-side data, deliberately not backend-hosted -- none of the
// real justifications for a server-side registry apply yet (no redeploy-
// free editing need, no other consumer, no per-user gating, no analytics).
// Same reasoning already applied to SPEED_MODES/THEMES.
//
// IDs are stable strings, not array positions -- a future shareable link
// ("sample X + hamilton-tompkins") stays correct even if a third detector
// gets added later at a different array index.
// ---------------------------------------------------------------------------

const PEAK_DETECTORS = [
    { id: "pan-tompkins", label: "PT", fullName: "Pan-Tompkins", detect: panTompkinsDetectPeaks },
    { id: "hamilton-tompkins", label: "HT", fullName: "Hamilton-Tompkins", detect: hamiltonTompkinsDetectPeaks },
];

let selectedDetectorId = "pan-tompkins";

function getSelectedDetector() {
    return PEAK_DETECTORS.find(d => d.id === selectedDetectorId) || PEAK_DETECTORS[0];
}

// Same cycling pattern as cycleSpeedMode()/cycleTheme() -- tap advances to
// the next entry and wraps around. Replaces an earlier bubble-menu popup
// that was visually inconsistent with how every other rail control behaves.
function cyclePeakDetector() {
    const currentIndex = PEAK_DETECTORS.findIndex(d => d.id === selectedDetectorId);
    const nextDetector = PEAK_DETECTORS[(currentIndex + 1) % PEAK_DETECTORS.length];
    selectedDetectorId = nextDetector.id;

    // Changing the algorithm changes Stage 2's OUTPUT -- every sample's
    // cached Stage 2 (and downstream Stage 3/4) result is now stale. This
    // is a GLOBAL choice (like Speed/Theme), not per-sample (like Invert),
    // so every cached sample needs invalidating, not just one.
    if (typeof invalidateFromStageForAllSamples === "function") {
        invalidateFromStageForAllSamples(2);
    }

    document.querySelectorAll(".rail-algo-label").forEach(el => {
        el.textContent = nextDetector.label;
    });

    if (typeof currentlyVisibleController !== "undefined" && currentlyVisibleController) {
        currentlyVisibleController.refreshActiveStage();
    }
}