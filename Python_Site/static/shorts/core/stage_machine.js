// ---------------------------------------------------------------------------
// stage_machine.js
// Drives one card's horizontal stage progression: advancing, restarting,
// pausing, and a card's first activation all funnel through enterStage(),
// the single canonical entry point. No cross-visit memory anymore -- every
// card always starts fresh at stage 0, every time it becomes visible.
//
// Journey-aware now: each card reads WHICH journey it belongs to from
// cardEl.dataset.journey (defaulting to "ecg" if unset, for backward
// compatibility), and passes that through to every engine call. This is
// what lets the SAME stage machine drive the ECG feed and a completely
// separate journey (e.g. DWT) without either needing its own bespoke
// navigator.
//
// Depends on rail_controls.js (getStageDuration), shared_signal_utils.js
// (cancelSweepAnimation, activeSweepControl, startSweepLoop), and
// stage_engine.js (renderStageChart) -- all three must be loaded before
// this file.
// ---------------------------------------------------------------------------

let activeTimers = new Map();
let currentlyVisibleController = null; // updated by initFeed's observer, in shorts_feed.js

function clearAutoAdvance(sampleId) {
    if (activeTimers.has(sampleId)) {
        clearTimeout(activeTimers.get(sampleId)); // setTimeout now, not setInterval -- see startAutoAdvance()
        activeTimers.delete(sampleId);
    }
}

const RESTART_THRESHOLD_MS = 400; // left-tap within this window of entering a
                                    // stage means "go to previous"; beyond it
                                    // means "restart current" -- same pattern
                                    // as Spotify/YouTube's "previous" button

function initCard(cardEl) {
    const sampleId = cardEl.dataset.sampleId;
    // Which journey this card belongs to -- defaults to "ecg" so any card
    // built before this attribute existed (or a card that simply doesn't
    // set it) keeps working exactly as before, unchanged.
    const journeyName = cardEl.dataset.journey || "ecg";
    const bar = cardEl.querySelector(".stage-bar");
    const segments = Array.from(bar.querySelectorAll(".segment"));
    const stageEls = Array.from(cardEl.querySelectorAll(".stage-content"));
    const maxStage = stageEls.length - 1;

    let currentStage = 0; // always -- no cross-visit memory anymore
    let stageEnteredAt = performance.now(); // live, in-the-moment only; not persisted
    let isPaused = false; // live pause state -- reset fresh every enterStage(), never survives leaving the card

    // THE canonical entry point. Advancing, restarting, going to a previous
    // stage, and a card's very first activation all funnel through here --
    // one function, always producing a genuinely fresh state. No exceptions,
    // no partial-resume branches to keep in sync with each other.
    function enterStage(stageIdx) {
        currentStage = Math.max(0, Math.min(stageIdx, maxStage));
        stageEnteredAt = performance.now();
        isPaused = false; // entering (or re-entering) a stage always starts unpaused

        // Rail-control visibility no longer reads this attribute -- that's
        // now driven directly by each stage's own railControls declaration
        // (see below). Kept anyway as a plain, harmless DOM/devtools
        // convenience: inspecting a card in the browser immediately shows
        // which stage it's currently on, without digging through JS state.
        cardEl.dataset.currentStage = currentStage;

        stageEls.forEach(el => {
            el.classList.toggle("active", Number(el.dataset.stage) === currentStage);
        });

        segments.forEach((seg, i) => {
            const fill = seg.querySelector(".fill");
            seg.classList.remove("completed", "current");

            // force a reflow between removing and re-adding "current" --
            // without this, RESTARTING the segment you're already on (e.g.
            // left-tap on a fresh stage) might not replay the CSS keyframe
            // from the start, since browsers can coalesce a same-frame
            // remove+re-add of the same class into a no-op visually
            fill.style.animation = "none";
            void fill.offsetWidth;
            fill.style.animationPlayState = "running"; // in case a prior pause left this frozen

            if (i < currentStage) {
                seg.classList.add("completed");
            } else if (i === currentStage) {
                fill.style.animation = ""; // restore the CSS-defined fillBar animation
                seg.classList.add("current");
                fill.style.animationDuration = `${getStageDuration(currentStage, sampleId)}ms`;
            }
        });

        // always a genuinely fresh ANIMATION -- the engine may reuse cached
        // processor output (e.g. Pan-Tompkins' peaks, if unchanged since
        // last computed), but the renderer always restarts the sweep from
        // elapsed=0 via startSweepLoop, so this still looks and feels fresh
        // every time, even though the underlying computation isn't repeated
        // unnecessarily.
        cancelSweepAnimation(sampleId);
        const activeEl = stageEls.find(el => Number(el.dataset.stage) === currentStage);
        const container = activeEl && activeEl.querySelector(".chart-frame");
        if (container) renderStageChart(journeyName, sampleId, currentStage, container);
        if (activeEl && typeof showStageCaption === "function") showStageCaption(activeEl, journeyName, currentStage);

        // Rail control visibility -- driven ENTIRELY by this stage's own
        // railControls declaration (see registerStage in stage_renderers.js),
        // not a separate hand-written CSS rule that could drift out of sync.
        // A rail button is "stage-scoped" purely by virtue of appearing in
        // SOME stage's railControls somewhere in this journey; anything
        // never mentioned (Speed, Invert, Theme) is left completely alone,
        // always visible, exactly as before.
        if (typeof getAllStageScopedRailRoles === "function" && typeof getStageRailControls === "function") {
            const allScopedRoles = getAllStageScopedRailRoles(journeyName);
            const activeRoles = getStageRailControls(journeyName, currentStage);
            allScopedRoles.forEach(role => {
                const btn = cardEl.querySelector(`.rail-btn[data-role="${role}"]`);
                if (btn) btn.classList.toggle("rail-stage-active", activeRoles.includes(role));
            });
        }

        cardEl.classList.remove("paused");
        startAutoAdvance();
    }

    // Stage caption is now owned by features/stage_caption.js, not defined
    // here -- showStageCaption() is called below but lives externally,
    // same decoupled pattern as attachAlgorithmExplainer.

    function startAutoAdvance(overrideDurationMs = null) {
        clearAutoAdvance(sampleId); // never let two timers stack for the same card
        const duration = overrideDurationMs ?? getStageDuration(currentStage, sampleId);
        const handle = setTimeout(onTapRight, duration);
        activeTimers.set(sampleId, handle);
    }

    function onTapRight() {
        if (currentStage < maxStage) {
            enterStage(currentStage + 1);
        } else {
            clearAutoAdvance(sampleId); // reached the verdict -- hold, no further advancing
        }
    }

    function onTapLeft() {
        const elapsedInStage = performance.now() - stageEnteredAt;
        if (elapsedInStage > RESTART_THRESHOLD_MS) {
            enterStage(currentStage); // still mid-stage -- restart it from zero
        } else if (currentStage > 0) {
            enterStage(currentStage - 1); // just arrived -- go to the previous stage instead
        }
        // else: already at stage 0, just entered -- nothing before it, no-op
    }

    // Center tap -- pause/resume, same convention as YouTube Shorts/Reels.
    // This is a genuine, deliberate WITHIN-view pause: it freezes the sweep,
    // the stage-advance countdown, and the progress-bar fill all together,
    // and resuming continues from exactly the same point. It does NOT
    // survive leaving the card -- scrolling away still restarts at zero
    // regardless of whether you left mid-pause, per the broader "always
    // fresh" rule elsewhere in this file.
    function togglePause() {
        if (!isPaused) {
            isPaused = true;
            cardEl.classList.add("paused");

            clearAutoAdvance(sampleId); // stop the stage-advance countdown
            cancelSweepAnimation(sampleId); // freeze the chart's rAF loop

            const fill = segments[currentStage]?.querySelector(".fill");
            if (fill) fill.style.animationPlayState = "paused"; // freeze the CSS bar too -- it runs on its own clock otherwise
        } else {
            isPaused = false;
            cardEl.classList.remove("paused");

            const fill = segments[currentStage]?.querySelector(".fill");
            if (fill) fill.style.animationPlayState = "running";

            const control = activeSweepControl.get(sampleId);
            const elapsedAtPause = control ? control.lastElapsedMs : (performance.now() - stageEnteredAt);

            // shift the reference point forward so future elapsed-since
            // calculations (e.g. a left-tap right after resuming) stay
            // consistent, as if the pause never happened time-wise
            stageEnteredAt = performance.now() - elapsedAtPause;

            const remaining = Math.max(0, getStageDuration(currentStage, sampleId) - elapsedAtPause);
            startAutoAdvance(remaining); // resume the countdown with only what's LEFT, not a fresh full duration

            if (control) {
                startSweepLoop(sampleId, control.totalDurationMs, control.drawFn, elapsedAtPause);
            }
        }
    }

    segments.forEach((seg, i) => {
        seg.addEventListener("click", () => enterStage(i));
    });

    // Three tap zones now, not two: left third = restart/previous (see
    // onTapLeft), middle third = pause/resume, right third = advance.
    const CENTER_ZONE_FRACTION = 0.34;
    const viewport = cardEl.querySelector(".stage-viewport");
    viewport.addEventListener("click", (e) => {
        const rect = viewport.getBoundingClientRect();
        const relativeX = (e.clientX - rect.left) / rect.width; // 0 to 1
        const centerStart = 0.5 - CENTER_ZONE_FRACTION / 2;
        const centerEnd = 0.5 + CENTER_ZONE_FRACTION / 2;

        if (relativeX >= centerStart && relativeX <= centerEnd) {
            togglePause();
        } else if (relativeX > centerEnd) {
            onTapRight();
        } else {
            onTapLeft();
        }
    });

    // Every time this card becomes visible, it starts at stage 0, no
    // exceptions -- per the new rule, there's no "first time" special case
    // to guard against; enterStage() is always safe to call again.
    function activate() {
        enterStage(0);
    }

    // Called by any GLOBAL rail control (speed, color, theme) when it
    // changes -- refreshes whichever stage is CURRENTLY being shown, not
    // just stage 0. Previously this only checked stage 0, which meant
    // changing Speed while sitting on Stage 2 (or any later stage) silently
    // did nothing until you left and came back. Since Speed now applies
    // uniformly across every stage, the refresh needs to too.
    function refreshActiveStage() {
        enterStage(currentStage); // restarts whatever stage is currently showing, with the new setting applied
    }

    // onTapLeft/onTapRight/togglePause exposed here too -- not just for the
    // tap zones internally, but so anything ELSE (keyboard controls, for
    // instance) can trigger the EXACT same navigation logic, rather than
    // needing its own separate implementation of "what does advancing
    // actually mean."
    return { sampleId, activate, refreshActiveStage, onTapLeft, onTapRight, togglePause };
}