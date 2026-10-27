// ---------------------------------------------------------------------------
// static/shorts/controls/sheet.js
//
// THE STAGE SHEET -- a bottom sheet for the title, caption and description.
//
// It replaces the old "text overlay that grows", which had four problems
// worth naming, because each one dictated part of this design:
//
//   1. NO BOUNDARY WHEN CLOSED. The dark backdrop only appeared once the
//      text was already open, so closed it was bare prose floating on the
//      render, with a chevron as its only affordance. A chevron on
//      floating text reads as decoration. A sheet edge with a grabber
//      reads as something you can pull, which is the whole ask.
//
//   2. IT ANIMATED max-height TO A FIXED CEILING (6em, 30vh). A short
//      caption reaches its ceiling in a fraction of the duration and
//      snaps; a long description crawls to it. Same transition, a
//      different apparent speed on every card. That was the jerk.
//
//   3. THE TEXT RE-WRAPPED AS IT APPEARED, because padding-right: 76px
//      applied only in the expanded state.
//
//   4. NOTHING SHARED A CONTAINER. The caption's own box had been removed
//      to stop it looking half-finished beside an unboxed description,
//      which left the group with no box at all.
//
// SO: TRANSFORM, NEVER HEIGHT.
//   The sheet is laid out at its OPEN height always, and translated down
//   so only --sheet-peek shows. Opening is translateY(0). That is a
//   compositor-only transition which runs at a constant rate regardless
//   of how much text is in it -- and, far more important, it is the only
//   version you can DRAG. You cannot drag a max-height. Every bit of the
//   "pull it up and down" feel follows from that one choice.
//
// THE THREE RULES THAT MAKE OR BREAK A HAND-ROLLED SHEET
//   a. ONLY THE HANDLE STARTS A VERTICAL DRAG. The feed owns vertical
//      swipe (next journey); the sheet owns vertical drag. They cannot
//      both own it in the same region, so the handle is the region, and
//      it declares touch-action:none to take it.
//   b. THE BODY IS A REAL SCROLLPORT WITH overscroll-behavior: contain,
//      and `overflow-y: scroll` rather than `auto` -- a non-overflowing
//      `auto` element is not a scrollport for touch purposes in Chrome,
//      so a drag over a short description would chain straight through
//      to the feed and flick the viewer to the next card mid-sentence.
//   c. OPEN IS MODAL. A scrim catches the tap-to-close and, incidentally,
//      stops the card's own left/right tap zones firing under it. The
//      non-modal version sounds friendlier and is unusable.
//
// --sheet-peek IS MEASURED, NOT GUESSED, and lives on the CARD rather
// than the sheet, because the centre zone's bottom padding and the chip
// slot's offset both need it. A one-line title and a two-line title are
// different heights, and so is the same title at a different clamp()
// breakpoint -- a hardcoded 60px is a different feature on every screen,
// which is a mistake this project has already made twice.
//
// SELF-CONTAINED. This file, one CSS block in shorts_feed.css, and the
// mount call in journey_scroll_feed.js are the whole feature.
// ---------------------------------------------------------------------------

// A drag has begun once the finger has moved this far vertically. Lower
// than the feed's own threshold on purpose: the handle has already won
// the gesture via touch-action, so there is nobody to arbitrate against.
const SHEET_DRAG_START_PX = 5;

// A press that never became a drag is a tap. Both numbers are below the
// feed's TAP_MAX_MS/TAP_MAX_PX, so anything the sheet calls a tap the
// feed would have called one too.
const SHEET_TAP_MAX_MS = 400;
const SHEET_TAP_MAX_PX = 8;

// px/ms at release. 0.35 is roughly "a deliberate flick" -- below it the
// decision falls back to how far the sheet actually travelled, so a slow
// careful drag lands where you left it rather than where you threw it.
const SHEET_FLICK_PX_PER_MS = 0.35;

// Past either end the sheet still moves, at a third of the finger's
// speed. A hard stop at the limit feels like a bug; resistance feels
// like a limit.
const SHEET_RUBBER = 3;

let _sheetSeq = 0;

/**
 * Turn a .stage-sheet element into a working sheet.
 *
 * Expects the markup journey_scroll_feed.js builds:
 *   <div class="layout-zone stage-sheet" data-zone="bottom">
 *     <div class="sheet-handle"><span class="sheet-grab"></span>...title...</div>
 *     <div class="sheet-body">...caption, description...</div>
 *   </div>
 *
 * Returns { open, close, toggle, isOpen, destroy } or null if the element
 * is not a mountable sheet -- in which case the zone stays a plain
 * stacked flex column and nothing breaks. A sheet with nothing in its
 * handle has no peek, and a sheet with no peek is an invisible control.
 */
function mountSheet(sheetEl, opts = {}) {
    if (!sheetEl) return null;
    const handle = sheetEl.querySelector(".sheet-handle");
    const body   = sheetEl.querySelector(".sheet-body");
    const grab   = sheetEl.querySelector(".sheet-grab");
    const card   = sheetEl.closest(".journey-card");
    if (!handle || !body || !grab || !card) return null;
    if (!handle.querySelector(".stage-title")) return null;

    // ── Scrim ────────────────────────────────────────────────────────────
    // Built here rather than in the card markup so the sheet owns every
    // part of itself: delete the mount call and the scrim goes with it.
    // Inserted BEFORE the sheet so DOM order matches paint order even if
    // the z-indexes are ever flattened.
    const scrim = document.createElement("div");
    scrim.className = "sheet-scrim";
    sheetEl.parentNode.insertBefore(scrim, sheetEl);

    // ── Accessibility ────────────────────────────────────────────────────
    // The handle is the control, so it is the thing that gets a role, a
    // tab stop and aria-expanded. Keyboard support here is not padding:
    // it is the first consumer of the same two intents the planned
    // joystick/keyboard layer will send (open, close).
    const id = opts.id || `stage-sheet-${++_sheetSeq}`;
    body.id = `${id}-body`;
    handle.setAttribute("role", "button");
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("aria-controls", body.id);

    let open   = false;
    let peek   = 0;
    let drag   = null;
    let dead   = false;

    const reduced = window.matchMedia
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) sheetEl.classList.add("sheet-still");

    // ── Peek height ──────────────────────────────────────────────────────
    // THE WHOLE HANDLE, which means the title is inside the peek and
    // visible while the sheet is shut.
    //
    // Briefly this measured only to the grabber, to get the closed height
    // down to 20px. That works and looks wrong: a card at rest then has
    // no label at all, and on a journey with no "more from" chip it has
    // no text whatsoever. One line of title is ~20px on its own, so a
    // peek that shows it cannot be much under 38 -- that is arithmetic,
    // not taste, and the honest answer was to say so rather than ship the
    // thin version and let it be discovered.
    function measurePeek() {
        const h = Math.round(handle.getBoundingClientRect().height);
        // 0 while the card is display:none or not yet laid out. Writing 0
        // would translate the sheet entirely off the card and leave no
        // handle to pull, so a bad measurement is DISCARDED rather than
        // defaulted -- the CSS fallback in var(--sheet-peek, 38px) is the
        // visible-but-wrong state, which is the one you can see and fix.
        if (!h || h === peek) return;
        peek = h;

        // THE PEEK IS PART OF THE CLOSED TRANSFORM, so writing it while
        // closed would ANIMATE the sheet to its new height over 360ms --
        // and for those 360ms the handle is taller than the strip of
        // sheet on the card, which means the title's second line is
        // clipped below the card edge. Every stage change whose title
        // wraps differently would twitch.
        //
        // Measured, not guessed: 53px -> 74px on a two-line title, with
        // the sheet showing 94px of a wanted 100 a frame later.
        //
        // So the change is applied WITHOUT a transition and the position
        // is snapped. Same re-trigger pattern the progress bar needed --
        // kill the transition, write, force the reflow, restore. Open,
        // the transform is translateY(0) and does not depend on the peek
        // at all, so there is nothing to snap.
        const snap = !open;
        if (snap) sheetEl.classList.add("sheet-nosnap");
        card.style.setProperty("--sheet-peek", `${h}px`);
        if (snap) {
            void sheetEl.offsetWidth;          // the reflow IS the fix
            sheetEl.classList.remove("sheet-nosnap");
        }
    }
    measurePeek();

    // The title text changes on every stage, and a one-line title can
    // become a two-line one. Observing the handle covers that, plus font
    // scaling, plus rotation, without polling.
    const ro = (typeof ResizeObserver === "function")
        ? new ResizeObserver(measurePeek)
        : null;
    ro?.observe(handle);

    // ── State ────────────────────────────────────────────────────────────
    function applyState() {
        sheetEl.style.transform = "";        // hand the position back to CSS
        // Hand --sheet-progress back too, so the scrim and rail transition
        // to their snapped values from wherever the drag left them.
        card.style.removeProperty("--sheet-progress");
        card.classList.remove("sheet-dragging");
        sheetEl.classList.toggle("is-open", open);
        card.classList.toggle("sheet-open", open);
        handle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function setOpen(next, { silent = false } = {}) {
        next = Boolean(next);
        if (next === open) { applyState(); return; }   // snapped back
        open = next;
        if (!open) body.scrollTop = 0;   // reopen at the top, not mid-read
        applyState();
        if (!silent) {
            try { (open ? opts.onOpen : opts.onClose)?.(); }
            catch (err) { console.error("[SHEET] callback threw", err); }
        }
    }

    // ── Drag ─────────────────────────────────────────────────────────────
    // translateY(0) is open; translateY(travel) is closed. travel is
    // re-read on every press because the sheet's height is vh-based and
    // the peek can have changed since the last one.
    function travelPx() {
        return Math.max(1, sheetEl.offsetHeight - peek);
    }

    handle.addEventListener("pointerdown", (e) => {
        if (dead) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const travel = travelPx();
        drag = {
            id: e.pointerId,
            x0: e.clientX, y0: e.clientY,
            t0: performance.now(),
            lastY: e.clientY, lastT: performance.now(),
            v: 0, moved: 0, active: false,
            travel,
            from: open ? 0 : travel,
        };
        // Capture, so a finger that slides off the handle mid-drag still
        // reports to us instead of silently abandoning the sheet halfway.
        try { handle.setPointerCapture(e.pointerId); } catch { /* fine */ }
    });

    handle.addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dy = e.clientY - drag.y0;
        drag.moved = Math.max(drag.moved,
                              Math.hypot(e.clientX - drag.x0, dy));
        if (!drag.active) {
            if (Math.abs(dy) < SHEET_DRAG_START_PX) return;
            drag.active = true;
            sheetEl.classList.add("is-dragging");   // kills the transition
            card.classList.add("sheet-dragging");   // and the scrim's/rail's
        }

        const now = performance.now();
        const dt  = now - drag.lastT;
        // Instantaneous velocity, not an average over the whole drag: a
        // long slow drag that ends in a flick should honour the flick.
        if (dt > 0) drag.v = (e.clientY - drag.lastY) / dt;
        drag.lastY = e.clientY;
        drag.lastT = now;

        let at = drag.from + dy;
        if (at < 0)            at = at / SHEET_RUBBER;
        if (at > drag.travel)  at = drag.travel
                                  + (at - drag.travel) / SHEET_RUBBER;
        sheetEl.style.transform = `translateY(${at}px)`;

        // Everything that reacts to the sheet follows the finger too:
        // the scrim darkens as it rises, the rail and the chip fade out
        // of its way. Clamped, so the rubber-band overshoot at either
        // end does not push an opacity outside 0..1.
        const p = 1 - Math.min(1, Math.max(0, at / drag.travel));
        card.style.setProperty("--sheet-progress", p.toFixed(3));
    });

    function endDrag(e) {
        if (!drag) return;
        if (e && e.pointerId !== drag.id) return;
        const d = drag;
        drag = null;
        try { handle.releasePointerCapture(d.id); } catch { /* fine */ }
        sheetEl.classList.remove("is-dragging");

        // Never became a drag -> it was a tap on the handle. Tap toggles,
        // which keeps the old affordance working for anyone who learned
        // to tap the title, and gives the sheet two ways in.
        if (!d.active) {
            const quick = performance.now() - d.t0 < SHEET_TAP_MAX_MS;
            if (quick && d.moved <= SHEET_TAP_MAX_PX) setOpen(!open);
            else applyState();
            return;
        }

        const at       = d.from + (d.lastY - d.y0);
        const progress = 1 - Math.min(1, Math.max(0, at / d.travel));

        if      (d.v < -SHEET_FLICK_PX_PER_MS) setOpen(true);
        else if (d.v >  SHEET_FLICK_PX_PER_MS) setOpen(false);
        else                                   setOpen(progress > 0.5);
        // setOpen clears the inline transform, and clearing it in the
        // same JS turn as the class change is what lets the transition
        // run from where the finger left off rather than jumping first.
        applyState();
    }

    handle.addEventListener("pointerup",     endDrag);
    handle.addEventListener("pointercancel", endDrag);

    // ── Tap-outside and keyboard ─────────────────────────────────────────
    scrim.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
    scrim.addEventListener("click", (e) => {
        e.stopPropagation();
        setOpen(false);
    });

    handle.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
            e.preventDefault();
            setOpen(!open);
        } else if (e.key === "Escape" && open) {
            setOpen(false);
        }
    });
    // Escape from inside the body too -- once you are scrolling a long
    // description the handle no longer has focus.
    body.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); }
    });

    applyState();

    return {
        open:    () => setOpen(true),
        close:   (o) => setOpen(false, o),
        toggle:  () => setOpen(!open),
        isOpen:  () => open,
        remeasure: measurePeek,
        destroy: () => {
            dead = true;
            ro?.disconnect();
            scrim.remove();
        },
    };
}