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
// TRACE COLOR -- a cycling palette (rail's color button). Deliberately
// excludes the UI's own green (--accent) so the data trace never looks
// like an interactive control.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// TRACE COLOR -- a cycling palette (rail's color button). Deliberately
// excludes the UI's own semantic colors (--accent green, --danger red,
// --warn gold) so picking a trace color never looks like a status
// indicator turning on. Chosen for a "serious instrument," not "pick your
// favorite crayon" feel -- muted, clinical-adjacent tones rather than
// bright/candy hues, while staying clearly distinct from one another.
const TRACE_COLORS = [
    "#2dd4bf", // teal -- calm, clinical; classic monitor-trace territory without being the exact ECG-monitor cliché green
    "#f0ede4", // ivory -- softer than stark white, easier on the eyes over a long viewing session
    "#d9a441", // amber gold -- warm, instrument-panel feel; kept visually distinct from --warn (#c98a1f)
    "#c96a4e", // muted terracotta -- a serious, warm red-adjacent tone; deliberately NOT bright pink, and distinct from --danger (#a32638)
];
let colorIndex = 0;

// ---------------------------------------------------------------------------
// BACKGROUND THEME -- three presets, cycled the same way as Speed/Color.
// Purely a display preference -- reversible, visible, no manipulation.
// ---------------------------------------------------------------------------
const THEME_PRESETS = [
    { label: "Charcoal", bg: "#0d1117", cardBg: "#161b22" },
    { label: "True Black", bg: "#000000", cardBg: "#0a0a0c" },
    { label: "Purple Black", bg: "#0e0a14", cardBg: "#1a1424" },
];
let themeIndex = 1; // default to "True Black"

// ---------------------------------------------------------------------------
// INVERSION -- per-sample, not global (unlike speed/color/theme). Flips the
// signal's polarity for whichever specific recordings this is toggled on
// for. This is a manual, on-demand preview of exactly what the future
// Stage 1 "orientation correction" filter will eventually do automatically.
// ---------------------------------------------------------------------------
const invertedSamples = new Set();

function getStageDuration(stageIdx, sampleId) {
    return SPEED_MODES[speedModeIndex].duration(sampleId, stageIdx);
}

function cycleTheme() {
    themeIndex = (themeIndex + 1) % THEME_PRESETS.length;
    const preset = THEME_PRESETS[themeIndex];
    // theme only touches CSS background variables -- no chart data is
    // affected, so unlike speed/color/invert this never needs a redraw
    document.documentElement.style.setProperty("--bg", preset.bg);
    document.documentElement.style.setProperty("--card-bg", preset.cardBg);
    document.querySelectorAll(".rail-theme .swatch-dot").forEach(dot => {
        dot.style.setProperty("--swatch", preset.bg);
    });
    document.querySelectorAll(".rail-theme").forEach(btn => {
        btn.title = `Background theme (${preset.label})`;
    });
}
 
function cycleSpeedMode() {
    speedModeIndex = (speedModeIndex + 1) % SPEED_MODES.length;
    document.querySelectorAll(".rail-speed-label").forEach(label => {
        label.textContent = SPEED_MODES[speedModeIndex].label;
    });
    if (currentlyVisibleController) currentlyVisibleController.refreshActiveStage();
}

function cycleTraceColor() {
    colorIndex = (colorIndex + 1) % TRACE_COLORS.length;
    document.documentElement.style.setProperty("--ecg-trace-color", TRACE_COLORS[colorIndex]);
    document.querySelectorAll(".rail-color .swatch-dot").forEach(dot => {
        dot.style.setProperty("--swatch", TRACE_COLORS[colorIndex]);
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
    invalidateFromStage(sampleId, 0);

    // only THIS sample's rail button reflects the change -- invert is
    // per-sample, unlike speed/color which are global
    document.querySelectorAll(`.card[data-sample-id="${sampleId}"] .rail-invert`).forEach(btn => {
        btn.setAttribute("aria-pressed", invertedSamples.has(sampleId));
    });
    if (currentlyVisibleController && currentlyVisibleController.sampleId === sampleId) {
        currentlyVisibleController.refreshActiveStage();
    }
}
