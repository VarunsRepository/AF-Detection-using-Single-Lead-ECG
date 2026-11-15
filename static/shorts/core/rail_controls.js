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
//
// ── THEMES CARRY LOOK. DEPTH CARRIES HAND-HOLDING. ─────────────────────
// A theme declares colours, weights, effects, and `glyphs` -- what an
// annotation's ROLE looks like in this theme. It no longer declares
// helpLevel or termLevel; DEPTH_LEVELS below owns those.
//
// THE ARGUMENT THAT USED TO LIVE HERE WAS RIGHT AND DREW THE WRONG
// CONCLUSION. It said look and hand-holding are genuinely different axes,
// and that welding them makes two of the four combinations unreachable --
// the clinician meeting Pan-Tompkins who wants the sober look AND the
// pointers, the reader who knows ECG cold and likes the neon. Correct.
// Then it kept them as two keys on ONE control, which is the welding it
// had just finished arguing against: picking a look still forced a level
// of explanation, and the only route to plain English ran through
// Arcade's purple.
//
// The combinations are unreachable because there was one dial, not
// because there was one key. So there are two dials now. A theme is a
// look; Depth is how much the app explains itself. Five looks times
// three depths is fifteen combinations from eight entries, and
// `clinical_guided` stops needing to exist at all -- it is Clinical with
// Depth turned up.
//
// WHAT STAYS WITH THE THEME, and why: `glyphs`. Whether a pointer is a
// drawn caret or a 👇 is a LOOK decision -- Arcade's emoji are its
// aesthetic, not a different quantity of help. Depth decides how many
// marks appear; the theme decides what they are made of.
//
// ── ONE PATH FOR THEME VALUES: CSS CUSTOM PROPERTIES ───────────────────
// Every themeable value is published as a CSS variable by
// applyThemeVariables(), and EVERYTHING reads it back from there -- CSS
// rules directly, canvas renderers through themeColor()/themeNumber().
//
// WHY: there used to be two paths. Renderers reached into
// THEMES[themeIndex] for traceColor and traceWidth while reading
// --grid-color and --ecg-glow-color via getComputedStyle, in the same
// file, for the same concept. Two mechanisms for one idea is a standing
// invitation to drift, and it meant anything DOM-styled could only be
// themed by adding renderer code.
//
// With one path, a new themeable value is: a key here, a line in
// THEME_VARS, and a var() in the stylesheet. No renderer changes.
//
// ── THEMES NOW ALSO CARRY TRACE WEIGHT ─────────────────────────────────
//   traceWidth       CSS px for the signal line (renderers scale by DPR)
//   glowBlur         CSS px of shadow blur; 0 disables the glow pass
//   peakMarkerColor  the detected-feature dot
//
// peakMarkerColor moved here from the RECIPES, where it lived as
// globalThemes.palette.accent and was copied into the renderer config by
// applyTheme(). That was per-journey styling, and it is why the peak dot
// stayed the same orange on every theme -- the marker is the exact thing
// an annotation points AT, so it ignoring the theme was closer to a bug
// than a gap. Styling is global; journeys pick a theme, they do not
// define colours.
//
// Recipes may still carry globalThemes.palette and nothing breaks -- the
// renderer now prefers the theme's value and falls back to the recipe's,
// so no recipe needs editing and they can be cleaned up lazily.
//
// These were hardcoded in each renderer (1.8 and 8), so a theme could
// change the trace's COLOUR but not its WEIGHT -- which is most of what
// makes a look feel loud or clinical. Every existing theme below declares
// exactly the old hardcoded numbers, so none of them changes appearance;
// only the new Arcade entry uses the dial.
//
// Thickness has a real ceiling. On a ~390px card the QRS complex is only
// about 12px wide, so up to ~3.5px reads as bold and past ~5px the S-T
// segment shape starts to disappear -- at which point the theme is
// shouting over the thing it is meant to be showing. Thickness and glow
// also multiply: a thick line with a wide blur is a luminous blob, not a
// trace, which is why Arcade thickens the line and REDUCES the glow.
//
// ROLE VOCABULARY -- every theme should define every role:
//   point_at   "look here" -- the strongest attention mark available
//   peak       "this specific feature is the thing being detected"
//
//   A theme that omits one still works (annotation_layer falls back to a
//   plain caret and warns), because losing the EXPLANATION is a worse
//   and far less visible failure than losing the STYLE -- the card looks
//   perfectly fine and simply teaches less. The fallback is a safety net,
//   not a licence to leave roles out.
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

        traceWidth: 1.8,
        glowBlur: 8,
        // The orange every journey's recipe was already specifying, so
        // Clinical is unchanged.
        peakMarkerColor: "#eb7b2b",
        glyphs: {
            // A caliper tick and a letter -- how a measurement is marked
            // on a real trace. Still unmistakably saying "this one":
            // clinical means sober, not unlabelled. No motion, because
            // the stillness is the register this theme is going for.
            point_at: { kind: "svg", mark: "tick", motion: "none",
                        label: "R", labelPlain: "peak" },
            peak:     { kind: "svg", mark: "ring", motion: "none" },
        },
    },
    {
        // ── PLAIN ───────────────────────────────────────────────────────
        // REPURPOSED, and the rename is the honest part: as "Vivid" this
        // slot was a dimmer Arcade -- both loud, both heavy help, both
        // emoji -- so it taught nothing the other two did not, and four
        // overlapping loud themes make the comparison useless rather than
        // richer.
        //
        // Its job was the one combination nothing else could reach:
        // SOBER LOOK, PLAIN WORDS.
        //
        // DEPTH HAS TAKEN THAT JOB, and this theme is better for it. Any
        // theme can now have plain words, so this one is free to be only
        // what its name says: the softest sober look, for someone who
        // finds Clinical's stark white harsh. It no longer smuggles a
        // reading level in with a palette.
        //
        // Kept rather than merged into Clinical because the two really do
        // look different -- #e8f4f8 on true black against #7fd4e8 on a
        // warmer ground -- and one of them is easier to look at for a
        // while.
        label: "Plain",
        bg: "#0b0f14",          // near-black, a touch warmer than Clinical
        traceColor: "#7fd4e8",  // soft cyan -- easier on the eye than
                                // Clinical's stark white, still sober
        gridColor: "rgba(116, 125, 140, 0.18)",
        zeroLineColor: "rgba(116, 125, 140, 0.4)",

        traceWidth: 2.0,        // a hair heavier: this is the theme for
                                // someone who has not read a trace before
        glowBlur: 8,
        peakMarkerColor: "#eb7b2b",

        glyphs: {
            // Drawn marks, NOT emoji. The distinction this theme exists to
            // make is about WORDS, not decoration -- putting hands on the
            // plot here would confound it with Arcade and lose the clean
            // comparison the repurpose was for.
            point_at: { kind: "svg", mark: "caret", motion: "bob",
                        label: "R", labelPlain: "peak" },
            peak:     { kind: "svg", mark: "ring", motion: "none" },
        },
    },
    {
        label: "Experimental",
        bg: "#0a0e14",          // dark navy-black -- the deliberately-provisional slot, expect this one to change as we try things
        traceColor: "#d9a441",  // amber gold
        gridColor: "rgba(116, 125, 140, 0.18)",     // same neutral grid as Clinical for now -- easy to change later, this whole theme is the sandbox
        zeroLineColor: "rgba(116, 125, 140, 0.4)",

        traceWidth: 1.8,
        glowBlur: 8,
        // Unchanged: this is the control condition, so it should differ
        // from Arcade in ONE variable (the glyphs) and nothing else.
        peakMarkerColor: "#eb7b2b",
        glyphs: {
            // The middle setting worth testing: heavy help WITHOUT emoji.
            // If completion improves here as much as on Vivid, then the
            // motion was doing the work and the emoji were decoration --
            // which is the actual question behind this whole feature, and
            // this theme is where the answer shows up.
            point_at: { kind: "svg", mark: "caret", motion: "bob",
                        label: "R", labelPlain: "peak" },
            peak:     { kind: "svg", mark: "ring", motion: "pulse" },
        },
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

        traceWidth: 1.8,
        glowBlur: 8,
        // CHANGES APPEARANCE: the terminal's own green sub-system colour,
        // matching the glyphs below, instead of an orange inherited from
        // whichever recipe happened to be running.
        peakMarkerColor: "#57e389",
        // CHANGES APPEARANCE, and only because this theme's own comment
        // has promised scanlines since it was written -- they were never
        // implementable before the effects layer existed. Implementing a
        // documented intent rather than inventing a new one. Kept low:
        // a CRT look is texture, and the amber trace has to stay readable
        // through it.
        scanlineOpacity: 0.08,
        vignetteOpacity: 0.30,
        axisLabelColor:  "#57e389",
        accent:          "#57e389",
        panelEdge:       "rgba(87, 227, 137, 0.35)",
        panelShadow:     "0 2px 10px rgba(0, 0, 0, 0.7)",
        glyphs: {
            // Green sub-system amber, matching the terminal's own
            // convention rather than the trace colour -- this is the one
            // theme where the mark reading as part of the instrument
            // matters more than it reading as an overlay.
            point_at: { kind: "svg", mark: "tick", motion: "none",
                        label: "R", labelPlain: "peak", color: "#57e389" },
            peak:     { kind: "svg", mark: "ring", motion: "none",
                        color: "#57e389" },
        },
    },
    {
        // ── ARCADE ──────────────────────────────────────────────────────
        // The far end of the axis, on purpose. Clinical is sober with
        // light help, Experimental is heavy help with no emoji, and this
        // is heavy help with maximal emoji -- three points on ONE line,
        // which is what makes the comparison mean something. If Arcade
        // and Experimental perform the same, the MOTION was doing the
        // work and the emoji were decoration. That is the question this
        // whole feature exists to answer, and it needs this third point
        // to be answerable at all.
        //
        // Rename freely -- the label is the only place it appears.
        label: "Arcade",
        bg: "#120018",          // deep purple-black: emoji are full-colour
                                // art and need a dark, low-chroma ground or
                                // they fight the trace for attention
        traceColor: "#ffd23f",  // amber-yellow -- the highest-contrast
                                // choice against the purple, and it stays
                                // legible at 3.4px where a pale colour
                                // would read as a smear
        gridColor: "rgba(255, 45, 175, 0.22)",      // hot magenta, louder than Vivid's
        zeroLineColor: "rgba(255, 45, 175, 0.5)",

        // Thick, but short of the ~3.5px ceiling where S-T shape starts to
        // go. Glow comes DOWN from 8 to 4 to compensate: at this weight
        // the old blur turns the line into a glowing tube.
        traceWidth: 3.4,
        glowBlur: 4,
        // Hot pink against the amber trace -- the dot has to stay findable
        // at this trace weight, and an orange dot on an amber line is
        // close to invisible.
        peakMarkerColor: "#ff3d7f",

        // ── THE FURNITURE, where the card actually yells ────────────────
        // Everything above this line is the plot, which is a minority of
        // the screen. These are the keys doing the work.
        //
        // Weight, not typeface. Swapping the prose to something rounder
        // was tempting and wrong: a card's description carries byte
        // counts, timings and figures, and a proportional face with
        // non-tabular digits turns a column of values into a ragged mess.
        // Loud is a matter of weight and colour.
        titleWeight:     "900",
        cardBg:          "#120018",
        textColor:       "#ffe9a8",
        textDim:         "#c89bd8",
        proseDim:        "#e3c5f0",   // still well clear of AA on the panel
        accent:          "#ff3d7f",   // focus rings, :active states, hints
        border:          "#ff3d7f",
        // The sheet, rail, chip and back button all draw from these, so
        // five values restyle every piece of furniture at once. Purple
        // glass with a hot edge, against the default slate.
        panel:           "rgba(44, 8, 58, 0.92)",
        panelDeep:       "rgba(18, 0, 24, 0.98)",
        panelEdge:       "rgba(255, 61, 127, 0.45)",
        panelEdgeStrong: "rgba(255, 210, 63, 0.75)",
        panelShadow:     "0 2px 14px rgba(255, 61, 127, 0.35)",
        // Squared off, against every other theme's circles. A shape change
        // reads as a different machine in a way another colour does not.
        railRadius:      "10px",
        axisLabelColor:  "#ff2daf",

        // Effects on, and deliberately moderate. Scanlines at 0.10 read as
        // texture; at 0.3 they read as a broken screen, and the trace is
        // still the content. The pulse is the one to spend on, because it
        // is the only effect that is ABOUT the signal rather than painted
        // over it.
        scanlineOpacity: 0.10,
        vignetteOpacity: 0.35,
        pulseStrength:   0.55,

        glyphs: {
            // Both chosen for cross-platform safety as much as meaning.
            // 👇 (U+1F447) and 💓 (U+1F493) are early, single-codepoint
            // emoji present in every emoji font shipped this decade. A
            // theme built ON emoji has far more exposure to the
            // per-platform problem than a single mark does, and newer or
            // ZWJ-compound emoji fall back to a hollow box on older
            // Androids -- a theme of hollow boxes being worse than no
            // theme at all.
            point_at: { kind: "text", mark: "👇", motion: "bob" },
            peak:     { kind: "text", mark: "💓", motion: "pulse" },
        },
    },
];
let themeIndex = 0; // default to "Clinical" -- shared_signal_utils.js reads THEMES[themeIndex].traceColor directly at render time

// ── DEPTH: HOW MUCH THE APP EXPLAINS ITSELF ─────────────────────────────
// The third global control, beside Speed and Theme. One dial, three
// stops, and it answers exactly one question -- how much help do you
// want -- where previously that answer was a side effect of picking a
// colour scheme.
//
// WHAT IT REPLACES
//   theme.helpLevel      how many annotation marks appear
//   theme.termLevel      jargon or plain wording in the prose
//   showGlossary         exchange_view's own Defs button, retired
//
// Those were three controls for one question, in three different files,
// with two of them welded to the look. The Defs button was the giveaway:
// a control literally named after terms that could not change a single
// word, sitting next to a Theme button that silently could.
//
// ORDERED BY HOW MUCH HELP, LEAST FIRST, so cycling is a ladder rather
// than a shuffle. index 0 reproduces exactly what Clinical did before
// this change, which is what keeps the app's default behaviour identical.
//
// THE THREE STOPS ARE THE THREE COMBINATIONS THAT EXIST. A fourth --
// plain words with no pointers -- was considered and left out: plain
// naming is for someone meeting the material, and the pointers are the
// cheapest help there is, so the combination has no reader.
const DEPTH_LEVELS = [
    {
        id: "basic",
        // Shown under the rail glyph, so it has to fit ~6 characters at
        // 9px. These are deliberately NOT "off/on": nothing is off here,
        // and a reader who sees OFF expects the marks to disappear.
        label: "Basic",
        helpLevel: "light",
        termLevel: "full",
        // The definitions strip at the foot of a BLE card.
        showDefs: false,
    },
    {
        id: "guided",
        label: "Guided",
        helpLevel: "heavy",
        termLevel: "full",
        showDefs: true,
    },
    {
        id: "simple",
        label: "Simple",
        helpLevel: "heavy",
        termLevel: "plain",
        showDefs: true,
    },
];

let depthIndex = 0;   // "basic" -- identical to the old Clinical default

// ── THE RECIPE PROPOSES, THE VIEWER DECIDES ─────────────────────────────
// A journey may declare its own starting depth, because a journey knows
// its own difficulty: BLE is six stages of acronyms and genuinely wants
// to open at "simple", while an ECG sweep does not.
//
// But the recipe must not OWN the value. Depth is global, like Speed, so
// if each recipe set it outright then scrolling from a BLE card to an ECG
// card would silently undo a choice the viewer had just made -- which is
// the exact bug Speed was moved to module level to fix.
//
// So: honoured on entry, ignored for ever after the first tap.
let depthTouched = false;

function setDepthDefault(id) {
    if (depthTouched) return;
    const i = DEPTH_LEVELS.findIndex(d => d.id === id);
    if (i >= 0) depthIndex = i;
    applyDepthVariables();
}

function cycleDepth() {
    depthTouched = true;
    depthIndex = (depthIndex + 1) % DEPTH_LEVELS.length;
    applyDepthVariables();
}

function getActiveDepth() {
    return DEPTH_LEVELS[depthIndex];
}

function getActiveDepthLabel() {
    return DEPTH_LEVELS[depthIndex].label;
}

// TWO VARIABLES, and only two, for one dial.
//
//   --term-level   "full" | "plain"
//                  Already read by journey_interpreter's fill() and by
//                  annotation_layer. Kept under its existing name
//                  precisely so neither of those files has to change --
//                  they do not care who writes it.
//
//   --depth-level  "basic" | "guided" | "simple"
//                  The dial itself, for anything that needs more than
//                  the wording. exchange_view reads it to decide whether
//                  the definitions strip appears.
//
// helpLevel deliberately gets NO variable: annotation_layer reads it off
// the theme object via getActiveVisualTheme(), so injecting it there
// (see below) means that file needs no change either.
function applyDepthVariables() {
    const d = DEPTH_LEVELS[depthIndex];
    const root = document.documentElement;
    root.style.setProperty("--term-level", d.termLevel);
    root.style.setProperty("--depth-level", d.id);
}

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

// ── THE ONE TABLE ───────────────────────────────────────────────────────
// Every themeable value, and the CSS variable it is published as. This is
// the whole contract: add a key to the themes above, add a line here, and
// it is themeable from CSS and from canvas alike.
//
// Kept as a table rather than a run of setProperty calls so that "what is
// themeable" is one readable list rather than something you reconstruct by
// reading a function body. It is also what made the old bug obvious: four
// values were here and three more were being read straight off the theme
// object elsewhere.
const THEME_VARS = {
    // ── the plot ────────────────────────────────────────────────────────
    "--bg":                t => t.bg,
    "--grid-color":        t => t.gridColor,
    "--zero-line-color":   t => t.zeroLineColor,
    "--trace-color":       t => t.traceColor,
    "--trace-width":       t => t.traceWidth,
    "--glow-blur":         t => t.glowBlur,
    "--peak-marker-color": t => t.peakMarkerColor,
    // Derived rather than stored: the glow is the trace colour at a fixed
    // alpha, and storing it separately would mean two values to keep in
    // step every time a theme's trace colour changed.
    "--ecg-glow-color":    t => `rgba(${hexToRgbTriplet(t.traceColor)}, 0.7)`,

    // ── the furniture ───────────────────────────────────────────────────
    // This is where a theme actually shouts. The plot is a minority of the
    // card; the sheet, the rail and the chip are most of what a viewer
    // looks at, and none of it was themeable at all.
    //
    // THESE ARE THE STYLESHEET'S OWN TOKEN NAMES, NOT NEW ONES.
    // shorts_feed.css already defines --panel / --panel-edge /
    // --panel-shadow in a :root block and builds the sheet, the rail
    // buttons, the "more from" chip and the back button out of them -- its
    // own comment calls it "one material". --accent, --text, --text-dim,
    // --border and --card-bg are likewise already used throughout.
    //
    // Writing the EXISTING names means an inline style on
    // documentElement, which beats a :root rule -- so the whole
    // stylesheet is themed without a single edit to it. Inventing
    // --rail-fill and friends would have meant rewriting every rule to
    // read the new name, and leaving two vocabularies for one idea.
    //
    // The lesson, worth keeping: before adding a design token, check
    // whether the stylesheet already has one.
    "--card-bg":           t => t.cardBg,
    "--text":              t => t.textColor,
    "--text-dim":          t => t.textDim,
    "--accent":            t => t.accent,
    "--border":            t => t.border,
    "--panel":             t => t.panel,
    "--panel-deep":        t => t.panelDeep,
    "--panel-edge":        t => t.panelEdge,
    "--panel-edge-strong": t => t.panelEdgeStrong,
    "--panel-shadow":      t => t.panelShadow,
    // The live colour dot on the Theme button. Already read by
    // .swatch-dot, already falling back to a hardcoded cyan.
    "--swatch":            t => t.traceColor,

    // ── genuinely new, and the only four the stylesheet must learn ──────
    // Each replaces a value that is hardcoded rather than tokenised:
    // 'Roboto' and 700 on .stage-sheet .stage-title, #9aa4b0 on
    // .stage-description, and 50% on .rail-btn.
    "--title-font":        t => t.titleFont,
    "--title-weight":      t => t.titleWeight,
    "--prose-font":        t => t.proseFont,
    "--prose-dim":         t => t.proseDim,
    "--rail-radius":       t => t.railRadius,

    // ── the axis layer ──────────────────────────────────────────────────
    // Read by JS, not CSS, because two of the three axis layers are drawn
    // into a canvas (chart_v1_webgl) or built as absolutely-positioned
    // spans (chart_v1_canvas) rather than being styleable by a selector.
    "--axis-label-color":  t => t.axisLabelColor,
    "--axis-font":         t => t.axisFont,

    // ── effects (theme_effects.js) ──────────────────────────────────────
    // A theme opts in by declaring them; absent means no effects, which is
    // how the four sober themes stay sober without naming anything.
    "--scanline-opacity":  t => t.scanlineOpacity,
    "--vignette-opacity":  t => t.vignetteOpacity,
    "--pulse-strength":    t => t.pulseStrength,

    // ── register ────────────────────────────────────────────────────────
    // --term-level USED TO BE HERE, and that was the bug. A theme wrote
    // it, so the only way to read plain English was to accept Plain's or
    // Arcade's palette, and the rail button actually named after terms
    // could not change a single word.
    //
    // It is now written by applyDepthVariables() instead. The variable's
    // NAME is unchanged, so every reader -- fill(), annotation_layer --
    // works untouched. That is the point of having one path: the seam
    // moved and nothing that consumes it noticed.
};

// The furniture values every theme shares unless it says otherwise. Pulled
// out so the four pre-existing themes could gain ten keys without ten
// lines each, and so "what does a theme look like if it declares nothing"
// is one readable block rather than a hunt through fallbacks.
//
// These reproduce what shorts_feed.css and the renderers already hardcoded,
// so applying them changes nothing on screen.
// Every value here is copied from what shorts_feed.css or
// journey_page.html already declares, so applying them changes nothing on
// screen. Lifted verbatim rather than approximated -- a default that is
// nearly the old value is a restyle nobody asked for.
const THEME_DEFAULTS = {
    cardBg:          "#161b22",
    textColor:       "#d8dee9",
    textDim:         "#747d8c",
    accent:          "#5cc24a",
    border:          "#30363d",
    panel:           "rgba(22, 27, 34, 0.92)",
    panelDeep:       "rgba(13, 17, 23, 0.98)",
    panelEdge:       "rgba(255, 255, 255, 0.14)",
    panelEdgeStrong: "rgba(255, 255, 255, 0.30)",
    panelShadow:     "0 2px 10px rgba(0, 0, 0, 0.45)",
    titleFont:       "'Roboto', sans-serif",
    titleWeight:     "700",
    proseFont:       "'Roboto', sans-serif",
    // NOT --text-dim. The stylesheet's own comment explains why: #747d8c
    // measures 4.16:1 on the sheet panel and fails WCAG AA for body text,
    // so the description already uses this lifted value instead. Carried
    // across as a separate token so a theme cannot accidentally undo an
    // accessibility fix by setting textDim.
    proseDim:        "#9aa4b0",
    railRadius:      "50%",
    axisLabelColor:  "#747d8c",
    axisFont:        "'IBM Plex Mono', monospace",
    // termLevel is gone from here too -- DEPTH_LEVELS[0] carries the
    // "jargon by default" decision now, in one place rather than as a
    // default that a theme could override.
    // Effects off by default. A theme that wants them says so.
    scanlineOpacity: 0,
    vignetteOpacity: 0,
    pulseStrength:   0,
};

// Applies a theme's full set of CSS custom properties -- called once on
// load (via applyCurrentTheme()) and again every time cycleTheme() runs.
// Pulled into its own function so both call sites share IDENTICAL logic;
// applying only PART of a theme's variables on load, and the rest only on
// cycle, would be an easy, subtle way for the visuals to start out
// inconsistent with what a cycle later produces.
function applyThemeVariables(theme) {
    const root = document.documentElement;
    // Theme first, shared defaults behind it. A theme overrides only what
    // it names, so the four sober themes inherit the furniture unchanged
    // and Arcade overrides the handful it cares about.
    const resolved = { ...THEME_DEFAULTS, ...theme };
    for (const [varName, pick] of Object.entries(THEME_VARS)) {
        let value;
        try {
            value = pick(resolved);
        } catch (e) {
            // A theme missing a key it derives from should not take the
            // whole page's styling down with it.
            console.warn(`rail_controls: theme "${theme?.label}" could not supply ${varName}:`, e);
            continue;
        }
        // Skipped rather than written as "undefined", so the CSS and the
        // readers below fall through to their own defaults.
        if (value === undefined || value === null) continue;
        root.style.setProperty(varName, String(value));
    }
}

// ── READERS, for canvas ─────────────────────────────────────────────────
// CSS cannot style a canvas, so a canvas renderer has to read the variable
// and use it as a value. These two are the only sanctioned way to do that
// -- a renderer should never reach into THEMES[themeIndex] itself, or the
// second path is back.
//
// Pass the live CSSStyleDeclaration from a single getComputedStyle() call
// per render; calling it per value forces a style recalculation each time,
// which in a per-frame draw path is a real cost.
function themeStyles() {
    return getComputedStyle(document.documentElement);
}

function themeColor(styles, varName, fallback) {
    const v = styles.getPropertyValue(varName).trim();
    return v || fallback;
}

function themeNumber(styles, varName, fallback) {
    const raw = styles.getPropertyValue(varName).trim();
    if (!raw) return fallback;
    const n = parseFloat(raw);
    // NaN guard matters: a var set to a colour by mistake would otherwise
    // become a NaN line width, and canvas silently draws nothing at all
    // rather than throwing.
    return Number.isFinite(n) ? n : fallback;
}

// Called once, on page load (see journey_page.html) -- ensures the CSS
// variables buildChartLayout() and the glow filter depend on are actually
// DEFINED before the first render, rather than resolving to an empty
// string.
function applyCurrentTheme() {
    applyThemeVariables(THEMES[themeIndex]);
    // DEPTH TOO, from the same call site. journey_page.html calls this
    // one function on load, and adding a second required call would mean
    // every page that forgot it rendered with --term-level unset -- which
    // resolves to an empty string, which fill() reads as "not plain", so
    // the failure would look like a working app in jargon mode. One call
    // site, both dials.
    applyDepthVariables();
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

// The whole active THEMES entry, for anything that needs more than the
// label -- annotation_layer.js needs `glyphs` and `helpLevel`.
//
// NAMED getActiveVisualTheme, NOT getActiveTheme, deliberately. There is
// already a getActiveTheme() inside interpretJourney() that returns the
// RECIPE's globalThemes palette -- a completely different object. That one
// is function-scoped so the two would not actually collide, which is
// precisely what makes the clash dangerous: it would never throw, it would
// just silently hand back the wrong kind of theme object to whichever
// caller happened to be in the wrong scope. Two different concepts do not
// get to share a name.
function getActiveVisualTheme() {
    // helpLevel IS INJECTED, NOT STORED. The themes no longer declare it;
    // Depth owns it. Returning it on this object means annotation_layer.js
    // keeps reading `theme.helpLevel` exactly as it always has and needed
    // no edit at all.
    //
    // A shallow copy, so the returned object cannot be used to mutate a
    // THEMES entry -- a caller that wrote to .helpLevel would otherwise
    // permanently reassign a theme's help level for the session.
    return { ...THEMES[themeIndex], helpLevel: getActiveDepth().helpLevel };
}
