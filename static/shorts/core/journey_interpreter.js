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
    let autoAdvanceTimer = null;
    let autoAdvanceEndTime = null; // absolute performance.now() timestamp the current timer should fire at -- used to compute remaining time when pausing
    let autoAdvanceRemainingMs = null; // set only while paused

    // Pause is per-JOURNEY-INSTANCE (per card), unlike Speed -- pausing
    // one card shouldn't pause a DIFFERENT card you scroll to next.
    let isPaused = false;

    const sharedMemory = { ...(journeyJson.sharedPipelineMemory || {}) };
    const journeyTarget = {
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
            dspEngines.set(index, createDspEngine(stageJson.dspEngine));
        }
        const dspEngine = dspEngines.get(index);

        const renderingEngine = createRenderingEngine(stageJson.renderingEngine);
        const context = { dspEngine, renderingEngine, journey: journeyTarget };

        dispatch({ target: "renderingEngine", method: "applyTheme", payload: getActiveTheme() }, context);

        // Computed ONCE, used for BOTH the renderer's actual animation AND
        // the auto-advance timer AND the progress bar fill -- all three
        // must agree, or you get exactly the bug caught earlier (animation
        // visually finishes while auto-advance keeps waiting).
        const actualDuration = (stageJson.baseDurationMs || STAGE_DURATION_MS) / journeyTarget.getSpeed();

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
            }
        }
        runAndRender(cached ? cached.dspOutput : null);

        // Collapse the text overlay on every stage change. Without this,
        // text left open on stage 1 stays open over stage 2's render --
        // and the user never asked to read stage 2's description.
        if (titleEl) {
            titleEl.closest(".layout-zone")?.classList.remove("text-expanded");
        }

        if (titleEl) titleEl.textContent = stageJson.uiFillers.title;
        if (captionEl) captionEl.textContent = stageJson.uiFillers.caption;
        if (descriptionEl) descriptionEl.textContent = stageJson.uiFillers.description || "";
        updateProgressBar(index, actualDuration);

        railContainer.innerHTML = "";
        stageJson.railControls.forEach(control => {
            const btn = document.createElement("button");
            btn.className = "rail-btn";
            btn.title = control.ui.label;

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
    function togglePause() {
        isPaused = !isPaused;

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
        restart() { goToStage(currentStageIndex); }, // replays the CURRENT stage from the beginning -- used for the "first tap restarts, fast second tap goes back" pattern
        togglePause,
    };
}