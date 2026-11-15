// ---------------------------------------------------------------------------
// journey_interpreter.js
// Extends the single-stage proof (stage_interpreter.js) to a real,
// multi-stage journey: resolves PREVIOUS_STAGE_PIPELINE data sources
// (Stage 2 consuming Stage 1's real rrIntervalsMs, not synthetic data),
// applies globalThemes across every stage, and provides the "journey"
// dispatch target (cycleSpeed) that stage-level buttons can target.
//
// Also implements journeyRules.autoAdvance (auto-moves to the next stage,
// cancelled cleanly if the user navigates manually first),
// journeyRules.preloadNextStage (background DSP warming), a real visual
// progress bar (uiShell.showProgressBar), and real pause/resume
// (playbackConfig.isPaused).
//
// Speed runs 0.25x to 2x in five steps, cycling on a tap and reversing
// on a hold (see stepSpeed and the pointer wiring in buildRail), and its
// glyph is a dial rather than a count of chevrons -- one chevron read as
// PLAY and two as FAST-FORWARD, which are other controls on this card.
//
// Speed is GENUINELY GLOBAL -- GLOBAL_SPEED_OPTIONS/globalSpeedIndex
// live at MODULE level, not inside this function, so every card in a
// scrolling feed shares the SAME speed state instead of each getting its
// own independent one reset to 1.0x. speedOptions itself is intentionally
// NOT recipe-configurable: if different recipes could define different
// option arrays while speedIndex stayed shared, the same index position
// would silently mean a different speed depending which card you're on.
//
// Depends on dsp_registry.js, rendering_registry.js, dispatcher.js, and
// shared_signal_utils.js (fetchSignal, activeSweepControl, startSweepLoop,
// cancelSweepAnimation) -- all must load before this file.
// ---------------------------------------------------------------------------

const STAGE_DURATION_MS = 8000; // was 5000 -- same 5s signal, takes 8s to sweep. Feels more natural for reading ECG detail.

// THE LADDER. 0.25x and 0.5x exist because a long record swept in eight
// seconds is faster than anyone can read a QRS complex off -- the slow
// end is not a novelty, it is how you look at a beat. 1.5x and 2x stay;
// 3x was considered and dropped, because five steps already means four
// taps to get back to where you were and that is the real cost of a
// single cycling button.
//
// GLOBAL, not per-journey-instance -- deliberately outside
// interpretJourney() so every card in the scrolling feed shares this
// SAME state. Scrolling to a new card no longer resets Speed to 1.0x.
const GLOBAL_SPEED_OPTIONS = [0.25, 0.5, 1.0, 1.5, 2.0];
let globalSpeedIndex = GLOBAL_SPEED_OPTIONS.indexOf(1.0);

// ── WHICH WAY THE NEXT STEP GOES ────────────────────────────────────────
// A tap steps forward, a HOLD steps back. One button, because the rail is
// already six tall on some journeys and a dedicated minus would cost a
// slot over the render -- see the pointer wiring in buildRail().
//
// A ONE-SHOT, reset inside stepSpeed(). Left sticky it would be a hidden
// mode: a hold followed by an ordinary tap would run backwards too, and
// nothing on screen would say why.
let speedStepDirection = 1;

function stepSpeed() {
    const n = GLOBAL_SPEED_OPTIONS.length;
    // (i - 1 + n) % n written as (i + n - 1) % n: JavaScript's % keeps the
    // sign of the dividend, so a bare -1 at index 0 gives -1, not n-1,
    // and GLOBAL_SPEED_OPTIONS[-1] is undefined rather than the fastest
    // step. Wrapping both directions is what makes one button enough.
    const delta = speedStepDirection < 0 ? n - 1 : 1;
    globalSpeedIndex = (globalSpeedIndex + delta) % n;
    speedStepDirection = 1;
}

// "1x", "1.5x", "0.25x" -- no trailing zeros, because "1.00x" in a 9px
// label is three characters of nothing. CSS uppercases it.
function formatSpeed(v) {
    return `${Number(v).toFixed(2).replace(/\.?0+$/, "")}x`;
}

// ── RAIL GLYPHS: SOLID, TRANSPARENT, NO CHROME ─────────────────────────
// Every glyph is a FILLED path in currentColor at 24x24, with secondary
// parts carried on `opacity` rather than a second colour. That is what
// makes the set theme-proof: one CSS variable colours all of it, and a
// theme that lightens the card does not have to redraw anything.
//
// The old set was STROKED (stroke-width 2, fill none) and sat inside a
// 40px tinted circle with a hairline border. Two problems, both visible
// on a phone: over a sweeping trace that circle was the loudest object
// on the card -- a hole punched in the thing the viewer came to watch --
// and a 1px stroke over moving content is the first thing to disappear.
// A filled shape with a drop shadow reads at a glance and needs nothing
// behind it. Same reason Shorts and Reels draw their rails this way.
//
// Keyed by the recipe's own control.ui.icon field, so a recipe can
// reference any of these by name without journey_interpreter.js needing
// to know which button label goes with which icon.
const RAIL_ICONS = {
    // A bar with its triangle MIRRORED below at 45% opacity -- the ghost
    // half is the signal after the flip. Two solid triangles would be
    // symmetrical and so would say nothing about direction.
    icon_flip_vertical: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 11.1h18v1.8H3z"/><path d="M4.5 8.6 12 2l7.5 6.6z"/><path d="M4.5 15.4 12 22l7.5-6.6z" opacity="0.45"/></svg>`,

    // A half-lit disc: CONTRAST, not a colour swatch. Deliberately
    // carries no hue of its own, because it has to mean the same thing
    // in all five themes including the two loud ones.
    icon_theme: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><circle cx="12" cy="12" r="9.5" opacity="0.32"/><path d="M12 2.5a9.5 9.5 0 0 1 0 19z"/></svg>`,

    // An ANNULUS with a gap plus an arrowhead, not a stroked arc: a
    // filled ring's weight is independent of its rendered size, so this
    // does not thin out beside the others if a theme scales the rail.
    icon_cycle: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8.92 3.54A9 9 0 1 1 4.21 7.5l2.51 1.45A6.1 6.1 0 1 0 9.91 6.27z"/><path d="M7.36 4.93 2.52 6.53 8.4 9.92z"/></svg>`,

    // Stacked planes fading back: same data, different surface. Was a
    // monitor on a stand, which said "screen" rather than "which way of
    // drawing".
    icon_renderer: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2 21.5 7 12 12 2.5 7z"/><path d="M2.5 11.2 4.6 10.1 12 14l7.4-3.9 2.1 1.1L12 16.2z" opacity="0.6"/><path d="M2.5 15.4 4.6 14.3 12 18.2l7.4-3.9 2.1 1.1L12 20.4z" opacity="0.35"/></svg>`,

    // NEW. A fork -- one signal in, two candidate detectors out. The
    // algorithm button used to be bare text ("PT"), which named the
    // choice without ever saying what KIND of choice it was.
    icon_algorithm: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 11.1h8.5v1.8H3z"/><path d="M11.5 5.6h1.8v12.8h-1.8z"/><path d="M13.3 5.6h4.2v1.8h-4.2z"/><path d="M13.3 16.6h4.2v1.8h-4.2z"/><circle cx="19.3" cy="6.5" r="2.2"/><circle cx="19.3" cy="17.5" r="2.2"/></svg>`,

    // NEW. A caliper: two posts with arrows pushing out to them. A SPAN,
    // which is what an interval control sets -- a clock face would say
    // "a moment" instead.
    icon_interval: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 4h2.2v16H3z"/><path d="M18.8 4H21v16h-2.2z"/><path d="M9 11.2h6v1.6H9z"/><path d="M9 9.2v5.6L5.2 12z"/><path d="M15 9.2v5.6L18.8 12z"/></svg>`,

    // NEW. An eye, for the jargon/plain switch. A bookmark or a book
    // would mean "terms"; the control's actual state is shown or hidden,
    // and naming the STATE is what lets the glyph carry a value.
    icon_defs: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 5.2c5.6 0 9.8 6.8 9.8 6.8s-4.2 6.8-9.8 6.8S2.2 12 2.2 12 6.4 5.2 12 5.2z" opacity="0.38"/><circle cx="12" cy="12" r="3.6"/></svg>`,

    // THE SAME GLYPH, FLIPPED, for when invert is ON. Both halves are
    // the two paths above with their opacities swapped, so the pair can
    // never drift apart in shape.
    //
    // WHY THE STATE AND NOT THE ACTION. flashPlayback() takes the
    // opposite line one file over -- a paused card shows a PLAY glyph,
    // because the icon names what you can do next rather than where you
    // are -- and that is right for a transport control whose two states
    // look different.
    //
    // It cannot work here. Invert is SYMMETRIC: the action available
    // while inverted is "invert back", and the glyph for it is the same
    // glyph. Naming the action would leave the button looking identical
    // in both states, which is the situation we are in now. So this one
    // names the state, and the mirrored solid half says which way the
    // trace is currently running.
    icon_flip_vertical_on: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 11.1h18v1.8H3z"/><path d="M4.5 8.6 12 2l7.5 6.6z" opacity="0.45"/><path d="M4.5 15.4 12 22l7.5-6.6z"/></svg>`,

    // DEPTH, the third global control. The same eye as icon_defs, which
    // is deliberate: Depth is what the Defs button was reaching for and
    // could not do, so it inherits the shape rather than inventing one.
    //
    // TWO FORMS, NOT THREE, for a three-state control. The glyph says
    // whether help is turned up at all; the value label under it says
    // which of the two upper stops you are on. A third eye drawn to mean
    // "guided, not simple" would be a distinction nobody could see at
    // 20px, and the label already carries it unambiguously.
    icon_depth: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 5.2c5.6 0 9.8 6.8 9.8 6.8s-4.2 6.8-9.8 6.8S2.2 12 2.2 12 6.4 5.2 12 5.2z" opacity="0.38"/><circle cx="12" cy="12" r="3.6"/></svg>`,

    // The low stop. Dimmer and struck through -- NOT an empty or closed
    // eye, because nothing is actually switched off at "basic": the
    // pointers thin out, they do not vanish. A closed eye would promise
    // a blank plot.
    icon_depth_off: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 5.2c5.6 0 9.8 6.8 9.8 6.8s-4.2 6.8-9.8 6.8S2.2 12 2.2 12 6.4 5.2 12 5.2z" opacity="0.2"/><circle cx="12" cy="12" r="3.6" opacity="0.45"/><path d="M3.6 5.0 5.0 3.6 20.4 19.0 19.0 20.4z"/></svg>`,

    // NEW, AND IT WAS ALREADY BEING ASKED FOR. The universal Share
    // control (see the `universal` array in buildRail) has named
    // "icon_share" since the day it was added, and RAIL_ICONS never had
    // it -- so the lookup missed, the final else fired, and the button
    // has been rendering the WORD "Share" in a rail of icons ever since,
    // at 0.72rem mono in a 40px circle. Nobody reported it because it
    // looked deliberate.
    icon_share: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><rect x="7" y="11.1" width="10" height="1.8" transform="rotate(-27 12 12)"/><rect x="7" y="11.1" width="10" height="1.8" transform="rotate(27 12 12)"/><circle cx="5.5" cy="12" r="3"/><circle cx="18.5" cy="6" r="3"/><circle cx="18.5" cy="18" r="3"/></svg>`,
};

// ── GLYPHS THAT HAVE AN "ON" FORM ──────────────────────────────────────
// A boolean rail control is a TOGGLE, and a toggle that looks the same in
// both states is a button you have to press to find out what it did.
//
// Kept as a lookup rather than a naming convention ("<icon>_on") so that
// adding a glyph cannot accidentally create an on-state for a control
// that does not have one -- and so that an icon with no entry here simply
// keeps its single form, which is every other glyph in the set today.
const ICON_ON_VARIANTS = {
    icon_flip_vertical: "icon_flip_vertical_on",
};

// ── GLYPHS FOR THE DERIVED CONTROLS ────────────────────────────────────
// Derived controls come from choices() on the DSPE or the renderer, and a
// choice declares a key, a label and its values -- not an icon. Rather
// than touch every engine that declares one (exchange_view.js and the BLE
// engines included) this maps a control to a glyph by its own key or
// label.
//
// A STOPGAP, named as one. The right home is an `icon` field on the
// choice itself, which resolveDerivedIcon already PREFERS when it is
// there -- so adding it to an engine later needs no change here. What
// this buys today is that a rail change stays a two-file change.
//
// An unmatched control gets NO glyph and keeps its text label, which is
// exactly what it had before. A wrong icon is worse than a word.
const DERIVED_ICON_RULES = [
    { match: /interval|period|spacing|window|duration|gap|ifs/i, icon: "icon_interval"      },
    { match: /term|def|gloss|jargon|plain|legend/i,              icon: "icon_defs"          },
    { match: /invert|flip|mirror|polarity/i,                     icon: "icon_flip_vertical" },
    { match: /theme|palette|skin/i,                              icon: "icon_theme"         },
    { match: /render|view|surface|canvas|webgl/i,                icon: "icon_renderer"      },
    { match: /algo|detect|filter|method|branch|route|path/i,      icon: "icon_algorithm"     },
    { match: /show|hide|visible|display|label|annot/i,            icon: "icon_defs"          },
];

function resolveDerivedIcon(choice, label) {
    const hay = `${choice?.key ?? ""} ${label ?? ""}`;
    for (const rule of DERIVED_ICON_RULES) {
        if (rule.match.test(hay)) return rule.icon;
    }
    return null;
}

// The value shown under a glyph comes from DATA -- a choice's display
// map, a record's meta -- so it is escaped rather than trusted. Small,
// and the alternative is innerHTML assembled from a recipe field.
function escapeRailText(v) {
    return String(v).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
}

// ── GLYPH ABOVE, CURRENT VALUE BENEATH ─────────────────────────────────
// The one place a rail button's contents are written.
//
// WHY A VISIBLE VALUE AT ALL: four of these controls are derived, and
// their whole purpose is comparison -- the premise of the app is that you
// learn by seeing two things against each other. Until now the value
// lived only in btn.title, because "Oxygen: present" does not fit a 40px
// circle. A tooltip is also a thing a phone does not have, so on the
// device most of this is viewed on the value was not available at all.
//
// A 9px label under a 20px glyph does fit, and it sits in a FIXED-SIZE
// box, so a value changing length cannot reflow the rail -- which is the
// thing the tooltip-only version was protecting against.
//
// Speed passes no value on purpose: the number of chevrons IS the value,
// so a label would say the same thing twice.
function paintRailButton(btn, iconName, valueText, rawSvg, textFallback) {
    const svg = rawSvg ?? (iconName ? RAIL_ICONS[iconName] : null);
    const value = (valueText === undefined || valueText === null)
                ? "" : String(valueText);
    const hasValue = value !== "";

    if (!svg) {
        // No glyph for this control: text, exactly as before. The CALLER
        // says which text, because the right answer differs -- a derived
        // control reads better as its variable ("Interval"), an algorithm
        // picker as its value ("PT").
        btn.textContent = textFallback ?? btn.dataset.railLabel ?? "";
        btn.classList.remove("has-value");
        btn.classList.add("text-only");
        return;
    }

    btn.classList.remove("text-only");
    btn.classList.toggle("has-value", hasValue);
    btn.innerHTML = svg + (hasValue
        ? `<span class="rail-value">${escapeRailText(value)}</span>`
        : "");
}

// ── SPEED'S GLYPH IS A DIAL, AND IT USED TO BE CHEVRONS ────────────────
// The chevron count WAS the value: one chevron at the slowest step, four
// at the fastest. It had to be, because the button carried no text.
//
// And it was unreadable, for a reason that is obvious once said. One
// triangle is the universal PLAY glyph. Two is FAST-FORWARD. Both of
// those are transport controls, and this card already has a tap-to-pause
// and a tap-to-advance -- so the slowest speed looked like a play button
// and the next one up looked like skip. A viewer reading it that way was
// reading it correctly; the glyph was wrong.
//
// A half gauge with a needle has no transport reading at all, because
// nothing in that family is round with a pointer. The needle sweeps 160
// degrees (slowest) to 20 (fastest) across however many steps the ladder
// actually has, so this stays correct if the ladder changes length.
//
// The needle is still dynamic, but it is no longer load-bearing: the
// value label under the glyph carries the number now, and the needle is
// the pre-attentive read you get before your eye reaches it.
function buildSpeedIcon(speedValue) {
    const stepIndex = GLOBAL_SPEED_OPTIONS.indexOf(speedValue);
    // -1 guard: an unrecognised value still renders a needle rather than
    // a bare dial, same spirit as the old chevron fallback.
    const i = stepIndex === -1 ? 0 : stepIndex;
    const steps = Math.max(1, GLOBAL_SPEED_OPTIONS.length - 1);

    const SWEEP_FROM = 160, SWEEP_TO = 20;   // degrees, anticlockwise-positive
    const rad = (SWEEP_FROM + (SWEEP_TO - SWEEP_FROM) * (i / steps)) * Math.PI / 180;

    const cx = 12, cy = 15;      // the dial's pivot, low in the 24x24 box
    const TIP_R = 8.2, HUB_R = 1.6, HALF_W = 1.9;
    // Screen coordinates, so y is negated: the maths is anticlockwise and
    // the canvas is not.
    const ux = Math.cos(rad), uy = -Math.sin(rad);
    const px = -uy, py = ux;     // unit normal, for the needle's base
    const f = v => v.toFixed(1);

    const tipX = cx + ux * TIP_R,  tipY = cy + uy * TIP_R;
    const aX = cx + px * HALF_W + ux * HUB_R, aY = cy + py * HALF_W + uy * HUB_R;
    const bX = cx - px * HALF_W + ux * HUB_R, bY = cy - py * HALF_W + uy * HUB_R;

    // The band is an ANNULUS SECTOR, not a stroked arc, for the same
    // reason icon_cycle is: a filled ring's weight does not change with
    // the rendered size, so the dial does not thin out at 20px when the
    // button also shows its value label.
    return `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">`
         + `<path d="M2.5 15A9.5 9.5 0 0 1 21.5 15L18.5 15A6.5 6.5 0 0 0 5.5 15Z" opacity="0.35"/>`
         + `<path d="M${f(tipX)} ${f(tipY)} ${f(aX)} ${f(aY)} ${f(bX)} ${f(bY)}z"/>`
         + `<circle cx="12" cy="15" r="2.2"/>`
         + `</svg>`;
}

// Methods that CYCLE a value (as opposed to toggling a boolean or firing
// an icon-represented action) -- for these, showing the CURRENT value as
// text is clearer than any generic icon could be. Each maps to the
// matching "get" method on the same target.
// Buttons whose CURRENT VALUE is the useful thing to display, rather
// than a generic icon.
//
// WHY: switching algorithm used to change the picture while telling you
// nothing about what you had switched TO. The whole premise of this app
// is understanding through comparison -- and a comparison where you
// cannot see which two things are being compared teaches nothing. The
// information existed (dspEngine.getActiveAlgorithm()) but only in the
// dev HUD behind ?dev=1.
//
// The rail button is the right place for it: it already exists, and it
// answers "what am I using" in the same place you go to change it --
// the same pattern camera apps use for lens buttons.
//
// labelMap turns a registry id into something that fits an ~40px button.
// An unmapped id falls back to a truncation, so a new algorithm shows
// something sensible before anyone remembers to add a short label.
const VALUE_DISPLAY_METHODS = {
    switchAlgorithm: {
        getMethod: "getActiveAlgorithm",
        suffix:    "",
        // The glyph says WHAT is being chosen, the label says WHICH.
        // On its own, "PT" named a detector to anyone who already knew
        // there was a detector to name.
        icon:      "icon_algorithm",
        labelMap: {
            pan_tompkins:      "PT",
            pan_tompkins_py:   "PT2",   // superscript "py" rendered too small to read
            hamilton_tompkins: "HT",
            db4_wavelet:       "DB4",
            poincare_standard: "PC",
            aes128_encrypt:    "AES",
            passthrough:       "RAW",
            null_dsp:          "NUL",
        },
    },
    switchRenderer: {
        getMethod: "getActiveRenderer",
        suffix:    "",
        icon:      "icon_renderer",
        labelMap: {
            chart_v1:            "SVG",
            chart_v1_canvas:     "2D",
            chart_v1_webgl:      "GL",
            scatter_density:     "PC",
            rr_tachogram:        "RR",
            dwt_comparison_view: "DWT",
            aes_state_grid:      "HEX",
            null_renderer:       "NUL",
        },
    },
};

// Fall back to something readable rather than nothing: strip any known
// suffix, then take the initials of the remaining words.
// "some_new_filter" -> "SNF"
function shortenId(id) {
    if (!id) return "?";
    return id.split(/[_-]/)
             .filter(Boolean)
             .map(w => w[0])
             .join("")
             .toUpperCase()
             .slice(0, 4);
}

function interpretJourney(journeyJson, sampleId, chartContainer, railContainer, titleEl, captionEl, progressBarEl, descriptionEl) {
    let currentStageIndex = 0;
    const stageOutputs = {}; // stageId -> its exported output, per stageOutput.exportKey
    const dspOutputCache = new Map(); // stageIndex -> already-computed dspOutput, populated by preloadNextStage
    const dspEngines = new Map(); // stageIndex -> persistent dspEngine instance, survives stage navigation
    // Sample rate from the most recent HTTP_REST resolve. Pipeline
    // stages inherit it: their input is an exported array, which carries
    // no sample rate of its own.
    let lastResolvedFs = null;
    // Carried alongside fs for the same reason: an exported field is a
    // bare array, so a later stage that needs the record's LABEL (which
    // lives in meta, not in the signal) has no other way to reach it.
    let lastResolvedMeta = {};
    let lastEnvelope = null;
    // Journeys are identified by label here; the recipe carries no name
    // field, and two journeys sharing a label would only share rail
    // memory, which is harmless.
    const memKey = journeyJson.label ?? "journey";

    // meta recorded PER EXPORT, keyed by exportKey.
    //
    // WHY NOT just lastResolvedMeta: that holds the meta of the most
    // recent HTTP fetch in the journey, which is only the right answer
    // when there is exactly one fetch. A journey with two HTTP stages
    // (the spectrum journey already has two) would hand a pipeline stage
    // consuming stage 1's export the meta belonging to stage 2 --
    // silently, since both are valid-looking objects. Binding meta to
    // the export makes "whose meta is this" unambiguous.
    const stageOutputMeta = {};
    let autoAdvanceTimer = null;
    let autoAdvanceEndTime = null; // absolute performance.now() timestamp the current timer should fire at -- used to compute remaining time when pausing
    let autoAdvanceRemainingMs = null; // set only while paused
    // Deliberately SEPARATE from autoAdvanceRemainingMs. A card can be
    // paused by the viewer AND scrolled off screen, and one store would
    // have each overwrite the other -- so resuming would either restart
    // a paused card or lose the remaining time entirely.
    let offscreenRemainingMs = null;

    // Pause is per-JOURNEY-INSTANCE (per card), unlike Speed -- pausing
    // one card shouldn't pause a DIFFERENT card you scroll to next.
    let isPaused = false;

    const sharedMemory = { ...(journeyJson.sharedPipelineMemory || {}) };
    const journeyTarget = {
        // ── SHARE (on the DISPATCH TARGET) ─────────────────────
        // This lived on the object interpretJourney RETURNS,
        // which the feed uses for start/destroy/next. The
        // dispatcher resolves "journey" to journeyTarget, a
        // different object -- so the rail button found no such
        // method. Right name, wrong home.
        // ── SHARE ──────────────────────────────────────────────────────
        // Builds a link to THIS card, not to the journey: ?sample= is
        // validated server-side, so a stale link degrades to an ordinary
        // feed rather than a card that cannot load.
        //
        // The journey's ROUTE name is used, not its label -- label is for
        // display and two journeys could share one.
        //
        // On a mixed feed (/feed, /seed) journeyJson.name is null, so the
        // batch is asked which journey this card belongs to.
        async share() {
            const fromPath = location.pathname.match(/^\/journey\/([^/?#]+)/)?.[1];
            const name = journeyJson.name ?? fromPath;
            if (!name) {
                console.warn("share: cannot determine the journey name");
                return;
            }
            const url = `${location.origin}/journey/${name}`
                      + `?sample=${encodeURIComponent(sampleId)}`;
            const title = journeyJson.stages?.[currentStageIndex]?.uiFillers?.title
                        ?? "ECG Shorts";
            // Three tiers, because each can fail for reasons the next
            // does not share:
            //   navigator.share  absent on desktop browsers, and on
            //                    Windows Chrome it opens a dialog that
            //                    may itself fail
            //   clipboard API    requires a SECURE CONTEXT -- silently
            //                    unavailable over plain http, which is
            //                    exactly how a phone tests against a PC
            //   execCommand      deprecated, but works anywhere
            // and if all three fail the URL is shown so it can be copied
            // by hand, which beats a dead button.
            const copyFallback = () => {
                const ta = document.createElement("textarea");
                ta.value = url;
                ta.setAttribute("readonly", "");
                ta.style.cssText = "position:fixed;top:-1000px;opacity:0;";
                document.body.appendChild(ta);
                ta.select();
                let ok = false;
                try { ok = document.execCommand("copy"); } catch (_) {}
                ta.remove();
                return ok;
            };

            try {
                if (navigator.share) {
                    await navigator.share({ title, url });
                    return;
                }
            } catch (e) {
                // Cancelling the sheet is a normal outcome, not a failure.
                if (e?.name === "AbortError") return;
                console.warn("native share failed, falling back:", e);
            }

            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(url);
                    flashMessage("Link copied");
                    return;
                }
            } catch (e) {
                console.warn("clipboard failed, falling back:", e);
            }

            flashMessage(copyFallback() ? "Link copied" : url);
        }, // replays the CURRENT stage from the beginning -- used for the "first tap restarts, fast second tap goes back" pattern

        cycleSpeed() {
            // payload.options intentionally ignored now -- see the file
            // header for why speedOptions isn't recipe-configurable.
            //
            // The direction lives in speedStepDirection, which the hold
            // gesture sets just before the click lands. Deliberately NOT
            // a second method: the dispatcher verb a recipe names stays
            // "cycleSpeed" whichever way it goes, so no recipe has to
            // learn about holding.
            stepSpeed();
        },
        // ── DEPTH ──────────────────────────────────────────────────────
        // Relays to rail_controls.js, exactly as cycleTheme does. The
        // dial is global -- one value for the whole feed -- for the same
        // reason Speed is: a viewer who asked for plain wording has asked
        // for it on the next card too, and a per-card value would reset
        // on every scroll.
        //
        // typeof-guarded because rail_controls.js owns it and a bare test
        // page may not load it; the matching guards in
        // refreshButtonContent keep the button honest in that case.
        cycleDepth() {
            if (typeof cycleDepth === "function") cycleDepth();
        },
        getDepth() {
            return typeof getActiveDepthLabel === "function"
                 ? getActiveDepthLabel() : null;
        },
        cycleTheme() {
            // Delegates to rail_controls.js's real, rewritten cycleTheme()
            // -- updates themeIndex + the CSS variables buildChartLayout()
            // and the glow filter both read. Theme is global (like Speed),
            // not per-card, matching the existing THEMES/themeIndex design.
            cycleTheme();
        },
        getActiveTheme() {
            return getActiveThemeLabel();
        },
        getSpeed() {
            return GLOBAL_SPEED_OPTIONS[globalSpeedIndex];
        },
        // sharedPipelineMemory (patientId, leadType, sampleRateHz, etc) --
        // journey-level context shared across every stage, exposed via the
        // SAME getParameter/setParameter verbs the dispatcher already uses
        // for dspEngine/renderingEngine. A mutable COPY, not the original
        // journeyJson object, so a setParameter call can't silently
        // mutate the source recipe itself.
        getParameter(payload) {
            return sharedMemory[payload.key];
        },
        setParameter(payload) {
            if (payload.operation === "toggle") {
                sharedMemory[payload.key] = !sharedMemory[payload.key];
            } else {
                sharedMemory[payload.key] = payload.value;
            }
        },
    };

    // ── GLOSSARY, for {{TERM}} substitution in a stage's prose ─────────
    // Journey-level rather than per-stage. terms_for() already ships a
    // per-stage SUBSET for the glossary chip, and that subset is an
    // editorial choice about which terms a card introduces -- a different
    // question from which terms its sentences happen to mention. Resolving
    // tokens against the editorial subset would leave a literal
    // "{{T_IFS}}" on any card that referenced a term it did not introduce.
    //
    // Empty object when a recipe declares none, so every un-migrated
    // journey behaves exactly as before: no tokens, nothing to resolve.
    const journeyGlossary = journeyJson.glossary ?? {};

    // ── WOULD A DEPTH BUTTON DO ANYTHING ON THIS JOURNEY? ──────────────
    // Depth moves two things: the wording (needs a glossary and {{tokens}}
    // in the prose) and the annotation density (needs an annotations
    // block). A journey with neither would get a button that changes
    // nothing a viewer can see.
    //
    // Hidden rather than shipped inert, and that is a rule this codebase
    // already learned the hard way: a "Route" control once sat on the
    // citric acid cycle doing nothing, because no reaction there was ever
    // conditional, and choices() exists precisely so a control appears
    // only where it means something. A dead button does not read as "not
    // applicable here" -- it reads as broken.
    //
    // Computed once per journey rather than per rail build: it depends on
    // the recipe, which does not change while a card is on screen.
    //
    // THREE SOURCES, AND THE THIRD WAS MISSED FIRST TIME ROUND. There are
    // two different glossaries in a BLE recipe and they are not the same
    // object:
    //
    //   journeyJson.glossary                      -- {acronym, short, emoji}
    //       journey-wide VOCABULARY, from glossary_for_client(). Feeds
    //       fill()'s {{TOKEN}} substitution in the prose.
    //
    //   stage.renderingEngine.config.glossary     -- {acronym, full, plain}
    //       a per-stage editorial SUBSET, from terms_for(). Feeds the
    //       definitions strip exchange_view draws at the foot of the card.
    //
    // The first version of this gate checked only the journey-wide one,
    // and ble_connect came out false: the strip glossary has been there
    // since v1 while the journey-wide one arrived later. So the journey
    // with the most acronyms in the app was the one journey that got no
    // Depth button, which is close to the opposite of the intent.
    //
    // The strip counts because Depth MOVES it -- showDefs is one of the
    // three things a depth level carries. A journey with a strip and
    // nothing else still has something for the control to do.
    const journeyExplains =
        Object.keys(journeyJson.glossary ?? {}).length > 0
        || (journeyJson.stages ?? []).some(s =>
               (s.annotations ?? []).length > 0
            || (s.renderingEngine?.config?.glossary ?? []).length > 0);

    // ── THE RECIPE'S OWN STARTING DEPTH ────────────────────────────────
    // Honoured on entry and ignored after the viewer's first tap -- see
    // setDepthDefault in rail_controls.js for why the recipe proposes
    // rather than owns. ble_connect wants to open at "simple"; a plain
    // ECG sweep does not.
    if (typeof setDepthDefault === "function" && journeyJson.defaultDepth) {
        setDepthDefault(journeyJson.defaultDepth);
    }

    // "full" | "plain", from the active visual theme via its CSS variable.
    //
    // Read fresh on every call rather than captured once: the DEPTH rail
    // button changes it mid-card, and a captured value would leave the
    // prose in the previous register until the next stage.
    //
    // It used to be the Theme button that moved this, which is the whole
    // reason Depth exists -- the variable's name and this reader are
    // unchanged, only who writes it.
    function activeTermLevel() {
        try {
            const v = getComputedStyle(document.documentElement)
                        .getPropertyValue("--term-level").trim();
            return v === "plain" ? "plain" : "full";
        } catch (e) {
            return "full";
        }
    }

    function getActiveTheme() {
        return journeyJson.globalThemes.themes.find(t => t.id === journeyJson.globalThemes.activeTheme);
    }

    // Honest, MINIMAL color resolution -- NOT a generic path-resolver for
    // arbitrary strings. Handles exactly this one known recipe pattern
    // (referencing the active theme's primary color) by name; anything
    // else is treated as a literal CSS color value (e.g. inactiveColor's
    // rgba() string, which needs no resolution at all).
    function resolveColor(colorSpec) {
        if (colorSpec === "globalThemes.activeTheme.palette.primary") {
            return getActiveTheme().palette.primary;
        }
        return colorSpec;
    }

    // Builds the dot row ONCE (one dot per stage) -- doesn't depend on
    // which stage is current, so this only ever runs a single time.
    //
    // The recipe's progressBar colours are applied as CSS custom
    // properties on the container rather than inline styles on each dot.
    // Inline `background` on a segment would fill the dot's centre and
    // destroy the hollow/filled distinction the dots rely on; scoping the
    // colours to the container lets the CSS decide WHERE each one applies
    // (border for pending, fill for completed/current).
    function buildProgressBar() {
        const shell = journeyJson.uiShell;
        if (!shell || !shell.showProgressBar || !progressBarEl) return;

        progressBarEl.style.setProperty("--dot-active",
            resolveColor(shell.progressBar.activeColor));
        progressBarEl.style.setProperty("--dot-inactive",
            resolveColor(shell.progressBar.inactiveColor));

        progressBarEl.innerHTML = "";
        journeyJson.stages.forEach(() => {
            const segment = document.createElement("div");
            segment.className = "segment";
            segment.innerHTML = `<div class="fill"></div>`;
            progressBarEl.appendChild(segment);
        });
    }

    // Called every stage transition -- marks completed/current segments
    // and sets the CURRENT segment's fill animation to actually run for
    // durationMs (reuses shorts_feed.css's existing .segment.current
    // .fill { animation-name: fillBar } rule -- only the per-stage
    // DURATION varies, set inline here, same pattern the old app used).
    function updateProgressBar(index, durationMs) {
        const shell = journeyJson.uiShell;
        if (!shell || !shell.showProgressBar || !progressBarEl) return;
        const segments = progressBarEl.querySelectorAll(".segment");
        segments.forEach((seg, i) => {
            seg.classList.toggle("completed", i < index);
            const fill = seg.querySelector(".fill");

            if (i === index) {
                // Force the fill animation to restart from 0%, even if
                // this exact segment was ALREADY .current (e.g. a
                // restart() replay of the same stage) -- just re-setting
                // animationDuration does NOT reset an already-running CSS
                // animation's progress. Standard fix: remove the class
                // that applies the animation, force a synchronous reflow
                // (reading offsetWidth), then re-add it -- this makes the
                // browser treat it as a genuinely new animation instance.
                seg.classList.remove("current");
                void fill.offsetWidth; // force reflow -- without this, the browser may batch the class removal+re-addition together and never actually restart anything
                fill.style.animationDuration = `${durationMs}ms`;
                // CLEAR THE SCRUB SEEK. A scrub leaves a negative
                // animation-delay on this element to hold the dot at the
                // dragged position, and nothing else removes it -- so a
                // restart, a rail tap or a re-entry into this stage would
                // reuse it and the fill would begin part-done. Resetting
                // here rather than in scrubEnd keeps it in the one place
                // that already owns "this stage starts now".
                fill.style.animationDelay = "0ms";
                seg.classList.add("current");
            } else {
                seg.classList.remove("current");
            }
            // Clear what armFillsForSeek() wrote. Without this an
            // inline animation-name:fillBar survives on a segment that is
            // no longer .current, so a dot that should sit still keeps
            // filling -- the CSS only grants the animation to the current
            // one, and an inline value outranks it.
            fill.style.animationName = "";
            fill.style.animationPlayState = "running"; // reset -- a fresh stage always starts unpaused visually
        });

        // The scrub bar's fill is the same animation over the same
        // duration, set from the same call. Driving it anywhere else is
        // how the dot came to ignore scrubbing in the first place.
        const sf = scrubFillEl();
        if (sf) {
            // RE-TRIGGERED, not merely re-configured.
            //
            // Setting animation-duration on an animation that has
            // already finished does not restart it -- it UN-finishes it
            // and the animation resumes at (time since its own start /
            // the new duration). Measured: a fill that had completed,
            // given a fresh 8000ms duration, jumped to scaleX 0.069
            // rather than 0. That is exactly "the stage restarts but the
            // bar carries on from where it was", and the further into a
            // card you are the further along it lands.
            //
            // The story dot never had this because updateProgressBar
            // removes and re-adds .current, and the CSS only grants
            // fillBar to .segment.current .fill -- so the class toggle
            // IS a re-trigger. The scrub fill takes its animation-name
            // unconditionally from CSS, so nothing was ever retriggering
            // it. Same trap as arming a seek; third time it has bitten.
            sf.style.animationName = "none";
            void sf.offsetWidth;                 // forced reflow
            sf.style.animationName      = "fillBar";
            sf.style.animationDuration  = `${durationMs}ms`;
            sf.style.animationDelay     = "0ms";
            sf.style.animationPlayState = "running";
        } else if (chartContainer?.closest(".journey-card")) {
            // SAY SO rather than carry on. A missing duration here does
            // not look like a missing duration -- it looks like a bar
            // that is full from the start, which reads as a rendering
            // bug a long way from its cause. Deliberately not given a
            // default duration instead: a plausible-looking 8s would
            // have hidden this rather than reported it.
            console.warn("[PROGRESS] scrub bar not built yet, so its fill "
                + "has no duration and will render FULL. ensureScrubBar() "
                + "must run before updateProgressBar() in buildStage().");
        }
    }

    // Resolves ONE stage's dataSource -- either a real HTTP fetch (Stage 1,
    // the journey's actual entry point) or a previous stage's real,
    // already-computed output (Stage 2+, PREVIOUS_STAGE_PIPELINE).
    async function resolveDataSource(stageJson) {
        const ds = stageJson.dataSource;

        if (ds.mode === "HTTP_REST") {
            // Use data_registry.js fetchAndNormalise -- resolves endpoint
            // and adapter from the registered sourceId, returns the
            // standard envelope {y, fs, t, arrays, raw, meta}.
            // Backward compatible: data.y is always the primary array,
            // so all existing DSP algorithms work unchanged.
            const sourceId = ds.sourceId || "ecg_single"; // default for old recipes
            const envelope = await fetchAndNormalise(sampleId, sourceId);
            // Remembered so a later PREVIOUS_STAGE_PIPELINE stage can
            // inherit it -- exported fields are bare arrays with no fs.
            if (envelope?.fs) lastResolvedFs = envelope.fs;
            if (envelope?.meta) lastResolvedMeta = envelope.meta;
            lastEnvelope = envelope;   // choices() needs the whole thing
            return envelope;
        }

        if (ds.mode === "PREVIOUS_STAGE_PIPELINE") {
            const exported = stageOutputs[ds.outputKey];
            if (!exported) {
                console.error(`Journey: output "${ds.outputKey}" from stage "${ds.stageId}" isn't available yet -- has that stage run?`);
                return null;
            }

            // Omitting consumedField passes the WHOLE export, wrapped so it
            // looks like a normal envelope to the DSPE.
            //
            // WHY: the single-field form is right when a stage consumes
            // one array (Poincare wants rrIntervalsMs and nothing else).
            // But a stage like stacked_beats needs filteredSignal AND
            // peakIndices AND optionally wavePoints -- three fields from
            // one upstream stage. Forcing that through consumedField would
            // mean either three pipeline stages or a DSPE that reaches
            // into journey state, and both are worse than this.
            //
            // fs is carried over because the exported fields are arrays
            // with no sample rate of their own, and a downstream stage
            // converting samples to milliseconds needs it.
            if (!ds.consumedField) {
                return {
                    finalOutput: exported,
                    fs: lastResolvedFs,
                    // The meta of the stage being CONSUMED, not of the
                    // last fetch. Falls back for exports written before
                    // meta was tracked.
                    meta: stageOutputMeta[ds.outputKey] ?? lastResolvedMeta,
                    y: exported.filteredSignal ?? null,
                };
            }

            const value = exported[ds.consumedField];
            if (value === undefined) {
                console.error(`Journey: stage "${ds.stageId}"'s export ("${ds.outputKey}") doesn't contain field "${ds.consumedField}"`);
                return null;
            }
            return value;
        }

        console.error(`Journey: unsupported dataSource.mode "${ds.mode}"`);
        return null;
    }

    // Runs a stage's data resolution + DSP processing WITHOUT rendering
    // anything -- used by preloadNextStage to warm dspOutputCache while a
    // different stage is still on screen.
    async function preloadStage(index) {
        if (index < 0 || index >= journeyJson.stages.length) return;
        if (dspOutputCache.has(index)) return; // already warmed, don't redo the work

        const stageJson = journeyJson.stages[index];
        const data = await resolveDataSource(stageJson);
        if (data == null) return; // silent -- preloading is a background optimization, not something that should surface errors to the user

        const dspEngine = createDspEngine(stageJson.dspEngine);
        const dspOutput = dspEngine.process(data);
        if (!dspOutput) return;

        dspOutputCache.set(index, { dspOutput, data });

        if (stageJson.stageOutput) {
            const exported = {};
            stageJson.stageOutput.exportedFields.forEach(field => {
                exported[field] = dspOutput.finalOutput[field];
            });
            stageOutputs[stageJson.stageOutput.exportKey] = exported;
            stageOutputMeta[stageJson.stageOutput.exportKey] = data?.meta ?? {};
        }
    }

    async function buildStage(index) {
        const stageJson = journeyJson.stages[index];

        // Analytics: which stage, of which journey, on which sample.
        // typeof-guarded so the interpreter still runs if
        // event_collector.js isn't loaded (e.g. a bare test page).
        if (typeof trackEvent === "function") {
            trackEvent("stage_started", sampleId, {
                stage_index: index,
                stage_id:    stageJson?.stageId ?? null,
            });
        }

        const cached = dspOutputCache.get(index);
        const data = cached ? cached.data : await resolveDataSource(stageJson);
        globalThis.__bootSplash?.step("running the algorithm");
        if (data == null) {
            chartContainer.innerHTML = `<p style="color:#ff4d4d; padding:20px;">Could not resolve this stage's input data (check console).</p>`;
            return;
        }

        // dspEngine lives at JOURNEY scope keyed by stageIndex, not
        // recreated on every buildStage() call. Without this, any
        // algorithm switch (dspEngine.switchAlgorithm()) is lost the
        // moment the user navigates away and back -- buildStage() would
        // create a fresh dspEngine reset to isDefault:true, silently
        // discarding the user's choice.
        if (!dspEngines.has(index)) {
            const eng = createDspEngine(stageJson.dspEngine);
            // SESSION MEMORY: a choice made on one card carries to the
            // next card of the same journey+stage. Without it a viewer
            // who picks "no oxygen" has to pick it again on every card,
            // which makes the control feel broken rather than sticky.
            //
            // Deliberately in memory only -- this is a preference for
            // right now, not a setting. Surviving a reload would need a
            // stable identity, which is a product decision.
            const mem = (globalThis.__railMemory ??= new Map());
            for (const [k, v] of mem) {
                const [j, s, key] = k.split("::");
                if (j === memKey && s === stageJson.stageId) {
                    eng.setParameter({ key, value: v });
                }
            }
            dspEngines.set(index, eng);
        }
        const dspEngine = dspEngines.get(index);

        const renderingEngine = createRenderingEngine(stageJson.renderingEngine);
        const context = { dspEngine, renderingEngine, journey: journeyTarget };

        dispatch({ target: "renderingEngine", method: "applyTheme", payload: getActiveTheme() }, context);

        // Computed ONCE, used for BOTH the renderer's actual animation AND
        // the auto-advance timer AND the progress bar fill -- all three
        // must agree, or you get exactly the bug caught earlier (animation
        // visually finishes while auto-advance keeps waiting).
        // `let`, not `const`: the speed control changes this AFTER the
        // stage is built, and the renderer captured the old value when it
        // started its sweep. Tapping speed used to change only the icon
        // while the animation carried on at its original pace.
        let actualDuration = (stageJson.baseDurationMs || STAGE_DURATION_MS) / journeyTarget.getSpeed();

        function runAndRender(precomputedOutput) {
            const dspOutput = precomputedOutput || dspEngine.process(data);
            if (!dspOutput) {
                chartContainer.innerHTML = `<p style="color:#ff4d4d; padding:20px;">This algorithm isn't implemented yet (check console for details).</p>`;
                return;
            }
            // Clear container before rendering -- without this, switching
            // renderers via the rail button leaves the previous renderer's
            // output visible underneath the new one (two plots on screen).
            // Each renderer also clears internally (Plotly.purge, innerHTML="")
            // but only when it recognises its own previous state -- a Canvas
            // renderer switching to Plotly won't find _fullLayout, so Plotly
            // wouldn't purge the stale Canvas element.
            if (chartContainer._fullLayout) Plotly.purge(chartContainer);
            else chartContainer.innerHTML = "";

            // Expose active renderer/algorithm/card to the dev HUD.
            // These are global -- last-write-wins across all cards.
            // The HUD shows sampleId so you can tell which card's values
            // are currently displayed.
            globalThis._DEV_ACTIVE_RENDERER  = renderingEngine.getActiveRenderer();
            globalThis._DEV_ACTIVE_ALGORITHM = dspEngine.getActiveAlgorithm();
            globalThis._DEV_ACTIVE_SAMPLE    = sampleId;
            globalThis._DEV_ACTIVE_STAGE     = currentStageIndex;

         //   renderingEngine.render(chartContainer, dspOutput, sampleId, data.fs, actualDuration);
            renderingEngine.render(chartContainer, dspOutput, sampleId, data.fs, actualDuration);

            // Annotations mount AFTER render, never before. render() clears
            // the container and calls startSweepLoop(), which replaces the
            // whole activeSweepControl entry with a fresh, unwrapped drawFn
            // -- so mounting first would attach the overlay to a container
            // about to be emptied and wrap a function about to be thrown
            // away. Mounting after is also what keeps the drawFn wrapper
            // from stacking across re-renders.
            if (typeof mountAnnotations === "function") {
                mountAnnotations(chartContainer, stageJson, sampleId, dspOutput);
            }
            // AFTER annotations, deliberately. Both wrap the sweep's
            // drawFn, so mounting effects second makes the chain run
            // renderer -> annotations -> pulse. It also pairs with
            // unmounting in reverse in goToStage(), which is what lets
            // each layer recognise its OWN wrapper and restore cleanly.
            //
            // Attaches nothing at all unless the active theme asks for
            // effects, so the sober themes pay no compositing cost for a
            // feature they are not using.
            if (typeof mountEffects === "function") {
                mountEffects(chartContainer, sampleId, dspOutput);
            }



            if (stageJson.stageOutput) {
                const exported = {};
                stageJson.stageOutput.exportedFields.forEach(field => {
                    exported[field] = dspOutput.finalOutput[field];
                });
                stageOutputs[stageJson.stageOutput.exportKey] = exported;
                stageOutputMeta[stageJson.stageOutput.exportKey] = data?.meta ?? {};
            }
        }
        // BEFORE updateProgressBar, and that order is load-bearing.
        //
        // The bar's fill has no animation-duration in CSS -- JS sets it
        // per stage. Created after updateProgressBar, the element did not
        // exist when the duration was assigned, so it kept the CSS
        // default of 0s: the animation completed instantly and
        // fill-mode:forwards held the END state, which is a bar that is
        // FULL from the first frame of every stage. The dot was fine
        // because it is built once, up front, by buildProgressBar().
        //
        // Created lazily and once per card: the element outlives every
        // stage, so only its duration changes.
        ensureScrubBar();

        runAndRender(cached ? cached.dspOutput : null);

        // Collapse the text overlay on every stage change. Without this,
        // text left open on stage 1 stays open over stage 2's render --
        // and the user never asked to read stage 2's description.
        if (titleEl) {
            titleEl.closest(".layout-zone")?.classList.remove("text-expanded");
        }

        // ── TEMPLATED COPY ─────────────────────────────────────────────
        // {pathway.name} and friends are filled from the envelope, so one
        // recipe can serve fifteen samples without claiming the same
        // thing about all of them. A static "Follow The Carbon" is wrong
        // on a compiler pipeline and worse on a clinical model.
        //
        // Unresolved tokens are left as-is rather than blanked: a visible
        // {typo} on the card is far easier to notice than a sentence
        // that silently lost half its meaning.
        //
        // TWO SUBSTITUTIONS, deliberately different syntax:
        //
        //   {pathway.name}   envelope meta  -- varies by SAMPLE
        //   {{L2CAP}}        glossary term  -- varies by THEME
        //
        // Double braces for terms so the two cannot collide: a glossary
        // key is a bare word and would otherwise be indistinguishable
        // from a one-segment meta path, and the failure would be silent
        // in whichever direction lost.
        //
        // TERMS RESOLVE FIRST, because a term's short form is fixed text
        // that could never contain a meta path, while a meta VALUE could
        // plausibly contain an acronym in braces one day. Doing meta
        // second means a substituted value is never re-scanned for terms,
        // which is the behaviour you want: data is data, not a template.
        // ARTICLE-AWARE, and it has to be. A short form is a noun phrase
        // and carries its article -- "the multiplexing layer" -- because
        // a token often opens a sentence:
        //
        //     "{{L2CAP}} adds four bytes"
        //       -> "the multiplexing layer adds four bytes"   correct
        //
        // But an acronym takes no article, so prose written for the jargon
        // register puts the determiner in itself:
        //
        //     "marks each {{R_PEAK}}"
        //       -> "marks each the beat's peak"               broken
        //
        // One stored form cannot satisfy both, and the asymmetry is in the
        // language rather than in the data. So the substitution drops a
        // leading article when the token already follows a determiner.
        // Mechanical, and it means nobody writing a card has to remember
        // the rule -- which is the only kind of rule that survives.
        const DETERMINER = /(?:^|\s)(?:a|an|the|each|every|this|that|those|these|its|their)\s+(?:\w*[-\d][\w-]*\s+){0,2}$/i;
        const fill = (s) => {
            let out = String(s ?? "");
            out = out.replace(/\{\{(\w+)\}\}/g, (whole, key, offset, full) => {
                const term = journeyGlossary[key];
                // Left as-is rather than blanked, same rule as below: a
                // visible {{TYPO}} on the card is far easier to notice
                // than a sentence that silently lost its subject.
                if (!term) return whole;
                if (activeTermLevel() !== "plain") return term.acronym ?? key;

                let text = term.short ?? term.acronym ?? key;
                if (DETERMINER.test(full.slice(0, offset))) {
                    text = text.replace(/^(?:the|a|an)\s+/i, "");
                }
                // Emoji only in the plain register, and only where the
                // glossary bothered to set one -- it is sparse on purpose.
                return (term.emoji ? term.emoji + " " : "") + text;
            });
            out = out.replace(/\{([\w.]+)\}/g, (whole, path) => {
                const v = path.split(".").reduce((o, k) => o?.[k], lastEnvelope?.meta);
                return v === undefined || v === null ? whole : String(v);
            });
            return out;
        };

        // Extracted so the Theme button can RE-RUN it. The prose now
        // depends on the active theme (via termLevel), and cycleTheme only
        // re-rendered the plot -- so switching theme changed the picture
        // and left the words in the previous register. Assigning the text
        // in one named place is what makes "re-apply the copy" a thing
        // that can be asked for.
        function applyCopy() {
            if (titleEl) titleEl.textContent = fill(stageJson.uiFillers.title);
            if (captionEl) captionEl.textContent = fill(stageJson.uiFillers.caption);
            if (descriptionEl) descriptionEl.textContent = fill(stageJson.uiFillers.description || "");
        }
        applyCopy();
        // Exposed on the card so the rail handler can reach it without
        // threading a reference through every closure in between.
        chartContainer.__kymoApplyCopy = applyCopy;
        updateProgressBar(index, actualDuration);

        // Wrapped so it can be RE-RUN. Switching the renderer changes
        // which choices() exist -- the map view declares none, the
        // navigator declares Show -- but a switch only re-rendered the
        // stage, never the rail. The button could therefore not appear
        // until the stage was rebuilt, which looked exactly like a
        // deployment failure.
        function buildRail() {
            railContainer.innerHTML = "";

            // ── CONTROLS THE DSPE DECLARES ─────────────────────────────────
            // choices(envelope) asks the algorithm what can be varied FOR
            // THIS DATA, instead of the recipe asserting it. That is the fix
            // for a control appearing where it means nothing -- a "Route"
            // button sat on the citric acid cycle doing nothing, because no
            // reaction there was ever conditional.
            //
            // The recipe keeps veto power (hide, rename) but cannot invent an
            // option the DSPE did not declare -- inventing is how a button
            // ends up setting a parameter nothing reads.
            const derived = [];
            try {
                const algoId = dspEngines.get(index)?.getActiveAlgorithm?.();
                const algo   = algoId ? DSP_ALGORITHMS[algoId] : null;

                // The renderer gets asked as well: a VIEW preference has no
                // home on the DSPE, and hardcoding it in the recipe means it
                // cannot read the model's vocabulary.
                const rendId = renderingEngine?.getActiveRenderer?.();
                const rend   = rendId ? RENDER_ALGORITHMS[rendId] : null;
                const declared = [
                    ...(algo?.choices?.(lastEnvelope) ?? [])
                        .map(c => ({ ...c, _target: "dspEngine" })),
                    ...(rend?.choices?.(lastEnvelope) ?? [])
                        .map(c => ({ ...c, _target: "renderingEngine" })),
                ];
                for (const ch of declared) {
                    const override = stageJson.choiceControls?.[ch.key] ?? {};
                    if (override.hide) continue;
                    // The button shows the CURRENT VALUE, not the variable
                    // name. "Oxygen" alone tells you what the button is about
                    // but not which state you are in -- and the whole point
                    // of the control is that the two states differ.
                    // Seed the parameter from the data's effective value if
                    // the user has not chosen yet. Without this the button
                    // read "Oxygen: undefined", because the default lives in
                    // the pathway data and never reached dspEngine.parameters.
                    //
                    // Seeded from choices().value, NOT from the pathway
                    // default alone -- a sample that sets its own conditions
                    // (the anaerobic card) would otherwise be overridden by
                    // the default the moment the rail was built.
                    const eng = ch._target === "renderingEngine"
                              ? renderingEngine : dspEngines.get(index);
                    let now = eng?.getParameter?.(ch.key);
                    if (now === undefined && ch.value !== undefined) {
                        eng?.setParameter?.({ key: ch.key, value: ch.value });
                        now = ch.value;
                    }
                    const shown = ch.display?.[String(now)] ?? now;
                    // The button carries the VARIABLE only -- "Oxygen" --
                    // because the rail is a row of ~46px circles and
                    // "Oxygen: present" does not fit. The card header already
                    // states the values, so the state is never hidden; the
                    // tooltip repeats it for anyone hovering.
                    const derivedLabel = override.label ?? ch.label ?? ch.key;
                    derived.push({
                        // THREE TIERS, most specific first: the recipe can
                        // name a glyph, the choice itself can declare one
                        // (nothing does yet -- this is the field to add when
                        // an engine wants to be explicit), and failing both
                        // the key/label pattern match has a go. All three
                        // can come back null, which means text, as before.
                        ui: { label: derivedLabel,
                              icon: override.icon ?? ch.icon
                                    ?? resolveDerivedIcon(ch, derivedLabel) },
                        _valueNow: shown,
                        action: { target: ch._target ?? "dspEngine", method: "setParameter",
                                  payload: { key: ch.key, operation: "cycle",
                                             options: ch.values } },
                        _choice: ch,
                    });
                }
            } catch (e) {
                // A broken choices() must not cost the whole rail -- the
                // recipe's own controls still work.
                console.warn("choices() failed:", e);
            }

            // Derived buttons show a VALUE, so their label goes stale the
            // moment it changes. A tap recomputes the stage but does not
            // rebuild the rail, so without refreshing here the button reads
            // "Oxygen: present" for ever while the walk actually changed.
            const derivedButtons = [];

                // SHARE IS UNIVERSAL, so the engine adds it rather than ten
            // recipes repeating it. Everything it needs -- the journey
            // name and the sample -- is already here; nothing about it
            // varies by journey, stage or algorithm.
            //
            // Declaring it per recipe produced exactly the failures that
            // implies: one journey missed it entirely, and three had it
            // on stage 1 only. A recipe can still opt out with
            // "share": false.
            // ── UNIVERSAL CONTROLS, added by the engine ────────────────
            // Declared here rather than in ten recipes, for the reason
            // Share already proved: declaring it per recipe produced one
            // journey that missed it entirely and three that had it on
            // stage 1 only. Anything whose behaviour is identical on every
            // journey belongs to the engine.
            //
            // Each can still be refused by the recipe -- "share": false,
            // "depth": false -- so a journey that genuinely should not
            // offer one has a way to say so.
            const universal = [];
            if (stageJson.share !== false) {
                universal.push({
                    ui: { label: "Share", icon: "icon_share" },
                    action: { target: "journey", method: "share", payload: {} },
                });
            }
            // Depth is also gated on whether it would DO anything here --
            // see journeyExplains. The recipe's "depth": false is a veto
            // on top of that, not a way to force it on.
            if (journeyExplains && stageJson.depth !== false) {
                universal.push({
                    ui: { label: "Depth", icon: "icon_depth" },
                    action: { target: "journey", method: "cycleDepth", payload: {} },
                });
            }

            [...stageJson.railControls, ...universal, ...derived].forEach(control => {
                const btn = document.createElement("button");
                btn.className = "rail-btn";
                btn.title = control.ui.label;

                // STABLE HANDLES for anything that needs to find one
                // specific button later -- gesture_hints.js, currently.
                //
                // Neither of the obvious handles works. POSITION is
                // meaningless: this rail is rebuilt on every stage change
                // and choices() adds buttons at runtime, so
                // ".rail-btn:nth-child(3)" is a different control on
                // every card. TITLE is worse than meaningless: three
                // lines below, refreshButtonContent() rewrites it to
                // "Algorithm: pan_tompkins", so a selector matching
                // "Algorithm" matches for a few milliseconds and then
                // never again.
                //
                // railMethod is the better of the two: ui.label is recipe
                // prose and differs between journeys, while the action
                // method is the dispatcher's own verb and is identical
                // everywhere.
                btn.dataset.railLabel  = control.ui.label;
                btn.dataset.railMethod = control.action.method;

                // BOOLEANS ONLY, and null for everything else.
                //
                // A derived control also dispatches setParameter, but with
                // operation "cycle" over a list of values -- those are not
                // toggles and must not get an on-state. Testing the VALUE's
                // type rather than the operation string catches that without
                // depending on a recipe spelling "toggle" correctly, and a
                // two-value cycle of true/false is a toggle whatever it calls
                // itself.
                function toggleStateOf(ctl) {
                    if (ctl.action.method !== "setParameter") return null;
                    const key = ctl.action.payload?.key;
                    if (!key) return null;
                    const tgt = context[ctl.action.target];
                    const v = tgt?.getParameter?.(key);
                    return typeof v === "boolean" ? v : null;
                }

                function refreshButtonContent() {
                    const valueDisplay = VALUE_DISPLAY_METHODS[control.action.method];
                    if (valueDisplay) {
                        const targetObj = context[control.action.target];
                        const currentValue = targetObj[valueDisplay.getMethod]();
                        const short = valueDisplay.labelMap?.[currentValue]
                                      ?? shortenId(currentValue);
                        const shown = short + valueDisplay.suffix;
                        // Glyph AND value now, not the value alone. The last
                        // argument is the text to fall back to if the glyph
                        // ever goes missing -- the value, not the label,
                        // because that is what this button was showing before.
                        paintRailButton(btn, valueDisplay.icon, shown, null, shown);
                        // Full id in the tooltip -- the label under the glyph
                        // has room for three characters, not
                        // "hamilton_tompkins".
                        btn.title = `${control.ui.label}: ${currentValue}`;
                    } else if (control.action.method === "cycleSpeed") {
                        // Dynamic, not a static RAIL_ICONS lookup -- the needle
                        // angle reflects the CURRENT speed, read fresh every
                        // time this runs (including right after a click, so it
                        // updates immediately).
                        //
                        // AND A VALUE LABEL NOW. The glyph says "speed" and the
                        // label says which -- the split that let the chevrons
                        // go. "0.25x" is five characters, which is why the
                        // ladder stops at two decimal places.
                        const speedNow = journeyTarget.getSpeed();
                        paintRailButton(btn, null, formatSpeed(speedNow),
                                        buildSpeedIcon(speedNow));
                        btn.title = `${control.ui.label}: ${formatSpeed(speedNow)}`
                                  + ` (hold to slow down)`;
                    } else if (control.action.method === "cycleDepth") {
                        // Glyph says whether help is turned up; the label
                        // says which stop. Read fresh, like Speed, so a
                        // tap updates it immediately.
                        const d = typeof getActiveDepth === "function"
                                ? getActiveDepth() : null;
                        paintRailButton(btn,
                            d && d.id === "basic" ? "icon_depth_off" : "icon_depth",
                            d ? d.label : null, null, control.ui.label);
                        btn.title = d
                            ? `${control.ui.label}: ${d.label}`
                            : control.ui.label;
                    } else if (control._choice) {
                        // Derived: glyph resolved at push time, value beneath.
                        // Falls back to the VARIABLE name rather than the
                        // value, which is what an unglyphed derived button
                        // showed before -- "hidden" in 0.72rem mono does not
                        // fit 40px, and the tooltip carries it anyway.
                        paintRailButton(btn, control.ui.icon, control._valueNow,
                                        null, control.ui.label);
                    } else {
                        // Recipe control. paintRailButton already falls back to
                        // text when ui.icon names nothing in RAIL_ICONS, so the
                        // old icon-or-text pair of branches collapses to one
                        // call -- and Share, whose icon was missing from
                        // RAIL_ICONS entirely, now resolves instead of landing
                        // here.
                        //
                        // A BOOLEAN ONE ALSO REPORTS ITS STATE. Invert is the
                        // case that prompted this: it changed the picture and
                        // then looked exactly as it had before, so the only way
                        // to know whether the trace was flipped was to read the
                        // trace. See ICON_ON_VARIANTS.
                        const on = toggleStateOf(control);
                        if (on === null) {
                            // Not a toggle -- an action, or a cycling value.
                            // Deliberately REMOVED rather than left alone: a
                            // rail is rebuilt on every stage change and a
                            // stale aria-pressed on a control that is not a
                            // toggle is a lie to a screen reader.
                            btn.removeAttribute("aria-pressed");
                            paintRailButton(btn, control.ui.icon, null,
                                            null, control.ui.label);
                        } else {
                            // aria-pressed is the attribute a toggle button is
                            // supposed to carry, and it is what the CSS styles
                            // off -- one source of truth rather than a class
                            // and an attribute that can disagree.
                            btn.setAttribute("aria-pressed", String(on));
                            const variant = on
                                ? ICON_ON_VARIANTS[control.ui.icon]
                                : null;
                            paintRailButton(btn, variant ?? control.ui.icon,
                                            null, null, control.ui.label);
                            btn.title = `${control.ui.label}: ${on ? "on" : "off"}`;
                        }
                    }
                }
                refreshButtonContent();

                // Register derived buttons so their value can be refreshed
                // after a tap. _choice is attached only to controls that came
                // from choices(), so recipe controls are untouched.
                if (control._choice) {
                    btn.title = `${control.ui.label}: ${control._valueNow}`;
                    derivedButtons.push({
                        btn,
                        choice: control._choice,
                        labelBase: control.ui.label,
                        // Carried so the refresh below can repaint the
                        // button without re-running the pattern match.
                        icon: control.ui.icon,
                    });
                }

                // ── TAP SPEEDS UP, HOLD SLOWS DOWN ─────────────────────
                // One cycling button wraps, so every step is reachable --
                // but only forwards, and from 1x that is three taps to
                // reach 0.5x. The slow steps are exactly the ones wanted
                // when something is already going too fast to read, so
                // making them the furthest away is backwards.
                //
                // IT ACTS ON RELEASE, NOT AT THE THRESHOLD. The hold only
                // sets the DIRECTION; the click that follows does all the
                // work, through the one handler below. Firing at 420ms
                // instead would mean a second copy of that handler's cache
                // eviction, re-render and timer arithmetic, and two copies
                // of that is how the auto-advance timer got out of step
                // twice already.
                //
                // pointerup always precedes click, so the direction is in
                // place by the time dispatch runs.
                //
                // THE CLASS IS NOT DECORATION. The press does nothing
                // until release, so without a mark at 420ms a hold feels
                // like a tap that was ignored for half a second -- and
                // "the control did nothing" is the bug this rail has
                // already been debugged for twice.
                if (control.action.method === "cycleSpeed") {
                    const HOLD_MS = 420;
                    let holdTimer = null;
                    let held = false;

                    const clearHold = () => {
                        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
                        btn.classList.remove("rail-held");
                    };

                    btn.addEventListener("pointerdown", () => {
                        held = false;
                        clearHold();
                        holdTimer = setTimeout(() => {
                            held = true;
                            btn.classList.add("rail-held");
                        }, HOLD_MS);
                    });

                    btn.addEventListener("pointerup", () => {
                        speedStepDirection = held ? -1 : 1;
                        held = false;
                        clearHold();
                    });

                    // A finger that slides off the button fires neither
                    // pointerup nor click here, so the direction would be
                    // left at whatever the last gesture set. Reset it
                    // rather than leave a -1 lying in wait for the next
                    // ordinary tap.
                    const abandon = () => {
                        held = false;
                        clearHold();
                        speedStepDirection = 1;
                    };
                    btn.addEventListener("pointercancel", abandon);
                    btn.addEventListener("pointerleave", abandon);
                }

                btn.addEventListener("click", () => {
                    dispatch(control.action, context);

                    // Anything that changes what this stage COMPUTES makes
                    // its cached output stale, and also makes every LATER
                    // stage stale -- because a pipeline stage consumes this
                    // one's export.
                    //
                    // Two bugs lived here:
                    //
                    //   1. Only switchAlgorithm cleared the cache.
                    //      setParameter -- which is what the Invert button
                    //      dispatches -- did not, so inverting re-ran the
                    //      renderer against the SAME cached DSP output.
                    //
                    //   2. Only the CURRENT stage was cleared. With
                    //      preloadNextStage on, the next stage has ALREADY
                    //      been computed from this stage's pre-change output.
                    //      Inverting at stage 1 then navigating to stage 2
                    //      showed the old, un-inverted beats -- and inverting
                    //      a second time changed nothing either, because the
                    //      stale entry was never evicted.
                    //
                    // Clearing forward rather than everything: earlier stages
                    // do not depend on this one, so their cache is still
                    // valid and recomputing them would be wasted work.
                    // Remember what the user just chose, so the next card of
                    // this journey+stage starts there.
                    if (control.action.method === "setParameter" && control.action.payload?.key) {
                        const eng = dspEngines.get(index);
                        const key = control.action.payload.key;
                        const val = eng?.getParameter?.(key);
                        if (val !== undefined) {
                            (globalThis.__railMemory ??= new Map())
                                .set(`${memKey}::${stageJson.stageId}::${key}`, val);
                        }
                    }

                    // Refresh every derived label from the engine's CURRENT
                    // parameters -- not just this button's, since one choice
                    // can change what another means.
                    for (const d of derivedButtons) {
                        const src = d.choice._target === "renderingEngine"
                                  ? renderingEngine : dspEngines.get(index);
                        const v = src?.getParameter?.(d.choice.key);
                        const shownNow = d.choice.display?.[String(v)] ?? v;
                        // THE VISIBLE VALUE NOW, not just the tooltip. The
                        // glyph is fixed and the label lives in a fixed-size
                        // box, so repainting cannot reflow the rail -- which
                        // is the reason the value used to be tooltip-only.
                        // And a tooltip is not a thing a phone has.
                        paintRailButton(d.btn, d.icon, shownNow,
                                        null, d.labelBase);
                        d.btn.title = `${d.labelBase}: ${shownNow}`;
                    }

                    // Speed changes the DURATION the renderer was handed, so
                // the stage is re-rendered at the new pace. It restarts
                // from the beginning of the stage -- honest and
                // predictable, where resuming mid-sweep at a new speed
                // would need the sweep loop to rescale its own clock.
                // Canvas renderers read the theme when they DRAW, so a
                // theme change is invisible until something redraws.
                // Updating themeIndex and the CSS variables is enough for
                // DOM-styled parts and nothing else -- which is why a
                // skinned renderer appeared stuck on whichever theme
                // happened to be active when the card was built.



//                if (control.action.method === "cycleTheme") {
//                    runAndRender(index);
//                }
//
//                if (control.action.method === "cycleSpeed") {
//                    actualDuration = (stageJson.baseDurationMs || STAGE_DURATION_MS)
//                                   / journeyTarget.getSpeed();
//                    updateProgressBar(index, actualDuration);
//                    runAndRender(index);
//                }


                // cycleTheme needs no render call of its own -- the
                // unconditional runAndRender() at the end of this handler
                // covers it, and Canvas renderers read the theme when they
                // DRAW, so that redraw is what picks the new one up.
                //
                // It DOES need the copy re-applied, though. A theme now
                // carries termLevel, so the prose register changes with it
                // -- and runAndRender only touches the plot. Without this
                // the picture switched to Arcade while the words stayed in
                // Clinical's jargon, which looks like the switch is broken
                // rather than unwired.
                //
                // cycleDepth is here for the SAME reason and is in fact
                // the one that needs it: Depth is what moves termLevel
                // now, so without this the plot would redraw with new
                // annotation density while every sentence stayed in the
                // previous register. cycleTheme is kept alongside it
                // because a theme still changes the glyphs an annotation
                // is drawn with, and those carry labels.
                if (control.action.method === "cycleTheme" ||
                    control.action.method === "cycleDepth") {
                    chartContainer.__kymoApplyCopy?.();
                }
                //
                // These two blocks used to call runAndRender(index). That
                // argument lands on the `precomputedOutput` parameter, so
                // the renderer was handed the NUMBER 1 as its dspOutput on
                // any stage past the first and threw on .finalOutput --
                // killing the rest of this handler, including the real
                // render below. Stage 0 escaped it only because 0 is falsy.
                if (control.action.method === "cycleSpeed") {
                    actualDuration = (stageJson.baseDurationMs || STAGE_DURATION_MS)
                                   / journeyTarget.getSpeed();
                    updateProgressBar(index, actualDuration);
                }

                


                // Changing the renderer or the algorithm can change
                // WHICH controls exist, so the rail is rebuilt. Not for
                // setParameter: that changes a value, not the option set,
                // and rebuilding would discard the button being clicked.
                if (control.action.method === "switchRenderer" ||
                    control.action.method === "switchAlgorithm") {
                    setTimeout(buildRail, 0);   // after this handler returns
                }

                const RECOMPUTE_METHODS = ["switchAlgorithm", "setParameter"];
                    if (RECOMPUTE_METHODS.includes(control.action.method)) {
                        for (const idx of [...dspOutputCache.keys()]) {
                            if (idx >= currentStageIndex) dspOutputCache.delete(idx);
                        }
                        // stageOutputs feeds PREVIOUS_STAGE_PIPELINE stages.
                        // Leaving stale exports there means a later stage
                        // reads pre-change data even after its own cache is
                        // cleared.
                        for (let i = currentStageIndex; i < journeyJson.stages.length; i++) {
                            const key = journeyJson.stages[i]?.stageOutput?.exportKey;
                            if (key) delete stageOutputs[key];
                        }
                    }








                    //runAndRender();
                    //refreshButtonContent();

                                        // WHERE WE ARE, AS A FRACTION, BEFORE THE RE-RENDER
                    // WIPES IT. runAndRender() makes the renderer register
                    // a brand-new sweep control starting at 0, so the only
                    // chance to read the old position is now.
                    //
                    // A fraction, not milliseconds, because Speed is one of
                    // the buttons that lands here: the new stage duration
                    // can differ from the old one, and the viewer's place in
                    // the stage is a proportion, not a timestamp.
                    const prevCtl  = activeSweepControl.get(sampleId);
                    const heldFrac = (isPaused && prevCtl && prevCtl.totalDurationMs > 0)
                        ? Math.min(1, Math.max(0,
                              prevCtl.lastElapsedMs / prevCtl.totalDurationMs))
                        : 0;

                    runAndRender();
                    refreshButtonContent();












                    // Both the progress bar AND the auto-advance timer must
                    // restart unconditionally when any rail button is clicked --
                    // runAndRender() restarts the sweep from 0, so the timer
                    // that was set during the ORIGINAL buildStage() call is now
                    // stale. Without this, the original timer fires at the
                    // original deadline regardless of how many times the renderer
                    // or algorithm was switched, silently advancing to the next
                    // stage at the wrong time.
                    if (autoAdvanceTimer) {
                        clearTimeout(autoAdvanceTimer);
                        autoAdvanceTimer = null;
                    }
                    updateProgressBar(currentStageIndex, actualDuration);
                    if (!isPaused && journeyJson.journeyRules.autoAdvance && currentStageIndex < journeyJson.stages.length - 1) {
                        autoAdvanceEndTime = performance.now() + actualDuration;
                        // Analytics: stage ran to completion (as opposed to being
                        // skipped by a tap or a card exit).
                        if (typeof trackEvent === "function") {
                            setTimeout(() => trackEvent("stage_completed", sampleId, {
                                stage_index: index,
                                stage_id:    stageJson?.stageId ?? null,
                                elapsed_ms:  actualDuration,
                            }), actualDuration);
                        }

                        autoAdvanceTimer = setTimeout(() => goToStage(currentStageIndex + 1), actualDuration);
                    }

            //        if (isPaused) {
            //            isPaused = false;
            //        }
            
        


                                // A RAIL CONTROL CHANGES WHAT IS SHOWN, NEVER WHETHER
                    // IT IS PLAYING.
                    //
                    // This used to be `if (isPaused) { isPaused = false; }`,
                    // which un-paused silently and left three things out of
                    // step: the sweep ran, the play glyph stayed on screen
                    // because flashPlayback() was never called, and
                    // auto-advance stayed off because the timer block above
                    // had already been skipped on the old value of isPaused.
                    //
                    // Same rule the scrub bar already follows: someone who
                    // paused is inspecting a moment, and taking it away
                    // because they pressed Invert is the opposite of what
                    // they asked for.
                    if (isPaused) {
                        const hold = () => {
                            // The renderer has just started a fresh sweep.
                            cancelSweepAnimation(sampleId);
                            const ctl = activeSweepControl.get(sampleId);
                            if (!ctl) return false;
                            const at = heldFrac * ctl.totalDurationMs;
                            ctl.lastElapsedMs = at;
                            try {
                                ctl.drawFn(at);
                            } catch (err) {
                                console.error("[JOURNEY] paused redraw failed", err);
                            }
                            // Same arm-then-offset the scrub bar uses: the
                            // fill was just restarted RUNNING by
                            // updateProgressBar above.
                            armFillsForSeek();
                            eachFill(f => seekFill(f, at));
                            return true;
                        };
                        // Twice, because a renderer that registers its sweep
                        // control asynchronously would not be there on the
                        // first pass. The second call is idempotent -- same
                        // frame, same position.
                        if (!hold()) requestAnimationFrame(hold);
                    }
                    
        
        
        
        });
                railContainer.appendChild(btn);
            });
        }
        buildRail();

        if (journeyJson.journeyRules.preloadNextStage) {
            preloadStage(index + 1);
        }

        if (journeyJson.journeyRules.autoAdvance && index < journeyJson.stages.length - 1) {
            autoAdvanceEndTime = performance.now() + actualDuration;
            autoAdvanceTimer = setTimeout(() => goToStage(index + 1), actualDuration);
        }
    }

    async function goToStage(index) {
        if (index < 0 || index >= journeyJson.stages.length) return;
        if (autoAdvanceTimer) {
            clearTimeout(autoAdvanceTimer);
            autoAdvanceTimer = null;
        }
        isPaused = false; // a fresh stage always starts playing, never inherits the previous stage's paused state
        // ...AND NEITHER DOES THE GLYPH. flashPlayback() leaves a
        // .playback-flash element on the card whose paused animation is
        // `forwards`, so it HOLDS at full opacity on purpose -- it is an
        // affordance saying "tap to resume", not a confirmation. Nothing
        // removed it on a stage change, so: pause stage 2, step to stage
        // 3, come back, and the play triangle was still sitting there
        // over a stage that was running. isPaused was correct the whole
        // time; the only thing wrong was the picture of it.
        //
        // Removed rather than hidden, same reasoning as the boot splash:
        // it sits at z-index 45 and a stale overlay is worse than none.
        clearPlaybackFlash();
        // Belonged to the stage being left. Harmless today because
        // pausing recomputes it, but it is a value from one stage
        // sitting in a variable another stage reads.
        autoAdvanceRemainingMs = null;
        offscreenRemainingMs = null;
        cancelSweepAnimation(sampleId);


        // The overlay's DOM dies with the container on the next render,
        // but its drawFn wrapper and bookkeeping object outlive it. Left
        // in place, the wrapper would keep positioning marks against the
        // PREVIOUS stage's projection.
        // REVERSE of the mount order. Effects wrapped the annotation
        // wrapper, so unwinding outermost-first is what lets each one see
        // its own wrapper still installed and put back the right function.
        // Unwinding the other way leaves the inner wrapper in place,
        // closed over the previous render's canvas.
        if (typeof unmountEffects === "function") {
            unmountEffects(chartContainer, sampleId);
        }
        if (typeof unmountAnnotations === "function") {
            unmountAnnotations(chartContainer, sampleId);
        }


        
        currentStageIndex = index;
        await buildStage(currentStageIndex);
    }

    // Pauses/resumes THREE things together, so they can't drift apart:
    // the sweep animation itself, the auto-advance timer, and the
    // progress bar's visual fill.
    // Centre-screen confirmation that the tap landed. Lives on the
    // card, so it cannot appear over a different short if the user
    // scrolls while it is fading.
    function flashPlayback(paused) {
        const card = chartContainer?.closest(".journey-card");
        if (!card) return;
        let el = card.querySelector(".playback-flash");
        if (!el) {
            el = document.createElement("div");
            el.className = "playback-flash";
            el.setAttribute("aria-hidden", "true");
            card.appendChild(el);
        }

        // PAUSED shows a PLAY glyph -- the icon names the action
        // available, not the state you are in. Showing a pause bar while
        // already paused tells the viewer nothing they can act on.
        el.innerHTML = paused
            ? `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>`
            : `<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/>`
              + `<rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/></svg>`;

        // Remove BOTH classes, force a reflow, then apply the right one:
        // without the reflow the browser coalesces the changes and the
        // animation never restarts, so a second tap shows nothing.
        el.classList.remove("paused", "playing");
        void el.offsetWidth;
        el.classList.add(paused ? "paused" : "playing");
    }

    // The one place that owns taking the glyph away. Every path that
    // changes stage goes through goToStage, so there is exactly one
    // call site -- which is why this could not drift again.
    function clearPlaybackFlash() {
        chartContainer?.closest(".journey-card")
                      ?.querySelector(".playback-flash")?.remove();
    }

    // Brief text confirmation, reusing the playback indicator's slot so
    // it lands where the eye already is after a tap.
    function flashMessage(text) {
        const card = chartContainer?.closest(".journey-card");
        if (!card) return;
        let el = card.querySelector(".toast-flash");
        if (!el) {
            el = document.createElement("div");
            el.className = "toast-flash";
            card.appendChild(el);
        }
        el.textContent = text;
        el.classList.remove("show");
        void el.offsetWidth;
        el.classList.add("show");
    }


    // ── MANUAL SCRUB ────────────────────────────────────────────────────
    // Drag HORIZONTALLY across the card to move through the stage, and
    // it resumes where you let go.
    //
    // Horizontal, not vertical: vertical belongs to the feed, and a
    // scrub that sometimes steals a swipe to the next short would make
    // the whole feed feel unreliable. Horizontal always means the same
    // thing, on a ring, a chain or a sweep -- the scrub bar is its own
    // control, not a map of the layout.
    //
    // The auto-sweep and the scrub never fight, because both write to
    // ONE number: the loop advances elapsed each frame, the drag sets it.
    let scrub = null;
    let suppressClickUntil = 0;

    // ── SEEKING THE PROGRESS DOT ────────────────────────────────────────
    // The current dot's fill is a CSS ANIMATION (.segment.current .fill
    // { animation-name: fillBar }) with its duration set per stage. That
    // is why pause works by setting animationPlayState: the animation
    // runs on its own clock, entirely independent of the sweep.
    //
    // Which is also why scrubbing did not move it. The drag writes
    // elapsed directly and cancels the sweep loop; the CSS animation
    // never hears about either, so the dot carried on filling at its
    // original pace while the trace jumped.
    //
    // A paused animation with a NEGATIVE animation-delay renders its
    // state at that offset -- so -3000ms on an 8000ms fill draws the dot
    // 37.5% full and holds there. That seeks the same keyframes the
    // sweep already uses instead of introducing a second, inline way of
    // drawing the same thing that could then disagree with it.
    //
    // Inline transform would NOT work here: a paused animation still
    // applies its computed value, and animations beat inline styles in
    // the cascade.
    // NOT named currentFill: togglePause already declares a local const
    // by that name, and a helper shadowed inside one function but not
    // another is the kind of thing that reads as working code.
    const activeFillEl = () =>
        progressBarEl?.querySelector(".segment.current .fill") ?? null;

    // ── SCRUB BAR (experiment) ──────────────────────────────────────────
    // A visible strip along the bottom: progress indicator at rest, a
    // grabbable control when touched. ABSOLUTE mapping -- touch at 70% of
    // the width and you are at 70% of the stage, like every video player
    // anyone has ever used.
    //
    // WHY A BAR BEATS DRAGGING ANYWHERE
    //   The invisible drag shares one surface with three other gestures
    //   (centre tap pauses, right tap advances, left tap restarts), and
    //   that conflict is a bug generator: a thumb roll of 18px turned a
    //   tap into a scrub and swallowed it. A strip of its own cannot
    //   conflict with anything, and it needs no gesture hint because it
    //   looks like what it is.
    //
    // DRIVEN BY THE SAME CSS ANIMATION AS THE STORY DOT, deliberately.
    // Both run `fillBar` for the stage's duration and both are seeked the
    // same way, so they cannot drift apart -- which is exactly the bug
    // that made the dot ignore scrubbing in the first place. No per-frame
    // JavaScript either: the sweep loop does not have to know this exists.
    //
    // KEPT DELIBERATELY SEPARABLE. This function, scrubBarEls(), the
    // wiring block at the bottom and one CSS block are the whole feature.
    // Delete those four and nothing else notices.
    function ensureScrubBar() {
        const card = chartContainer?.closest(".journey-card");
        if (!card) return null;
        let bar = card.querySelector(".scrub-bar");
        if (bar) return bar;

        bar = document.createElement("div");
        bar.className = "scrub-bar";
        // Decorative to a screen reader: the stage has its own progress
        // semantics via the dots, and a drag target is not operable
        // without a pointer anyway.
        bar.setAttribute("aria-hidden", "true");
        bar.innerHTML = `<div class="scrub-track"><div class="scrub-fill"></div>`
                      + `</div><div class="scrub-knob"></div>`;
        card.appendChild(bar);
        wireScrubBar(bar);
        return bar;
    }

    const scrubFillEl = () =>
        chartContainer?.closest(".journey-card")
                      ?.querySelector(".scrub-fill") ?? null;

    // Both indicators, always together. Every place that used to touch
    // one now goes through here, so adding a third would be one edit and
    // forgetting one is not possible.
    function eachFill(fn) {
        [activeFillEl(), scrubFillEl()].forEach(f => { if (f) fn(f); });
    }

    // ── ARM BEFORE SEEKING, ONCE PER GESTURE ────────────────────────────
    // A CSS animation that has FINISHED sits in its after-phase, and with
    // animation-fill-mode:forwards it is pinned at the end state and
    // ignores a changed animation-delay entirely. Measured: on a finished
    // 600ms fill, delays of -0, -150, -300 and -450ms all rendered
    // scaleX(1).
    //
    // So seeking a completed stage did nothing -- which is the OTHER half
    // of "scrubbing back at the end of a stage does not work". The first
    // half was the auto-advance timer firing mid-gesture; this half is the
    // indicator physically unable to move.
    //
    // Re-triggering the animation puts it back in its active phase, after
    // which delay changes seek exactly. Same remove / reflow / re-add
    // trick updateProgressBar already uses to restart the dot.
    //
    // Called ONCE when a gesture begins, not per move: the forced reflow
    // is the expensive part, and after one arm the whole drag is just
    // delay assignments. Verified -- delays of -0 through -600ms on a
    // 600ms fill then produced 0.000, 0.250, 0.500, 0.750, 1.000.
    function armFillsForSeek() {
        eachFill(f => {
            f.style.animationName = "none";
            void f.offsetWidth;              // the restart
            f.style.animationName = "fillBar";
            f.style.animationPlayState = "paused";
        });
    }

    function seekFill(fill, ms) {
        if (!fill) return;
        fill.style.animationDelay = `-${Math.max(0, ms)}ms`;
    }

    // The gesture maps the room ACTUALLY AVAILABLE either side of the
    // finger onto the stage, rather than the card's full width onto it.
    //
    // THE BUG THIS FIXES: the old mapping was
    //     at = from + (dx / cardWidth) * total
    // so rewinding from 10s of a 10s stage to zero needed a drag of one
    // whole card width to the left. Put your finger in the middle and
    // only half a width exists to the left of it, so the furthest back
    // you could ever reach in one gesture was half the stage -- and the
    // progress dot could therefore never be emptied, which is how it
    // showed up.
    //
    // Mapping the available room instead means the card's left edge is
    // ALWAYS 0 and its right edge is ALWAYS the end of the stage,
    // wherever the finger went down. Each direction is linear and they
    // meet continuously at dx = 0, so there is no jump at the moment the
    // scrub commits.
    //
    // THE FLOOR CANNOT DO BOTH JOBS, which took a test to notice. A
    // generous floor stops a finger that lands 8px from the edge
    // rewinding the whole stage in 8px -- but it also means the physical
    // edge no longer maps to 0, so from x=40 the furthest back you could
    // reach was 3.4s of an 8s stage. That is the original bug again, just
    // confined to the margins.
    //
    // So the floor is set to the COMMIT THRESHOLD instead. Below 18px of
    // available room a scrub in that direction cannot commit at all, so
    // those are the only start positions where the mapping is twitchy --
    // and they were already unusable. Everywhere a gesture can start, the
    // edge maps to the end of the stage exactly.
    const MIN_SCRUB_ROOM_PX = 18;   // == SCRUB_THRESHOLD_PX, deliberately

    function scrubStart(e) {
        const ctl = activeSweepControl.get(sampleId);
        if (!ctl) return;
        const box = chartContainer.getBoundingClientRect();
        scrub = {
            x: e.clientX, y: e.clientY,
            from: ctl.lastElapsedMs ?? 0,
            total: ctl.totalDurationMs,
            roomLeft:  Math.max(MIN_SCRUB_ROOM_PX, e.clientX - box.left),
            roomRight: Math.max(MIN_SCRUB_ROOM_PX, box.right - e.clientX),
            wasPaused: isPaused,
            moved: false,
            at: ctl.lastElapsedMs ?? 0,
        };
    }

    // Horizontal travel before a drag counts as a scrub.
    //
    // WAS 12px, WHICH WAS TOO LITTLE. A deliberate thumb tap rolls five
    // to fifteen pixels on a phone, so an ordinary tap intended as
    // pause-or-next crossed the threshold, became a scrub, and had its
    // click suppressed for 350ms -- a control that did nothing, roughly
    // one time in several. A real scrub crosses 18px without noticing.
    //
    // The dominance margin does the same job for the other axis: 1.3
    // rather than a bare |dx| > |dy| leaves a diagonal swipe to the feed
    // instead of half-claiming it.
    const SCRUB_THRESHOLD_PX = 18;
    const SCRUB_DOMINANCE    = 1.3;

    // ── The bar's own gesture ────────────────────────────────────────────
    // Absolute, so there is no gain to tune and no dependence on where
    // the finger landed -- the two things that made the drag-anywhere
    // scrub awkward to get right. A tap on the bar seeks; a drag along it
    // scrubs; both are the same code.
    //
    // No commit threshold either: the strip does nothing else, so there
    // is no tap to protect.
    function wireScrubBar(bar) {
        let dragging = false;

        const seekTo = (clientX) => {
            const ctl = activeSweepControl.get(sampleId);
            if (!ctl) return;
            const box = bar.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1,
                (clientX - box.left) / Math.max(1, box.width)));
            const at = frac * ctl.totalDurationMs;
            ctl.lastElapsedMs = at;
            ctl.drawFn(at);
            eachFill(f => seekFill(f, at));
            bar.style.setProperty("--scrub-frac", frac);
        };

        bar.addEventListener("pointerdown", (e) => {
            dragging = true;
            bar.classList.add("grabbing");
            bar.setPointerCapture?.(e.pointerId);
            // The stage must not advance or sweep while a finger owns the
            // playhead -- the same reason scrubbing the card cancels the
            // auto-advance timer.
            cancelSweepAnimation(sampleId);
            if (autoAdvanceTimer) {
                clearTimeout(autoAdvanceTimer);
                autoAdvanceTimer = null;
            }
            armFillsForSeek();
            seekTo(e.clientX);
            e.stopPropagation();
            e.preventDefault();
        });

        bar.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            seekTo(e.clientX);
            e.stopPropagation();
        });

        const release = (e) => {
            if (!dragging) return;
            dragging = false;
            bar.classList.remove("grabbing");
            e?.stopPropagation();

            const ctl = activeSweepControl.get(sampleId);
            const at = ctl?.lastElapsedMs ?? 0;

            // A card the viewer paused stays paused: they are inspecting
            // a moment, and starting playback because they touched the
            // bar would take it away from them.
            if (isPaused || !ctl) return;

            startSweepLoop(sampleId, ctl.totalDurationMs, ctl.drawFn, at);
            eachFill(f => { f.style.animationPlayState = "running"; });

            if (journeyJson.journeyRules.autoAdvance
                && currentStageIndex < journeyJson.stages.length - 1) {
                const remaining = Math.max(0, ctl.totalDurationMs - at);
                autoAdvanceEndTime = performance.now() + remaining;
                autoAdvanceTimer = setTimeout(
                    () => goToStage(currentStageIndex + 1), remaining);
            }
        };
        bar.addEventListener("pointerup", release);
        bar.addEventListener("pointercancel", release);
        // Taps on the strip must never reach the card's tap-position
        // handler, or seeking would also pause or skip a stage.
        bar.addEventListener("click", (e) => e.stopPropagation());
    }

    function scrubMove(e) {
        if (!scrub) return;
        const dx = e.clientX - scrub.x;
        const dy = e.clientY - scrub.y;

        if (!scrub.moved) {
            // Commit only once the gesture is clearly sideways.
            if (Math.abs(dx) < SCRUB_THRESHOLD_PX
                || Math.abs(dx) <= Math.abs(dy) * SCRUB_DOMINANCE) return;
            scrub.moved = true;
            cancelSweepAnimation(sampleId);
            chartContainer.setPointerCapture?.(e.pointerId);

            // STOP THE STAGE ADVANCING UNDER THE FINGER.
            //
            // This is why scrubbing back near the end of a stage worked
            // only sometimes. The sweep was cancelled on scrub but the
            // auto-advance timer was not, so it still fired at its
            // original deadline: start dragging at 7s of an 8s stage and
            // a second later goToStage() built the NEXT stage, while the
            // gesture carried on writing to a drawFn that now belonged
            // to a different stage, scaled by the old one's duration.
            // Near the start of a stage there was time to finish and it
            // felt fine; near the end there was not.
            //
            // Nothing is lost by stopping it here: scrubEnd recomputes
            // the remaining time from wherever the finger let go.
            if (autoAdvanceTimer) {
                clearTimeout(autoAdvanceTimer);
                autoAdvanceTimer = null;
            }

            // Freeze AND arm, only once the gesture has COMMITTED to
            // being a scrub. Doing it at pointerdown would make every tap
            // stutter the progress indicators.
            armFillsForSeek();
        }

        // Belt and braces against the same class of failure from another
        // direction -- a rail tap rebuilding the stage, a programmatic
        // next(). If the live control's duration no longer matches the
        // one this gesture started against, the stage changed underneath
        // it: abandon rather than scrub the new stage on the old scale.
        const live = activeSweepControl.get(sampleId);
        if (!live || live.totalDurationMs !== scrub.total) {
            scrub = null;
            return;
        }

        // Left edge is 0, right edge is the end of the stage, from
        // wherever the finger started. See MIN_SCRUB_ROOM_PX above.
        const at = dx < 0
            ? scrub.from * (1 + dx / scrub.roomLeft)
            : scrub.from + (scrub.total - scrub.from) * (dx / scrub.roomRight);
        scrub.at = Math.max(0, Math.min(scrub.total, at));
        live.drawFn(scrub.at);
        // Both indicators track the finger, forwards AND backwards. The
        // clamp above keeps the scrub inside this stage, so only the
        // current dot ever changes and the completed ones stay completed.
        eachFill(f => seekFill(f, scrub.at));
    }

    function scrubEnd() {
        if (!scrub) return;
        const s = scrub;
        scrub = null;
        if (!s.moved) return;                 // a tap: leave it to the tap handler

        // Resume from where the finger left it -- unless the card was
        // already paused, in which case scrubbing should not start it.
        if (!s.wasPaused) {
            const ctl = activeSweepControl.get(sampleId);
            if (ctl) startSweepLoop(sampleId, ctl.totalDurationMs, ctl.drawFn, s.at);

            // Both carry on from the scrubbed position: the negative
            // delay is left in place, so running them again continues
            // from there rather than restarting at zero.
            eachFill(f => { f.style.animationPlayState = "running"; });

            // THE SAME DESYNC, ONE LAYER DOWN. The auto-advance timer was
            // set during buildStage for the FULL stage duration and knows
            // nothing about the drag -- so scrubbing back to the start
            // still advanced at the original deadline, and scrubbing to
            // the end left the card sitting finished, waiting.
            //
            // Three clocks have to agree after a scrub: the sweep, the
            // dot, and this. Fixing the dot alone would have left the
            // least visible one wrong, which is the one that costs an
            // evening later.
            if (autoAdvanceTimer) {
                clearTimeout(autoAdvanceTimer);
                autoAdvanceTimer = null;
            }
            if (journeyJson.journeyRules.autoAdvance
                && currentStageIndex < journeyJson.stages.length - 1) {
                const remaining = Math.max(0, s.total - s.at);
                autoAdvanceEndTime = performance.now() + remaining;
                autoAdvanceTimer = setTimeout(
                    () => goToStage(currentStageIndex + 1), remaining);
            }
        } else {
            // Still paused, and the dot stays seeked where the finger
            // left it -- scrubbing a paused card is how you LOOK at a
            // particular moment, so moving the dot back would be lying
            // about which moment is on screen.
            if (autoAdvanceRemainingMs != null) {
                autoAdvanceRemainingMs = Math.max(0, s.total - s.at);
            }
        }
        // A drag ends in a click event too; without this every scrub
        // would also toggle pause.
        //
        // ONLY IF THE SCRUB ACTUALLY WENT ANYWHERE. This is the other
        // half of why taps worked on a laptop and not on a phone: a mouse
        // click moves zero pixels, a thumb tap rolls fifteen to twenty.
        // Cross the commit threshold by a hair and the click was
        // suppressed for 350ms, so the tap did nothing at all -- and the
        // playhead had barely moved, so there was nothing on screen to
        // explain why.
        //
        // A gesture that shifted the position by under 2% of the stage
        // was a tap with a wobble, whatever the pixels said. Let the tap
        // through.
        const moved = Math.abs(s.at - s.from) > s.total * 0.02;
        if (moved) suppressClickUntil = performance.now() + 350;
    }

    chartContainer.addEventListener("pointerdown", scrubStart);
    chartContainer.addEventListener("pointermove", scrubMove);
    chartContainer.addEventListener("pointerup", scrubEnd);
    chartContainer.addEventListener("pointercancel", scrubEnd);
    chartContainer.addEventListener("click", e => {
        if (performance.now() < suppressClickUntil) {
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);

    function togglePause() {
        isPaused = !isPaused;
        flashPlayback(isPaused);

        if (isPaused) {
            // activeSweepControl still holds lastElapsedMs after
            // cancelling -- resuming continues from exactly where it
            // stopped, not from 0.
            cancelSweepAnimation(sampleId);

            if (autoAdvanceTimer) {
                clearTimeout(autoAdvanceTimer);
                autoAdvanceRemainingMs = autoAdvanceEndTime - performance.now();
                autoAdvanceTimer = null;
            }

            eachFill(f => { f.style.animationPlayState = "paused"; });
        } else {
            const control = activeSweepControl.get(sampleId);
            if (control) {
                startSweepLoop(sampleId, control.totalDurationMs, control.drawFn, control.lastElapsedMs);
            }

            if (journeyJson.journeyRules.autoAdvance && autoAdvanceRemainingMs != null) {
                autoAdvanceEndTime = performance.now() + autoAdvanceRemainingMs;
                autoAdvanceTimer = setTimeout(() => goToStage(currentStageIndex + 1), autoAdvanceRemainingMs);
                autoAdvanceRemainingMs = null;
            }

            eachFill(f => { f.style.animationPlayState = "running"; });
        }
    }

    buildProgressBar();

    return {
        async start() {
            await goToStage(0); // MUST wait for the stage to fully build (sweep started) before pausing it -- otherwise the sweep starts anyway a moment later, ignoring the pause
            if (journeyJson.playbackConfig && journeyJson.playbackConfig.isPaused) {
                togglePause();
            }
        },
        next() { if (journeyJson.journeyRules.allowStageNavigation) goToStage(currentStageIndex + 1); },
        prev() { if (journeyJson.journeyRules.allowStageNavigation) goToStage(currentStageIndex - 1); },
        restart() { goToStage(currentStageIndex); },

        togglePause,

        // ── OFF SCREEN SHOULD MEAN STOPPED ──────────────────────────────
        // The feed cancels the sweep when a card scrolls away but nothing
        // stopped the AUTO-ADVANCE timer, so a card kept stepping through
        // its stages while nobody was looking -- scroll back and you are
        // on a different stage than you left, sometimes with no animation
        // running at all, because the sweep was cancelled after the last
        // buildStage that started one.
        //
        // That reads as broken playback, and it is the same class of
        // problem as the stale glyph: a thing that was stopped and a
        // thing that was not.
        //
        // Both halves now stop together and resume together, which is
        // also what Shorts and Reels do.
        suspend() {
            cancelSweepAnimation(sampleId);
            if (autoAdvanceTimer) {
                clearTimeout(autoAdvanceTimer);
                offscreenRemainingMs = autoAdvanceEndTime - performance.now();
                autoAdvanceTimer = null;
            }
            eachFill(f => { f.style.animationPlayState = "paused"; });
        },

        resumeIfPlaying() {
            // A card the viewer deliberately paused stays paused. Coming
            // back to it must not start it playing -- they stopped it on
            // purpose, and the glyph is still saying so.
            if (isPaused) return;

            const c = activeSweepControl.get(sampleId);
            if (c && c.lastElapsedMs < c.totalDurationMs) {
                startSweepLoop(sampleId, c.totalDurationMs, c.drawFn,
                               c.lastElapsedMs);
            }
            eachFill(f => { f.style.animationPlayState = "running"; });

            if (journeyJson.journeyRules.autoAdvance
                && offscreenRemainingMs != null
                && currentStageIndex < journeyJson.stages.length - 1) {
                autoAdvanceEndTime = performance.now() + offscreenRemainingMs;
                autoAdvanceTimer = setTimeout(
                    () => goToStage(currentStageIndex + 1), offscreenRemainingMs);
            }
            offscreenRemainingMs = null;
        },
    };
}