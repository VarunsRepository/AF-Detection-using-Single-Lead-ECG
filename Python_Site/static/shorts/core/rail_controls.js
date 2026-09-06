// ---------------------------------------------------------------------------
// rail_controls.js
// State and cycle logic for the four right-side rail controls: Speed,
// Color, Invert, Theme. Also owns getStageDuration(), since that's really
// just "how long should this stage run, given the current speed setting" --
// used by both stage_renderers.js (the sweep's timing) and stage_machine.js
// (the auto-advance timer + fill-bar animation), so it lives here rather
// than being duplicated or arbitrarily placed in either of those.
// ---------------------------------------------------------------------------

// Per-stage durations, in ms. Stage 0 (raw sweep) gets a bit longer since
// it's the one stage actively "drawing" rather than just revealing a
// number/badge. Verdict (last stage) never auto-advances regardless of what
// duration is listed here -- onTapRight already stops the timer once it
// reaches the final stage, so its duration value is unused in practice.
const STAGE_DURATIONS_MS = [2800, 2000, 2500, 2200, 2000];
const DEFAULT_STAGE_DURATION_MS = 2200; // fallback if a card has more stages than durations listed

// Each sample's real recording length, in ms, populated the first time its
// raw signal is fetched. Needed regardless of speed mode, since "Real-time"
// mode has no single fixed number -- every recording is a different length.
const recordingDurationMs = new Map();

// ---------------------------------------------------------------------------
// SPEED -- three real states, cycled via the rail's speed button. Applies
// UNIFORMLY across every stage that has real sweep animation (currently 0
// and 2; future animated stages get this automatically too) -- this is a
// global pace preference, not something scoped to any one stage.
// ---------------------------------------------------------------------------
const SPEED_MODES = [
    { label: "1×", duration: (sampleId, stageIdx) => STAGE_DURATIONS_MS[stageIdx] ?? DEFAULT_STAGE_DURATION_MS },
    { label: "3×", duration: (sampleId, stageIdx) => (STAGE_DURATIONS_MS[stageIdx] ?? DEFAULT_STAGE_DURATION_MS) * 3 },
    { label: "Real", duration: (sampleId, stageIdx) => recordingDurationMs.get(sampleId) ?? (STAGE_DURATIONS_MS[stageIdx] ?? DEFAULT_STAGE_DURATION_MS) },
];
let speedModeIndex = 2; // default to "Real"

// ---------------------------------------------------------------------------
// THEME -- one merged control now, not two separate ones. Each entry bundles
// a background AND a trace color together as a single, coherent look,
// rather than letting them be picked independently (which made it easy to
// land on combinations nobody actually chose on purpose). Background stays
// dark across all three, deliberately -- that part isn't negotiable, real
// diagnostic monitors are near-black for a reason (contrast, eye strain in
// a dim room). What varies is HUE and trace color, not brightness.
// ---------------------------------------------------------------------------
const THEMES = [
    {
        label: "Clinical",
        bg: "#000000",          // true black -- what an actual diagnostic monitor looks like
        cardBg: "#0a0a0a",
        traceColor: "#e8f4f8",  // near-white, cool cyan-white -- classic phosphor/oscilloscope trace, no-nonsense
        gridColor: "rgba(116, 125, 140, 0.18)",     // neutral, muted -- a reference, not a statement
        zeroLineColor: "rgba(116, 125, 140, 0.4)",
    },
    {
        label: "Vivid",
        bg: "#0d0a14",          // still dark, a hint of purple undertone -- more personality, not brighter
        cardBg: "#171226",
        traceColor: "#2dd4bf",  // teal -- more visually engaging than Clinical's stark white
        gridColor: "rgba(255, 45, 175, 0.18)",      // hot magenta -- teal trace + pink grid is the classic Vice City neon duo
        zeroLineColor: "rgba(255, 45, 175, 0.45)",
    },
    {
        label: "Experimental",
        bg: "#0a0e14",          // dark navy-black -- the deliberately-provisional slot, expect this one to change as we try things
        cardBg: "#131a24",
        traceColor: "#d9a441",  // amber gold
        gridColor: "rgba(116, 125, 140, 0.18)",     // same neutral grid as Clinical for now -- easy to change later, this whole theme is the sandbox
        zeroLineColor: "rgba(116, 125, 140, 0.4)",
    },
];
let themeIndex = 0; // default to "Clinical" -- the serious baseline

// ---------------------------------------------------------------------------
// INVERSION -- per-sample, not global (unlike speed/theme). Flips the
// signal's polarity for whichever specific recordings this is toggled on
// for. This is a manual, on-demand preview of exactly what the future
// Stage 1 "orientation correction" filter will eventually do automatically.
// ---------------------------------------------------------------------------
const invertedSamples = new Set();

function getStageDuration(stageIdx, sampleId) {
    return SPEED_MODES[speedModeIndex].duration(sampleId, stageIdx);
}

function cycleTheme() {
    themeIndex = (themeIndex + 1) % THEMES.length;
    const theme = THEMES[themeIndex];

    document.documentElement.style.setProperty("--bg", theme.bg);
    document.documentElement.style.setProperty("--card-bg", theme.cardBg);
    document.documentElement.style.setProperty("--ecg-trace-color", theme.traceColor);
    document.documentElement.style.setProperty("--grid-color", theme.gridColor);
    document.documentElement.style.setProperty("--zero-line-color", theme.zeroLineColor);

    document.querySelectorAll(".rail-theme .swatch-dot").forEach(dot => {
        dot.style.setProperty("--swatch", theme.traceColor); // swatch shows the TRACE color -- the more visually distinctive half of the pair
    });
    document.querySelectorAll(".rail-theme").forEach(btn => {
        btn.title = `Theme (${theme.label})`;
    });

    // unlike the old background-only toggle, this NOW changes the trace
    // color AND grid colors too -- all of which the currently visible chart
    // needs to redraw to pick up, so (unlike the original design) this
    // needs to trigger a refresh
    if (currentlyVisibleController) currentlyVisibleController.refreshActiveStage();
}

function cycleSpeedMode() {
    speedModeIndex = (speedModeIndex + 1) % SPEED_MODES.length;
    document.querySelectorAll(".rail-speed-label").forEach(label => {
        label.textContent = SPEED_MODES[speedModeIndex].label;
    });
    if (currentlyVisibleController) currentlyVisibleController.refreshActiveStage();
}

function toggleInvert(sampleId) {
    if (invertedSamples.has(sampleId)) {
        invertedSamples.delete(sampleId);
    } else {
        invertedSamples.add(sampleId);
    }

    // Flipping polarity changes Stage 0's OUTPUT -- every downstream stage
    // (Stage 2's peak positions, and future RR/Poincaré stages) was computed
    // from the OLD polarity and is now stale for this sample. Without this,
    // the engine's caching would silently keep showing pre-invert peaks on
    // the now-inverted trace -- a real correctness bug the cache introduces
    // if this call is missing, not just a missed optimization.
    invalidateFromStage("ecg", sampleId, 0);

    // only THIS sample's rail button reflects the change -- invert is
    // per-sample, unlike speed/color which are global
    document.querySelectorAll(`.card[data-sample-id="${sampleId}"] .rail-invert`).forEach(btn => {
        btn.setAttribute("aria-pressed", invertedSamples.has(sampleId));
    });
    if (currentlyVisibleController && currentlyVisibleController.sampleId === sampleId) {
        currentlyVisibleController.refreshActiveStage();
    }
}