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
// Speed is now GENUINELY GLOBAL -- GLOBAL_SPEED_OPTIONS/globalSpeedIndex
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

// GLOBAL, not per-journey-instance -- deliberately moved out of
// interpretJourney() so every card in the scrolling feed shares this
// SAME state. Scrolling to a new card no longer resets Speed to 1.0x.
const GLOBAL_SPEED_OPTIONS = [0.5, 1.0, 1.5, 2.0];
let globalSpeedIndex = GLOBAL_SPEED_OPTIONS.indexOf(1.0);

// Real, proven SVG markup, reused directly from the old system's rail
// buttons (core/journey_feed.js) -- not redesigned from scratch. Keyed by
// the recipe's own control.ui.icon field, so a recipe can reference any
// of these by name without journey_interpreter.js needing to know which
// button label goes with which icon.
const RAIL_ICONS = {
    icon_flip_vertical: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6M9 6l3-3 3 3"/><path d="M12 21v-6M9 18l3 3 3-3"/></svg>`,
    icon_theme: `<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>`,
    icon_cycle: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
    icon_renderer: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
};

// Speed's icon is DYNAMIC, not static -- the number of stacked chevrons
// hints at the current speed step (1 chevron at the slowest, up to 4 at
// the fastest), the same triangle style the old static icon_speed used,
// just generated to match however many steps GLOBAL_SPEED_OPTIONS
// actually has, so this stays correct even if that list's length ever
// changes. Since Speed's button is now icon-only (no text), this is the
// only way its current value is visible at all.
function buildSpeedIcon(speedValue) {
    const stepIndex = GLOBAL_SPEED_OPTIONS.indexOf(speedValue);
    const chevronCount = stepIndex === -1 ? 1 : stepIndex + 1; // -1 guard: an unrecognized value still renders SOMETHING rather than an empty icon
    const spanStart = 2, spanEnd = 22; // matches RAIL_ICONS' 24x24 viewBox convention
    const segmentWidth = (spanEnd - spanStart) / chevronCount;
    const chevronWidth = segmentWidth * 0.82; // slightly narrower than its segment, leaving a small visual gap between chevrons
    let paths = "";
    for (let i = 0; i < chevronCount; i++) {
        const x = spanStart + i * segmentWidth;
        paths += `<path d="M${x.toFixed(1)} 5l${chevronWidth.toFixed(1)} 7-${chevronWidth.toFixed(1)} 7V5z"/>`;
    }
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">${paths}</svg>`;
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
            globalSpeedIndex = (globalSpeedIndex + 1) % GLOBAL_SPEED_OPTIONS.length;
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
            fill.style.animationPlayState = "running"; // reset -- a fresh stage always starts unpaused visually
        });
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

            renderingEngine.render(chartContainer, dspOutput, sampleId, data.fs, actualDuration);

            if (stageJson.stageOutput) {
                const exported = {};
                stageJson.stageOutput.exportedFields.forEach(field => {
                    exported[field] = dspOutput.finalOutput[field];
                });
                stageOutputs[stageJson.stageOutput.exportKey] = exported;
                stageOutputMeta[stageJson.stageOutput.exportKey] = data?.meta ?? {};
            }
        }
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
        const fill = (s) => String(s ?? "").replace(/\{([\w.]+)\}/g, (whole, path) => {
            const v = path.split(".").reduce((o, k) => o?.[k], lastEnvelope?.meta);
            return v === undefined || v === null ? whole : String(v);
        });

        if (titleEl) titleEl.textContent = fill(stageJson.uiFillers.title);
        if (captionEl) captionEl.textContent = fill(stageJson.uiFillers.caption);
        if (descriptionEl) descriptionEl.textContent = fill(stageJson.uiFillers.description || "");
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
                    derived.push({
                        ui: { label: override.label ?? ch.label ?? ch.key },
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
            const universal = stageJson.share === false ? [] : [{
                ui: { label: "Share", icon: "icon_share" },
                action: { target: "journey", method: "share", payload: {} },
            }];

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

                function refreshButtonContent() {
                    const valueDisplay = VALUE_DISPLAY_METHODS[control.action.method];
                    if (valueDisplay) {
                        const targetObj = context[control.action.target];
                        const currentValue = targetObj[valueDisplay.getMethod]();
                        const short = valueDisplay.labelMap?.[currentValue]
                                      ?? shortenId(currentValue);
                        btn.textContent = short + valueDisplay.suffix;
                        // Full id in the tooltip -- the button has room for
                        // three characters, not "hamilton_tompkins".
                        btn.title = `${control.ui.label}: ${currentValue}`;
                    } else if (control.action.method === "cycleSpeed") {
                        // Dynamic, not a static RAIL_ICONS lookup -- the number
                        // of chevrons reflects the CURRENT speed value, read
                        // fresh every time this runs (including right after a
                        // click, so the icon updates immediately).
                        btn.innerHTML = buildSpeedIcon(journeyTarget.getSpeed());
                    } else if (control.ui.icon && RAIL_ICONS[control.ui.icon]) {
                        btn.innerHTML = RAIL_ICONS[control.ui.icon];
                    } else {
                        btn.textContent = control.ui.label;
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
                    });
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
                        // Text stays the variable name; only the tooltip
                        // carries the value, so the button never reflows.
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
                if (control.action.method === "cycleTheme") {
                    runAndRender(index);
                }

                if (control.action.method === "cycleSpeed") {
                    actualDuration = (stageJson.baseDurationMs || STAGE_DURATION_MS)
                                   / journeyTarget.getSpeed();
                    updateProgressBar(index, actualDuration);
                    runAndRender(index);
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

                    if (isPaused) {
                        isPaused = false;
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
        cancelSweepAnimation(sampleId);
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

    function seekFill(fill, ms) {
        if (!fill) return;
        fill.style.animationDelay = `-${Math.max(0, ms)}ms`;
    }

    function scrubStart(e) {
        const ctl = activeSweepControl.get(sampleId);
        if (!ctl) return;
        scrub = {
            x: e.clientX, y: e.clientY,
            from: ctl.lastElapsedMs ?? 0,
            total: ctl.totalDurationMs,
            wasPaused: isPaused,
            moved: false,
            at: ctl.lastElapsedMs ?? 0,
        };
    }

    function scrubMove(e) {
        if (!scrub) return;
        const dx = e.clientX - scrub.x;
        const dy = e.clientY - scrub.y;

        if (!scrub.moved) {
            // Commit only once the gesture is clearly sideways: a 12px
            // threshold keeps a tap a tap, and requiring |dx| > |dy|
            // leaves a diagonal swipe to the feed rather than grabbing it.
            if (Math.abs(dx) < 12 || Math.abs(dx) <= Math.abs(dy)) return;
            scrub.moved = true;
            cancelSweepAnimation(sampleId);
            chartContainer.setPointerCapture?.(e.pointerId);
            // Freeze the dot only once the gesture has COMMITTED to being
            // a scrub. Pausing it at pointerdown would make every tap
            // stutter the progress dot.
            scrub.fill = activeFillEl();
            if (scrub.fill) scrub.fill.style.animationPlayState = "paused";
        }

        // The card's width is one whole stage, so the gesture scales with
        // however long that stage happens to be.
        const width = chartContainer.clientWidth || 360;
        scrub.at = Math.max(0, Math.min(scrub.total,
                            scrub.from + (dx / width) * scrub.total));
        activeSweepControl.get(sampleId)?.drawFn(scrub.at);
        // The dot now tracks the finger, forwards AND backwards -- the
        // clamp above keeps the scrub inside this stage, so only the
        // current dot ever changes and the completed ones stay completed.
        seekFill(scrub.fill, scrub.at);
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

            // The dot carries on from the scrubbed position: the negative
            // delay is left in place, so running it again continues from
            // there rather than restarting at zero.
            if (s.fill) s.fill.style.animationPlayState = "running";

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
        suppressClickUntil = performance.now() + 350;
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

        const currentFill = progressBarEl && progressBarEl.querySelector(".segment.current .fill");

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

            if (currentFill) currentFill.style.animationPlayState = "paused";
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

            if (currentFill) currentFill.style.animationPlayState = "running";
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
    };
}