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
// SPEED -- three real states, cycled via the rail's speed button. Only
// stage 0 (the sweep) is affected right now.
// ---------------------------------------------------------------------------
const SPEED_MODES = [
    { label: "1×", duration: () => STAGE_DURATIONS_MS[0] },
    { label: "3×", duration: () => STAGE_DURATIONS_MS[0] * 3 },
    { label: "Real", duration: (sampleId) => recordingDurationMs.get(sampleId) ?? STAGE_DURATIONS_MS[0] },
];
let speedModeIndex = 2; // default to "Real"

// ---------------------------------------------------------------------------
// TRACE COLOR -- a cycling palette (rail's color button). Deliberately
// excludes the UI's own green (--accent) so the data trace never looks
// like an interactive control.
// ---------------------------------------------------------------------------
const TRACE_COLORS = ["#4fd1ff", "#ffb84f", "#ffffff", "#ff6ec7"]; // cyan, amber, white, pink
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
    if (stageIdx === 0) {
        return SPEED_MODES[speedModeIndex].duration(sampleId);
    }
    return STAGE_DURATIONS_MS[stageIdx] ?? DEFAULT_STAGE_DURATION_MS;
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
    if (currentlyVisibleController) currentlyVisibleController.refreshStage0IfActive();
}

function cycleTraceColor() {
    colorIndex = (colorIndex + 1) % TRACE_COLORS.length;
    document.documentElement.style.setProperty("--ecg-trace-color", TRACE_COLORS[colorIndex]);
    document.querySelectorAll(".rail-color .swatch-dot").forEach(dot => {
        dot.style.setProperty("--swatch", TRACE_COLORS[colorIndex]);
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
