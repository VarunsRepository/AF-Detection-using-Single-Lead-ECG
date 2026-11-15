// ---------------------------------------------------------------------------
// theme_effects.js
// Scanlines, vignette, and a pulse that fires on the signal's own events.
//
// WHY A FOURTH LAYER AND NOT RENDERER CODE:
//   There are now four things stacked on a card, and each exists because
//   it belongs to nobody else:
//
//     renderer          draws the data
//     axis layer        labels the data            (per renderer)
//     annotation layer  points at the data         (one copy, DOM)
//     effects layer     paints over all of it      (one copy, DOM)  <- this
//
//   Effects are the clearest case of the lot: they are not about the data
//   at all. Putting them in a renderer would mean implementing them in
//   chart_v1, chart_v1_canvas, chart_v1_webgl, stacked_beats_view,
//   packet_stack_view, tx_timeline_view and exchange_view -- seven copies
//   of a CSS gradient. As one overlay it works on every renderer that
//   exists and every renderer added later, including the BLE ones, for
//   free.
//
// ENTIRELY THEME-DRIVEN, AND OFF BY DEFAULT:
//   --scanline-opacity   0 disables
//   --vignette-opacity   0 disables
//   --pulse-strength     0 disables
//
//   THEME_DEFAULTS sets all three to 0, so the sober themes stay sober
//   without naming anything. A theme opts in by declaring a value. If all
//   three are 0 this file attaches nothing to the DOM at all -- not a
//   transparent overlay, nothing -- so a card on Clinical pays no
//   compositing cost for a feature it is not using.
//
// THE PULSE IS THE ONE THAT MATTERS:
//   Scanlines and vignette are paint. The pulse is the only effect that is
//   ABOUT the signal: it fires when the sweep crosses a detected feature,
//   so the card flashes on the beat rather than on a fixed keyframe. That
//   is a different kind of thing from a CSS animation -- it is the data
//   driving the decoration.
//
//   It needs no new DSP output. peakIndices is already there, and the
//   sweep clock is already shared. Same two ingredients the annotation
//   layer runs on.
//
//   It generalises past ECG without changing: the event source is just
//   "a list of positions along the sweep". For BLE that is packet arrival
//   times, so the card can pulse per packet with no new code here.
//
// Depends on rail_controls.js (themeStyles/themeNumber) and
// shared_signal_utils.js (activeSweepControl). Both typeof-guarded, since
// renderer and effect load order is decided by the server's per-journey
// resolve rather than by this file.
// ---------------------------------------------------------------------------

let effectStylesInjected = false;
function ensureEffectStyles() {
    if (effectStylesInjected) return;
    effectStylesInjected = true;
    const style = document.createElement("style");
    style.textContent = `
        .kymo-effects {
            position: absolute;
            inset: 0;
            pointer-events: none;
            overflow: hidden;
            /* Above the plot and the axis labels, BELOW the annotation
               layer. A mark that points at a beat must never sit behind a
               scanline wash -- the pointing is content, the wash is not. */
            z-index: 2;
        }

        /* Repeating 2px gradient rather than an image: no request, no
           decode, and it scales with devicePixelRatio for free. */
        .kymo-effects .kymo-scanlines {
            position: absolute;
            inset: 0;
            background-image: repeating-linear-gradient(
                to bottom,
                rgba(0, 0, 0, 0.9) 0px,
                rgba(0, 0, 0, 0.9) 1px,
                transparent 1px,
                transparent 3px
            );
            opacity: var(--scanline-opacity, 0);
            mix-blend-mode: multiply;
        }

        /* Darkens the corners so the eye lands in the middle, where the
           trace is. Costs nothing and does more for focus than any
           amount of colour. */
        .kymo-effects .kymo-vignette {
            position: absolute;
            inset: 0;
            background: radial-gradient(
                ellipse at center,
                transparent 45%,
                rgba(0, 0, 0, 0.9) 130%
            );
            opacity: var(--vignette-opacity, 0);
        }

        /* The beat flash. Driven by a JS-set custom property rather than a
           keyframe animation, because the timing comes from the DATA --
           a keyframe would be a fixed rhythm pretending to be a heartbeat,
           which is exactly the dishonesty this app is built against. */
        .kymo-effects .kymo-pulse {
            position: absolute;
            inset: 0;
            background: radial-gradient(
                ellipse at center,
                var(--trace-color, #ffffff) 0%,
                transparent 70%
            );
            opacity: 0;
            will-change: opacity;
        }

        @media (prefers-reduced-motion: reduce) {
            /* The static washes stay -- they are not motion. Only the
               flashing stops, and flashing is the part that matters for
               anyone who asked for less of it. */
            .kymo-effects .kymo-pulse { display: none; }
        }
    `;
    document.head.appendChild(style);
}

// ── Reading the theme ───────────────────────────────────────────────────────
// Guarded the same way the renderers guard it: this file does not control
// whether rail_controls.js has loaded first.
function effectNumber(styles, varName, fallback) {
    if (typeof themeNumber === "function") {
        return themeNumber(styles, varName, fallback);
    }
    const n = parseFloat(styles.getPropertyValue(varName).trim());
    return Number.isFinite(n) ? n : fallback;
}

/**
 * mountEffects(container, sampleId, dspOutput)
 *
 * Call AFTER the renderer has drawn, alongside mountAnnotations. Returns
 * silently when the active theme asks for no effects.
 *
 * dspOutput is optional: without it the washes still work and only the
 * pulse is skipped, which is the right behaviour for a renderer whose
 * output has no event list to pulse on.
 */
function mountEffects(container, sampleId, dspOutput) {
    unmountEffects(container, sampleId);

    const styles = typeof themeStyles === "function"
                 ? themeStyles()
                 : getComputedStyle(document.documentElement);

    const scanlines = effectNumber(styles, "--scanline-opacity", 0);
    const vignette  = effectNumber(styles, "--vignette-opacity", 0);
    const pulse     = effectNumber(styles, "--pulse-strength", 0);

    // Nothing requested: attach nothing. An always-present transparent
    // overlay would be a permanent compositing layer on every card on
    // every theme, paid for by the four themes that want no effects.
    if (scanlines <= 0 && vignette <= 0 && pulse <= 0) return;

    ensureEffectStyles();

    const layer = document.createElement("div");
    layer.className = "kymo-effects";
    layer.setAttribute("aria-hidden", "true");   // decorative, every bit of it

    if (scanlines > 0) {
        const el = document.createElement("div");
        el.className = "kymo-scanlines";
        layer.appendChild(el);
    }
    if (vignette > 0) {
        const el = document.createElement("div");
        el.className = "kymo-vignette";
        layer.appendChild(el);
    }

    let pulseEl = null;
    if (pulse > 0) {
        pulseEl = document.createElement("div");
        pulseEl.className = "kymo-pulse";
        layer.appendChild(pulseEl);
    }

    container.appendChild(layer);

    // ── The beat-synced pulse ───────────────────────────────────────────
    // Event positions as a FRACTION of the sweep, not as sample indices.
    // That is what makes this protocol-agnostic: a fraction means "how far
    // through this card", which an ECG beat, a BLE packet and anything
    // else all have.
    let eventFractions = null;
    if (pulseEl) {
        const peaks = dspOutput?.finalOutput?.peakIndices;
        const signalLength = dspOutput?.finalOutput?.filteredSignal?.length;
        if (peaks?.length && signalLength > 1) {
            eventFractions = Array.from(peaks)
                .map(i => i / (signalLength - 1))
                .filter(f => f >= 0 && f <= 1)
                .sort((a, b) => a - b);
        }
    }

    let restore = null;

    if (pulseEl && eventFractions?.length) {
        const control = typeof activeSweepControl !== "undefined"
                      ? activeSweepControl.get(sampleId) : null;

        if (control) {
            // How long one flash lasts, as a fraction of the whole sweep.
            // Expressed in sweep-relative terms rather than milliseconds so
            // that the Speed control cannot desync it: at 2x the stage is
            // half as long and the flash is half as long with it.
            const DECAY = 0.012;

            // Index of the last event already passed, so each frame does a
            // single comparison instead of scanning the list. At 400 beats
            // and 30fps the scan would be cheap anyway -- but this also
            // makes "did we just cross one" unambiguous, which a scan does
            // not.
            let nextIdx = 0;

            const originalDrawFn = control.drawFn;
            const pulsedDrawFn = function (elapsed) {
                originalDrawFn(elapsed);
                try {
                    const total = control.totalDurationMs || 1;
                    const progress = Math.min(1, elapsed / total);

                    // Scrubbed backwards or replayed: re-seek rather than
                    // leaving the cursor stranded past every event, which
                    // would silently kill the pulse for the rest of the card.
                    if (nextIdx > 0 && progress < eventFractions[nextIdx - 1]) {
                        nextIdx = 0;
                        while (nextIdx < eventFractions.length
                               && eventFractions[nextIdx] < progress) nextIdx++;
                    }
                    while (nextIdx < eventFractions.length
                           && eventFractions[nextIdx] <= progress) nextIdx++;

                    // Distance past the most recent event, as a fraction.
                    const last = nextIdx > 0 ? eventFractions[nextIdx - 1] : null;
                    if (last === null) {
                        pulseEl.style.opacity = "0";
                        return;
                    }
                    const since = progress - last;
                    // Linear decay reads as a flash; an eased one reads as a
                    // glow that lags the beat it is meant to mark.
                    const level = since < DECAY
                        ? (1 - since / DECAY) * pulse
                        : 0;
                    pulseEl.style.opacity = String(level);
                } catch (e) {
                    // Decoration must never be able to stop the sweep.
                    console.warn("theme_effects: pulse failed:", e);
                }
            };
            control.drawFn = pulsedDrawFn;

            restore = () => {
                const c = typeof activeSweepControl !== "undefined"
                        ? activeSweepControl.get(sampleId) : null;
                // Only unwrap OUR wrapper -- a re-render in between has
                // already replaced the control entry, and restoring a
                // captured original would reinstate a drawFn closed over
                // the previous render.
                if (c && c.drawFn === pulsedDrawFn) c.drawFn = originalDrawFn;
            };
        }
    }

    container.__kymoEffects = { layer, restore };
}

function unmountEffects(container, sampleId) {
    const state = container?.__kymoEffects;
    if (!state) return;
    state.restore?.();
    state.layer?.remove();
    container.__kymoEffects = null;
}
