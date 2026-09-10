// ---------------------------------------------------------------------------
// features/stage_caption.js
// Brief, non-blocking caption shown when a Stage starts -- fades in, holds
// briefly, fades out on its own. Never requires a tap, never blocks
// navigation (pointer-events:none in CSS).
//
// FIRST-TIME-ONLY now, per Stage type, across the WHOLE feed -- not per
// Journey. Once you've seen "Finding Each Beat"'s caption on ANY Journey,
// it never shows again for that Stage, no matter how many other Journeys
// you scroll through afterward. This is "Layer 4" from the earlier
// comprehension-layers plan, built only once real use confirmed the
// original "every single time" version felt repetitive after the first
// few Journeys -- exactly the trigger condition that plan called for.
//
// Reuses label.blurb -- the SAME sentence already used by onboarding.js
// and the explainer's plain-English first tap. One source of truth, a
// third consumer now, still can't drift apart.
//
// Depends on stage_engine.js (getStageLabel) -- must be loaded before this
// file. Self-contained and optional, same decoupling pattern as
// algorithm_explainer.js and onboarding.js: if this file weren't loaded at
// all, stage_machine.js's call to showStageCaption() would just silently
// no-op (via its own typeof guard), and Journeys would play with no
// captions at all -- not broken, just missing this one layer.
// ---------------------------------------------------------------------------

const CAPTION_SEEN_STORAGE_KEY = "ecg_shorts_captions_seen";

// Keyed by the actual DOM element, not by sample/card -- since only ONE
// Journey is ever visible/active at a time, this mostly matters for the
// rare case of a rapid restart during the FIRST-ever encounter with a
// given Stage (before it's marked seen and stops firing entirely).
const captionTimeouts = new Map();

function hasSeenCaptionForStage(stageIdx) {
    try {
        const seen = JSON.parse(localStorage.getItem(CAPTION_SEEN_STORAGE_KEY) || "[]");
        return seen.includes(stageIdx);
    } catch {
        return false; // if storage is unavailable/corrupted, err toward showing it once more rather than silently hiding forever
    }
}

function markCaptionSeenForStage(stageIdx) {
    try {
        const seen = JSON.parse(localStorage.getItem(CAPTION_SEEN_STORAGE_KEY) || "[]");
        if (!seen.includes(stageIdx)) {
            seen.push(stageIdx);
            localStorage.setItem(CAPTION_SEEN_STORAGE_KEY, JSON.stringify(seen));
        }
    } catch {
        // ignore -- worst case it shows again next time, not worth blocking over
    }
}

function showStageCaption(stageContentEl, stageIdx) {
    if (hasSeenCaptionForStage(stageIdx)) return; // already seen this Stage's caption before -- never again

    const label = typeof getStageLabel === "function" ? getStageLabel(stageIdx) : null;
    if (!label || !label.blurb) return; // nothing to show for a Stage with no blurb defined

    let caption = stageContentEl.querySelector(".stage-caption");
    if (!caption) {
        caption = document.createElement("div");
        caption.className = "stage-caption";
        stageContentEl.appendChild(caption);
    }
    caption.textContent = label.blurb;

    // cancel any pending fade-out from a previous caption still in flight
    // on this SAME element (e.g. a rapid restart before it's marked seen)
    if (captionTimeouts.has(stageContentEl)) {
        clearTimeout(captionTimeouts.get(stageContentEl));
        captionTimeouts.delete(stageContentEl);
    }

    // force a reflow between removing and re-adding "visible" -- same
    // trick used elsewhere in this codebase for reliably restarting a CSS
    // transition, rather than risking the browser coalescing a same-frame
    // class change into a no-op
    caption.classList.remove("visible");
    void caption.offsetWidth;
    caption.classList.add("visible");

    const handle = setTimeout(() => {
        caption.classList.remove("visible");
        captionTimeouts.delete(stageContentEl);
    }, 2600);
    captionTimeouts.set(stageContentEl, handle);

    markCaptionSeenForStage(stageIdx); // never show this Stage's caption again, on any Journey, from here on
}
