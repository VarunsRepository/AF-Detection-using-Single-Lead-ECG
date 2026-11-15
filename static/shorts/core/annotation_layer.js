// ---------------------------------------------------------------------------
// annotation_layer.js
// A DOM overlay that points at things in whatever the renderer just drew.
//
// WHY THIS IS NOT IN THE RENDERERS:
//   The same "look here" mark is wanted on chart_v1, chart_v1_canvas,
//   chart_v1_webgl, stacked_beats_view, rr_tachogram, spectrum_view and
//   every renderer added after them. Implemented per renderer that is
//   ten copies of the same bob animation, three of which would have to
//   draw text into a GPU vertex buffer to do it. Implemented here it is
//   one copy, in the DOM, over the top -- the same trade buildAxisLayer
//   already makes for tick labels, and the same move the UIFillers
//   cleanup makes for SD1/SD2/HR.
//
// THREE LAYERS, THREE RESPONSIBILITIES -- the whole point of the design:
//   DSP      says WHAT IS THERE          "R-apex at sample 1430"
//   recipe   says WHAT DESERVES ATTENTION "point at the first R-apex"
//   theme    says WHAT IT LOOKS LIKE     "a caliper tick" / "a bobbing hand"
//
//   So the DSP never hears about themes, the recipe never names a glyph,
//   and the theme never reads DSP output. A new theme is a new glyph
//   table and nothing else; a new annotation is three lines of recipe.
//
// RECIPE SHAPE (sibling of uiFillers, see beats.py):
//   "annotations": [
//     {"role": "point_at",
//      "anchor": {"field": "finalOutput.peakIndices", "which": "first"},
//      "dwellMs": 3000,
//      "appearAt": 0.35,         OPTIONAL fraction of the stage. Omit it
//                                and the dwell starts when the anchor
//                                first becomes VISIBLE, which is what you
//                                want on a sliding sweep -- see below.
//      "helpLevel": "heavy"}     optional -- omit to show on every theme
//   ]
//
// HOW IT STAYS IN STEP WITH THE SWEEP:
//   It does not run its own clock. It WRAPS activeSweepControl's drawFn,
//   which shared_signal_utils.js explicitly supports ("this allows
//   renderers to wrap/replace drawFn on the control object from outside
//   startSweepLoop"). Both things that move the sweep call that one
//   function -- the rAF loop and the manual scrub -- so wrapping it is
//   the only hook that follows BOTH. Reading lastElapsedMs on a timer of
//   our own would freeze mid-scrub, because the scrub calls drawFn
//   directly and never writes lastElapsedMs.
//
//   The wrapper calls the renderer's drawFn FIRST and positions second:
//   the projection it reads is only correct for the frame that has
//   actually been drawn.
//
// Depends on rail_controls.js (THEMES, themeIndex, getActiveVisualTheme)
// and shared_signal_utils.js (activeSweepControl) -- both must load
// before this file.
// ---------------------------------------------------------------------------

// A mark is allowed to be missed, not to be silently absent. If a theme
// forgets a role, SOMETHING still appears and still points at the right
// place -- a half-finished theme degrades to plain, never to nothing.
// Losing the explanation is a far worse failure than losing the style,
// and an invisible one: the card looks fine and simply teaches less.
const ANNOTATION_GLYPH_FALLBACK = { kind: "svg", mark: "caret", motion: "bob" };

// Hard ceiling, deliberately low. Pointing at everything is the same as
// pointing at nothing -- a screen of hands is wallpaper, and the eye
// stops going anywhere in particular. Two is already generous; the
// honest number for most cards is one.
// Raised from 2 to 3: with which:"all" the sweep keeps roughly three to
// four beats on screen at once, so 3 is effectively "mark every beat you
// can currently see" while still refusing to fill the card.
const MAX_VISIBLE_ANNOTATIONS = 3;

// Gap in CSS px between the anchor point and the bottom of the mark, so
// the glyph sits ABOVE the beat rather than on top of it. A mark covering
// the feature it indicates defeats itself.
const ANCHOR_GAP_PX = 10;

const ANNOTATION_SVG_MARKS = {
    // Apex at the BOTTOM centre (12,15) -- the tip is what gets lined up
    // with the data point, so it has to be at a known, predictable place
    // in the box. This is exactly what an emoji cannot promise: 👉 puts
    // its fingertip somewhere different on every platform's font, so the
    // thing doing the pointing is not where you think it is.
    caret: `<svg viewBox="0 0 24 16" width="26" height="17"><path d="M12 15L2 2h20z" fill="currentColor"/></svg>`,
    // Caliper tick -- a vertical stem with a foot, the way a measurement
    // is marked on a diagnostic trace. Sober, but still unmistakably
    // saying "this one". Clinical does not mean unlabelled.
    tick: `<svg viewBox="0 0 12 20" width="14" height="23"><path d="M6 1v13M2 14h8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`,
    ring: `<svg viewBox="0 0 20 20" width="22" height="22"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
};

// Injected once, not per annotation. The positioning transform
// (translate(-50%,-100%)) lives on the OUTER element and the motion on an
// INNER one -- one element carrying both would mean the keyframes have to
// restate the centring offset in every frame, and any later change to the
// offset silently breaks the animation instead of just moving the mark.
let annotationStylesInjected = false;
function ensureAnnotationStyles() {
    if (annotationStylesInjected) return;
    annotationStylesInjected = true;
    const style = document.createElement("style");
    style.textContent = `
        .kymo-annotation {
            position: absolute;
            transform: translate(-50%, -100%);
            pointer-events: none;
            opacity: 0;
            transition: opacity 220ms ease-out;
            will-change: opacity;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
            line-height: 1;
        }
        .kymo-annotation.visible { opacity: 1; }
        .kymo-annotation .kymo-glyph {
            display: block;
            filter: drop-shadow(0 0 4px rgba(0,0,0,0.9));
        }
        .kymo-annotation .kymo-glyph.text {
            /* An emoji is a FONT GLYPH, so it needs a font stack that
               actually has one. Without this it silently falls back to
               whatever the card's mono face does with U+1F449 -- on some
               Androids a hollow box. */
            font-family: "Apple Color Emoji", "Segoe UI Emoji",
                         "Noto Color Emoji", sans-serif;
            font-size: 28px;
        }
        .kymo-annotation .kymo-label {
            font-family: "IBM Plex Mono", monospace;
            font-size: 11px;
            letter-spacing: 0.04em;
            text-shadow: 0 0 4px #000, 0 0 8px #000;
            opacity: 0.85;
        }
        @keyframes kymoBob {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(-5px); }
        }
        @keyframes kymoPulse {
            0%, 100% { transform: scale(1);    opacity: 1;   }
            50%      { transform: scale(1.18); opacity: 0.75; }
        }
        .kymo-annotation .motion-bob   { animation: kymoBob   1100ms ease-in-out infinite; }
        .kymo-annotation .motion-pulse { animation: kymoPulse 1400ms ease-in-out infinite; }

        /* Motion is what carries the attention, so honour the setting
           that asks for less of it -- the mark still appears and still
           points, it just stops moving. */
        @media (prefers-reduced-motion: reduce) {
            .kymo-annotation .motion-bob,
            .kymo-annotation .motion-pulse { animation: none; }
        }
    `;
    document.head.appendChild(style);
}

// ── Theme lookup ────────────────────────────────────────────────────────────
// role -> glyph spec, via the ACTIVE theme. Resolved at draw time rather
// than captured at mount, so cycleTheme() changes the mark on the next
// frame without the layer needing to be told that a theme changed.
function resolveAnnotationGlyph(role) {
    const theme = typeof getActiveVisualTheme === "function" ? getActiveVisualTheme() : null;
    const spec  = theme?.glyphs?.[role];
    if (!spec) {
        // Worth saying out loud: a missing role is a theme that has not
        // been finished, and the fallback hides that fact on screen.
        console.warn(`annotation_layer: theme "${theme?.label ?? "?"}" has no glyph for role "${role}" -- using fallback.`);
        return ANNOTATION_GLYPH_FALLBACK;
    }
    return spec;
}

function activeHelpLevel() {
    const theme = typeof getActiveVisualTheme === "function" ? getActiveVisualTheme() : null;
    return theme?.helpLevel ?? "light";
}

// ── Anchoring ───────────────────────────────────────────────────────────────
// Annotations anchor to a DATA FIELD, never to pixels. Pixel anchoring
// survives nothing: not a resize, not a rotation, not a renderer switch,
// not a different sample with its beats in different places. A sample
// index survives all four, because the renderer is the thing that knows
// where a sample currently is on screen.
function readAnnotationAnchor(dspOutput, anchor) {
    if (!anchor?.field) return [];
    const value = anchor.field.split(".").reduce((o, k) => o?.[k], dspOutput);
    if (value == null) {
        console.warn(`annotation_layer: anchor field "${anchor.field}" is not in this stage's DSP output.`);
        return [];
    }
    const list = Array.isArray(value) ? value : [value];
    if (!list.length) return [];

    const which = anchor.which ?? "first";
    if (which === "first") return [list[0]];
    if (which === "last")  return [list[list.length - 1]];
    if (which === "all")   return list;
    if (Number.isInteger(which)) return list[which] != null ? [list[which]] : [];
    console.warn(`annotation_layer: unrecognised anchor.which "${which}" -- treating as "first".`);
    return [list[0]];
}

// ── Mount / unmount ─────────────────────────────────────────────────────────
// One overlay element per annotation instance, created once at mount and
// then only ever moved and faded. Creating elements per frame would mean
// the CSS transition never has a previous state to animate FROM, so every
// mark would pop rather than fade.
function mountAnnotations(container, stageJson, sampleId, dspOutput) {
    unmountAnnotations(container, sampleId);

    const declared = stageJson?.annotations;
    if (!Array.isArray(declared) || declared.length === 0) return;

    ensureAnnotationStyles();

    const layer = document.createElement("div");
    layer.className = "kymo-annotation-layer";
    // Same contract as buildAxisLayer: this sits over a card that owns
    // pointer-driven scrub, tap-to-pause and vertical feed swipes. Any
    // hit-testable overlay would quietly eat one of them.
    layer.style.cssText = `
        position: absolute; inset: 0;
        pointer-events: none; overflow: hidden;
    `;
    container.appendChild(layer);

    // Expand each declared annotation into one instance per anchored
    // sample, so {"which": "all"} is many marks but still one recipe line.
    const instances = [];
    declared.forEach((spec, specIdx) => {
        readAnnotationAnchor(dspOutput, spec.anchor).forEach((sampleIdx, i) => {
            const el = document.createElement("div");
            el.className = "kymo-annotation";
            // Decorative: the caption already carries the sentence this
            // mark is illustrating, so announcing it as well is noise.
            // (An emoji is worse than noise here -- a screen reader says
            // "white right pointing backhand index" over the beat.)
            el.setAttribute("aria-hidden", "true");
            layer.appendChild(el);
            instances.push({
                el,
                spec,
                sampleIdx,
                key: `${specIdx}:${i}`,
                renderedGlyph: null,   // so the DOM is only rewritten when the THEME changes
                firstVisibleAt: null,  // set the first frame this anchor is on screen
            });
        });
    });

    if (!instances.length) {
        layer.remove();
        return;
    }

    // ── The per-frame update ────────────────────────────────────────────
    function positionAnnotations(elapsedMs) {
        const control = activeSweepControl.get(sampleId);
        const total   = control?.totalDurationMs;
        if (!total) return;

        // Set by the renderer, read here. A renderer that does not
        // publish one simply gets no annotations -- nothing breaks, the
        // card just has no marks, which is the same graceful path a
        // renderer with no CRT treatment takes on the Romulus theme.
        const projection = container.__kymoProjection;
        if (!projection?.toScreen) return;

        const progress  = Math.min(1, elapsedMs / total);
        const helpLevel = activeHelpLevel();
        let shown = 0;

        for (const inst of instances) {
            const { spec, el } = inst;

            // A "heavy" annotation is EXTRA explanation, not the only
            // explanation -- that is why the default (helpLevel absent)
            // shows on every theme. Gating the baseline marks by theme
            // would mean switching to Clinical silently teaches less,
            // and nobody would ever notice it had happened.
            const gated = spec.helpLevel === "heavy" && helpLevel !== "heavy";

            // Asked FIRST, because the timing below depends on it. During
            // a sliding sweep a beat that has not been reached yet, or has
            // scrolled off the left edge, HAS no screen position --
            // toScreen returns null for it rather than a plausible wrong
            // number, so there is nowhere to put a mark even if the clock
            // says it is due.
            const point = (!gated && progress > 0)
                        ? projection.toScreen(inst.sampleIdx)
                        : null;

            const dwellMs = spec.dwellMs ?? 2500;
            let inWindow;

            if (typeof spec.appearAt === "number") {
                // Fixed fraction of the stage. Honest but sharp-edged on a
                // sliding sweep: the 3s window over a 30s record means any
                // one beat is on screen for only ~10% of the stage, and
                // WHICH 10% depends on where that record's beats actually
                // fall. A fraction tuned against one sample can miss
                // entirely on the next one, and it fails silently -- the
                // mark simply never appears.
                const startMs = spec.appearAt * total;
                inWindow = elapsedMs >= startMs && elapsedMs <= startMs + dwellMs;
            } else {
                // The default, and the one to reach for: start dwelling the
                // first frame the anchor is actually VISIBLE. The mark then
                // lands on the beat as the sweep draws it, on every record,
                // with nothing to tune per sample.
                if (inst.firstVisibleAt != null && elapsedMs < inst.firstVisibleAt) {
                    // Scrubbed backwards, or the stage replayed. Without
                    // this the dwell stays expired for the rest of the
                    // card and the mark never returns.
                    inst.firstVisibleAt = null;
                }
                if (point && inst.firstVisibleAt == null) {
                    inst.firstVisibleAt = elapsedMs;
                }
                inWindow = inst.firstVisibleAt != null
                        && (elapsedMs - inst.firstVisibleAt) <= dwellMs;
            }

            if (!point || !inWindow || shown >= MAX_VISIBLE_ANNOTATIONS) {
                el.classList.remove("visible");
                continue;
            }

            const glyph = resolveAnnotationGlyph(spec.role ?? "point_at");

            // Rebuild the inner markup only when the resolved glyph
            // actually differs -- otherwise every frame would replace the
            // animated child, restarting the bob from zero 30 times a
            // second and leaving it looking frozen.
            const signature = JSON.stringify(glyph);
            if (inst.renderedGlyph !== signature) {
                inst.renderedGlyph = signature;
                const motionClass = glyph.motion && glyph.motion !== "none"
                                  ? `motion-${glyph.motion}` : "";
                const body = glyph.kind === "text"
                    ? `<span class="kymo-glyph text ${motionClass}">${glyph.mark}</span>`
                    : `<span class="kymo-glyph ${motionClass}">${ANNOTATION_SVG_MARKS[glyph.mark] ?? ANNOTATION_SVG_MARKS.caret}</span>`;
                const label = glyph.label ?? spec.label;
                el.innerHTML = body
                    + (label ? `<span class="kymo-label">${label}</span>` : "");
                // currentColor on the SVG resolves against this, so one
                // property themes the mark. Falls back to the trace
                // colour, which is never invisible against the card.
                //
                // Read as a CSS variable rather than off THEMES directly:
                // one path for theme values, same rule the renderers follow.
                el.style.color = glyph.color
                    ?? (typeof themeColor === "function"
                        ? themeColor(themeStyles(), "--trace-color", "#e8f4f8")
                        : "#e8f4f8");
            }

            el.style.left = `${point.x}px`;
            el.style.top  = `${point.y - ANCHOR_GAP_PX}px`;
            el.classList.add("visible");
            shown++;
        }
    }

    // ── Hook the sweep ──────────────────────────────────────────────────
    // startSweepLoop() replaces the whole activeSweepControl entry with a
    // fresh object holding the RAW drawFn every time a stage renders, so
    // this wrapper cannot stack across re-renders -- each render hands us
    // an unwrapped function again. Mounting after render() (not before) is
    // what makes that true, since render() calls startSweepLoop itself.
    const control = activeSweepControl.get(sampleId);
    if (!control) {
        // A renderer that never starts a sweep (a static view) still gets
        // its annotations placed once, at full progress.
        positionAnnotations(0);
        container.__kymoAnnotations = { layer, restore: null };
        return;
    }

    const originalDrawFn = control.drawFn;
    const annotatedDrawFn = function (elapsed) {
        originalDrawFn(elapsed);     // renderer first: it updates the projection
        try {
            positionAnnotations(elapsed);
        } catch (e) {
            // An overlay must never be able to kill the sweep. A thrown
            // error here would stop the rAF loop and freeze the card on
            // whatever frame it happened to be on.
            console.warn("annotation_layer: positioning failed:", e);
        }
    };
    control.drawFn = annotatedDrawFn;

    container.__kymoAnnotations = {
        layer,
        restore() {
            // Only unwrap if OUR wrapper is still the one installed. A
            // re-render in between has already replaced the whole control
            // entry, and putting our captured original back would reinstate
            // a drawFn that closes over the PREVIOUS render's canvas.
            const c = activeSweepControl.get(sampleId);
            if (c && c.drawFn === annotatedDrawFn) c.drawFn = originalDrawFn;
        },
    };

    // Place immediately rather than waiting for the next frame: render()
    // has already drawn frame 0 by the time we get here, so the marks
    // would otherwise be one frame late on entry.
    positionAnnotations(control.lastElapsedMs ?? 0);
}

function unmountAnnotations(container, sampleId) {
    const state = container?.__kymoAnnotations;
    if (!state) return;
    state.restore?.();
    state.layer?.remove();
    container.__kymoAnnotations = null;
}
