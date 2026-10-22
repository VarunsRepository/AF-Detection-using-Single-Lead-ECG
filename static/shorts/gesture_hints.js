// ---------------------------------------------------------------------------
// static/shorts/gesture_hints.js
//
// GESTURE HINTS -- the small animated touch marks that show a control can
// be used: a tap ring on a rail button, a travelling dot for a swipe, a
// filling ring for a press-and-hold.
//
// NOT the same thing as the onboarding overlay already in this app. That
// one is a GUIDED TOUR: full screen, up front, dots and a Next button,
// shown before the feed has played a single frame. It tells you about
// controls you have no reason to care about yet, which is why people tap
// Skip and why the controls still are not discovered. These hints are
// the other kind -- JUST IN TIME. A hint fires the first time its
// control is actually on screen and relevant, points at the real
// element, and never appears again.
//
// FOUR RULES, and every one of them is a thing that makes hint layers
// obnoxious when it is missing:
//
//   1. ONE AT A TIME. Two arrows at once is a diagram, not a hint.
//   2. NEVER INTERCEPT A TAP. pointer-events:none on everything here,
//      the same rule .stage-caption and .pause-indicator already follow.
//      A hint that eats the tap it is advertising is worse than no hint.
//   3. CANCEL ON ANY INTERACTION. If the viewer is already tapping and
//      swiping, they do not need to be taught. The hint is for the
//      person who is sitting still because they think it is a video.
//   4. ONCE PER DEVICE, then never again. A hint on its fourth showing
//      is not a hint, it is furniture.
//
// WHY THE DEFAULTS LIVE HERE AND NOT IN FIFTEEN RECIPES
//   The rail and the chip are universal -- every journey has a rail,
//   every tour card has a chip. Declaring their hints per recipe would
//   reproduce exactly what happened to the Share button before it was
//   made universal: "one journey missed it entirely, and three had it on
//   stage 1 only" (journey_interpreter.js). So the universal ones ship
//   here, and a recipe only declares what is TRULY its own.
//
// WHERE A RECIPE PUTS ITS OWN
//   uiShell.gestureHints -- a list to add, or false to suppress all of
//   them for that journey.
//
//   Deliberately inside uiShell rather than a new top-level key:
//   journey_store.build_journey() returns an explicit allowlist of
//   top-level keys, so a new one is DROPPED ON THE SERVER and never
//   reaches the browser. uiShell is already on that list, and a hint is
//   a shell concern anyway -- it sits with showProgressBar, which is the
//   same kind of thing.
// ---------------------------------------------------------------------------

(function () {
    "use strict";

    // ── Storage ──────────────────────────────────────────────────────────
    // localStorage throws outright in some privacy modes rather than
    // returning null, so every access is wrapped. A browser that refuses
    // to remember must still get working hints -- it just gets them once
    // per session instead of once per device, which is a fine
    // degradation and not worth a line of code to avoid.
    const memory = new Set();

    function wasSeen(id) {
        if (memory.has(id)) return true;
        try {
            return window.localStorage.getItem("kg.hint." + id) === "1";
        } catch (_) { return false; }
    }

    function markSeen(id) {
        memory.add(id);
        try { window.localStorage.setItem("kg.hint." + id, "1"); } catch (_) {}
    }

    // Exposed so the dev HUD can make hints showable again without
    // clearing every other key the app stores.
    function resetHints() {
        memory.clear();
        try {
            Object.keys(window.localStorage)
                  .filter(k => k.startsWith("kg.hint."))
                  .forEach(k => window.localStorage.removeItem(k));
        } catch (_) {}
    }

    // ── The universal hints ──────────────────────────────────────────────
    //
    // Order is priority order. Only one hint is ever on screen, and a
    // hint whose target is not currently in the DOM is skipped WITHOUT
    // being marked seen -- so a rail button that only exists on stage 2
    // gets its hint when stage 2 arrives, not a wasted one on stage 1.
    //
    // KEEP THIS LIST SHORT. The temptation is a hint per control, and
    // six hints is a tutorial. Each one here has to earn its place by
    // being something a viewer would otherwise never find out about.
    const DEFAULT_HINTS = [
        {
            // The highest-value one in the app. A tour card is one
            // recording out of thousands and nothing on screen says the
            // rest exist. Only on curated feeds, because the chip only
            // exists there.
            id: "more_from",
            target: { selector: ".more-from" },
            gesture: "tap",
            text: "There's more of this",
            afterMs: 5200,       // late: let the card actually play first
        },
        {
            // "You can change the algorithm" is the single least
            // guessable thing here -- a round button with "PT" on it
            // reads as a label, not a control.
            //
            // Addressed by METHOD, not label: the label is recipe prose
            // ("Algorithm", "Detector", "Filter" -- whatever that recipe
            // wrote), while switchAlgorithm is the dispatcher's own verb
            // and is identical in every recipe. A label-matched hint
            // would silently never fire on a journey that worded it
            // differently.
            id: "rail_algorithm",
            target: { railMethod: "switchAlgorithm" },
            gesture: "tap",
            text: "Swap the detector",
            afterMs: 3400,
        },
        {
            // The horizontal drag-to-scrub on the chart. Genuinely
            // undiscoverable: it has no handle, no bar, and no visible
            // affordance of any kind.
            //
            // NOT a press-and-hold. There is no hold gesture in this app
            // -- journey_interpreter.js binds pointerdown/move/up for a
            // horizontal scrub, and the card's own click handler pauses
            // on a CENTRE tap. A hint saying "hold to pause" would have
            // taught a gesture that does not exist.
            id: "card_scrub",
            target: { selector: ".chart" },
            gesture: "drag-h",
            text: "Drag to scrub",
            afterMs: 2800,
        },
    ];

    // ── Target resolution ────────────────────────────────────────────────
    // A rail button is addressed by what it DOES or what it is CALLED --
    // never by position. The rail is rebuilt on every stage change and
    // its contents vary by stage AND by algorithm (choices() adds
    // buttons at runtime), so ".rail-btn:nth-child(3)" is a different
    // control on every card.
    //
    //   {railMethod: "switchAlgorithm"}  PREFER THIS. The dispatcher's
    //       own verb, identical across every recipe.
    //   {rail: "Algorithm"}  the recipe's ui.label, which is prose and
    //       differs between journeys. Right for a control that only one
    //       journey has.
    //
    // Both need two lines in journey_interpreter.js's buildRail():
    //     btn.dataset.railLabel  = control.ui.label;
    //     btn.dataset.railMethod = control.action.method;
    // Matching on btn.title does NOT work -- refreshButtonContent()
    // rewrites it to "Algorithm: pan_tompkins" as soon as a
    // value-showing button renders.
    // CSS.escape has been in every browser since 2015, but it is read
    // through a guard because this file also runs under test harnesses
    // and the fallback is two characters of work.
    function cssEscape(s) {
        if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
        return String(s).replace(/["\\]/g, "\\$&");
    }

    function resolveTarget(card, target) {
        if (!target) return null;
        if (target.railMethod) {
            return card.querySelector(
                `.rail-btn[data-rail-method="${cssEscape(target.railMethod)}"]`);
        }
        if (target.rail) {
            return card.querySelector(
                `.rail-btn[data-rail-label="${cssEscape(target.rail)}"]`);
        }
        if (target.selector) return card.querySelector(target.selector);
        return null;
    }

    // ── One hint, on one card ────────────────────────────────────────────

    let liveHint = null;   // the DOM node currently showing, app-wide

    function clearLive() {
        if (!liveHint) return;
        liveHint.remove();
        liveHint = null;
    }

    function showHint(card, hint, targetEl) {
        clearLive();

        const reduced = window.matchMedia
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const cardBox   = card.getBoundingClientRect();
        const targetBox = targetEl.getBoundingClientRect();

        // A zero-sized target means the element is in the DOM but not
        // laid out yet (display:none, or a collapsed zone). Positioning
        // against it would put the hint at the card's top-left corner,
        // pointing at nothing -- so treat it as not ready and let a
        // later pass try again.
        if (targetBox.width === 0 || targetBox.height === 0) return false;

        const cx = targetBox.left + targetBox.width  / 2 - cardBox.left;
        const cy = targetBox.top  + targetBox.height / 2 - cardBox.top;

        const layer = document.createElement("div");
        layer.className = "ghint";
        layer.setAttribute("aria-hidden", "true");   // decorative; the
        // control itself carries the accessible name via its title
        if (reduced) layer.classList.add("ghint-still");

        const dot = document.createElement("div");
        dot.className = `ghint-dot ghint-${hint.gesture}`;
        dot.style.left = `${cx}px`;
        dot.style.top  = `${cy}px`;

        const label = document.createElement("div");
        label.className = "ghint-label";
        label.textContent = hint.text;
        label.style.top = `${cy}px`;

        // The rail lives hard against the right edge, so a label placed
        // to its right is off-screen. Flip to whichever side has room,
        // measured rather than assumed -- the rail's zone is
        // recipe-controlled and will not always be on the right.
        if (cx > cardBox.width / 2) {
            label.style.right = `${cardBox.width - cx + 28}px`;
            label.classList.add("ghint-label-left");
        } else {
            label.style.left = `${cx + 28}px`;
        }

        layer.appendChild(dot);
        layer.appendChild(label);
        card.appendChild(layer);
        liveHint = layer;

        // Fade in on the next frame so the browser registers the
        // starting state -- same reason .verdict-badge waits a frame
        // before adding .revealed.
        requestAnimationFrame(() => layer.classList.add("ghint-visible"));

        const holdMs = reduced ? 2600 : (hint.holdMs ?? 4200);
        setTimeout(() => {
            if (liveHint !== layer) return;    // something else replaced it
            layer.classList.remove("ghint-visible");
            setTimeout(() => { if (liveHint === layer) clearLive(); }, 320);
        }, holdMs);

        markSeen(hint.id);
        if (typeof window.trackEvent === "function") {
            window.trackEvent("hint_shown", card.dataset.sampleId || null,
                              { hint_id: hint.id });
        }
        return true;
    }

    // ── Per-card runner ──────────────────────────────────────────────────
    //
    // startGestureHints(card, {uiShell, isCurated}) is called when a card
    // becomes the active one. It returns a stop() for when the card
    // leaves -- a hint must never outlive the card it belongs to, or it
    // ends up floating over the next short.
    function startGestureHints(card, { uiShell, isCurated } = {}) {
        const declared = uiShell?.gestureHints;

        // false suppresses the lot. A journey whose whole point is a
        // still diagram has nothing to demonstrate.
        if (declared === false) return () => {};

        const queue = [
            ...DEFAULT_HINTS.filter(h =>
                // The chip only exists on curated feeds, so its hint
                // would otherwise sit in the queue for ever, blocking
                // nothing but costing a lookup on every pass.
                h.id !== "more_from" || isCurated),
            ...(Array.isArray(declared) ? declared : []),
        ].filter(h => h && h.id && !wasSeen(h.id));

        if (queue.length === 0) return () => {};

        let stopped = false;
        const timers = [];

        // RULE 3: any interaction at all cancels every pending hint on
        // this card. Capture phase and passive, so this can never
        // interfere with the handlers it is watching for.
        const onInteract = () => stop();
        ["pointerdown", "touchstart", "keydown", "wheel"].forEach(ev =>
            card.addEventListener(ev, onInteract,
                                  { capture: true, passive: true, once: true }));

        // Each hint waits its own delay. A hint in the first second
        // competes with the card's actual content, which is the thing
        // someone came for.
        //
        // READINESS IS PER HINT, and it has to be, because the queue is
        // also PRIORITY order. Without this the two orders fight: the
        // earliest timer to fire would show the highest-priority
        // resolvable hint rather than the one that was scheduled, so
        // "more_from", whose 5.2s delay exists precisely to let the card
        // play first, fired at 40ms behind a faster hint's timer. afterMs
        // then means nothing at all. Checking readiness keeps both
        // orders: among the hints whose time has come, priority decides.
        const readyAt = new Map();
        const now = () => Date.now();
        const t0 = now();

        function attempt() {
            if (stopped || liveHint) return;
            const t = now();
            for (const hint of queue) {
                if (wasSeen(hint.id)) continue;
                if (t < (readyAt.get(hint.id) ?? 0)) continue;
                const el = resolveTarget(card, hint.target);
                if (!el) continue;              // not on this stage; try later
                if (showHint(card, hint, el)) return;
            }
        }

        queue.forEach(h => {
            const delay = h.afterMs ?? 3000;
            readyAt.set(h.id, t0 + delay);
            timers.push(setTimeout(attempt, delay));
        });

        // The rail is wiped and rebuilt on every stage change
        // (buildRail does railContainer.innerHTML = ""), so a hint whose
        // button appears on stage 2 has no event to wait for. Watching
        // the rail's children covers it exactly, and costs nothing while
        // the rail is static.
        const rail = card.querySelector(".stage-rail");
        let railObserver = null;
        // Guarded on the constructor as well as the element: this runs
        // inside the feed's IntersectionObserver callback, so a throw
        // here would take out card_entered and the sweep with it. A hint
        // layer is the least important thing on the card and must fail
        // softer than anything it sits on top of.
        if (rail && typeof MutationObserver === "function") {
            let debounce = null;
            railObserver = new MutationObserver(() => {
                clearTimeout(debounce);
                debounce = setTimeout(attempt, 600);
            });
            railObserver.observe(rail, { childList: true });
            timers.push(() => clearTimeout(debounce));
        }

        function stop() {
            if (stopped) return;
            stopped = true;
            timers.forEach(t => (typeof t === "function" ? t() : clearTimeout(t)));
            railObserver?.disconnect();
            ["pointerdown", "touchstart", "keydown", "wheel"].forEach(ev =>
                card.removeEventListener(ev, onInteract, { capture: true }));
            if (liveHint && card.contains(liveHint)) clearLive();
        }

        return stop;
    }

    window.startGestureHints = startGestureHints;
    window.resetGestureHints = resetHints;
})();
