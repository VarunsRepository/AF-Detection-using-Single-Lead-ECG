// ---------------------------------------------------------------------------
// rail_controls.js
// Theme data + cycling logic, integrated with the CURRENT dispatcher/
// journey_interpreter.js architecture.
//
// This file previously carried a large amount of dead code left over from
// an earlier, deleted system (STAGE_DURATIONS_MS, SPEED_MODES,
// invertedSamples, cycleSpeedMode(), toggleInvert(), a cycleTheme() that
// referenced a `currentlyVisibleController` object that doesn't exist
// anywhere in the current codebase). None of that integrated with the
// current dispatcher/journey_interpreter.js flow -- speed and invert are
// both handled entirely differently now (see journey_interpreter.js's
// GLOBAL_SPEED_OPTIONS, and dspEngine.setParameter). That dead code has
// been removed; only THEMES/themeIndex (already real dependencies of
// shared_signal_utils.js) and a genuinely rewritten cycleTheme() remain.
// ---------------------------------------------------------------------------

// THEME -- one merged control: each entry bundles a background AND a trace
// color together as a single, coherent look, rather than picking them
// independently. There's deliberately only ONE background per theme now
// (not separate bg/cardBg shades as originally listed) -- the card and
// chart backgrounds must match exactly for the seamless, fused look the
// app now uses; two near-identical-but-different darks would silently
// reintroduce a visible seam between them.
const THEMES = [
    {
        label: "Clinical",
        bg: "#000000",          // true black -- what an actual diagnostic monitor looks like
        traceColor: "#e8f4f8",  // near-white, cool cyan-white -- classic phosphor/oscilloscope trace, no-nonsense
        gridColor: "rgba(116, 125, 140, 0.18)",     // neutral, muted -- a reference, not a statement
        zeroLineColor: "rgba(116, 125, 140, 0.4)",
    },
    {
        label: "Vivid",
        bg: "#0d0a14",          // still dark, a hint of purple undertone -- more personality, not brighter
        traceColor: "#2dd4bf",  // teal -- more visually engaging than Clinical's stark white
        gridColor: "rgba(255, 45, 175, 0.18)",      // hot magenta -- teal trace + pink grid is the classic Vice City neon duo
        zeroLineColor: "rgba(255, 45, 175, 0.45)",
    },
    {
        label: "Experimental",
        bg: "#0a0e14",          // dark navy-black -- the deliberately-provisional slot, expect this one to change as we try things
        traceColor: "#d9a441",  // amber gold
        gridColor: "rgba(116, 125, 140, 0.18)",     // same neutral grid as Clinical for now -- easy to change later, this whole theme is the sandbox
        zeroLineColor: "rgba(116, 125, 140, 0.4)",
    },
    {
        // Weyland-Yutani terminal: amber phosphor, green sub-systems,
        // scanlines. Renderers that support it check for this label and
        // switch palette; the rest simply use its colours like any other
        // theme, so nothing breaks on a card that has no CRT treatment.
        label: "Romulus",
        bg: "#020503",
        traceColor: "#ff9900",
        gridColor: "rgba(87, 227, 137, 0.10)",
        zeroLineColor: "rgba(87, 227, 137, 0.35)",
    },
];
let themeIndex = 0; // default to "Clinical" -- shared_signal_utils.js reads THEMES[themeIndex].traceColor directly at render time

// Converts a "#rrggbb" hex color into an "r, g, b" triplet string, so the
// glow's alpha (opacity) can be controlled independently of the theme's
// own solid trace color -- CSS custom properties can't do this kind of
// string math themselves, so it has to happen here in JS.
function hexToRgbTriplet(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
}

// Applies a theme's full set of CSS custom properties -- called once on
// load (via applyCurrentTheme()) and again every time cycleTheme() runs.
// Pulled into its own function so both call sites share IDENTICAL logic;
// applying only PART of a theme's variables on load, and the rest only on
// cycle, would be an easy, subtle way for the visuals to start out
// inconsistent with what a cycle later produces.
function applyThemeVariables(theme) {
    document.documentElement.style.setProperty("--bg", theme.bg);
    document.documentElement.style.setProperty("--grid-color", theme.gridColor);
    document.documentElement.style.setProperty("--zero-line-color", theme.zeroLineColor);
    document.documentElement.style.setProperty("--ecg-glow-color", `rgba(${hexToRgbTriplet(theme.traceColor)}, 0.7)`);
}

// Called once, on page load (see journey_page.html) -- ensures the CSS
// variables buildChartLayout() and the glow filter depend on are actually
// DEFINED before the first render, rather than resolving to an empty
// string.
function applyCurrentTheme() {
    applyThemeVariables(THEMES[themeIndex]);
}

// The actual dispatcher-facing action -- wired to the "journey" target's
// cycleTheme method (journey_interpreter.js), same pattern as cycleSpeed.
// Only updates STATE and CSS variables here; the rail button's own click
// handler (already existing, shared by every rail action) is what
// actually triggers the re-render that picks up the new trace color.
function cycleTheme() {
    themeIndex = (themeIndex + 1) % THEMES.length;
    applyThemeVariables(THEMES[themeIndex]);
}

function getActiveThemeLabel() {
    return THEMES[themeIndex].label;
}
