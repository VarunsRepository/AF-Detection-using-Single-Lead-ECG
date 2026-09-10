// ---------------------------------------------------------------------------
// keyboard_controls.js
// Arrow-key and spacebar equivalents of the tap zones -- Left = restart-or-
// previous, Right = advance, Space = pause/resume. Reuses the EXACT same
// onTapLeft/onTapRight/togglePause functions the tap zones themselves call
// (exposed on the controller by stage_machine.js), rather than
// reimplementing "what does advancing mean" a second time.
//
// Self-contained and optional, same decoupling pattern as onboarding.js/
// stage_caption.js: if this file weren't loaded, keyboard shortcuts simply
// wouldn't exist -- nothing else breaks.
//
// Scoped to the main feed's currentlyVisibleController (set by
// journey_feed.js's IntersectionObserver) -- this does NOT extend to the
// separate DWT Journey page, which runs its own standalone navigator with
// no equivalent controller. That page would need its own small, similar
// addition if keyboard support is wanted there too.
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
    // Never hijack keys while the user is actually typing somewhere (a
    // text input, if one's ever added) -- arrow keys and spacebar have
    // their own normal meaning there (cursor movement, typing a space).
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (typeof currentlyVisibleController === "undefined" || !currentlyVisibleController) return;

    if (e.key === "ArrowLeft") {
        e.preventDefault();
        currentlyVisibleController.onTapLeft();
    } else if (e.key === "ArrowRight") {
        e.preventDefault();
        currentlyVisibleController.onTapRight();
    } else if (e.code === "Space") {
        // Space's default behavior is to scroll the page -- actively
        // unwanted here, since the feed is a vertical scroll-snap surface
        // where an unexpected scroll would fight the snap mechanics.
        e.preventDefault();
        currentlyVisibleController.togglePause();
    }
});
