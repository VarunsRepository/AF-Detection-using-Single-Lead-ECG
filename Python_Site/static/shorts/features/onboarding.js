// ---------------------------------------------------------------------------
// onboarding.js
// One-time onboarding, shown before the feed ever plays -- ONLY on a
// visitor's genuine first visit (tracked via localStorage). Purely
// explanatory, sets baseline vocabulary once, never interrupts scrolling
// again after that. Self-contained and optional: if this file weren't
// loaded at all, the feed would just start immediately, exactly as before
// this existed -- same "typeof check" decoupling pattern as
// algorithm_explainer.js.
//
// Slides are NOT a separate hand-authored array -- they're generated at
// call time from each stage's own registered label metadata (the same
// {main, small, blurb} used for the stage-bar labels in shorts_feed.js).
// The original version hardcoded 4 slides independently while the app had
// 5 real stages -- Stage 1 (baseline correction) was silently missing from
// onboarding the whole time, with nothing to catch it. One source of truth
// now makes that specific class of bug structurally impossible: a future
// Stage 5 gets an onboarding slide automatically, the moment it's
// registered, with no second place to remember to update.
// ---------------------------------------------------------------------------

const ONBOARDING_STORAGE_KEY = "ecg_shorts_onboarding_seen";

function buildOnboardingSlides() {
    const stageCount = typeof getRegisteredStageCount === "function" ? getRegisteredStageCount() : 0;
    const slides = [];
    for (let i = 0; i < stageCount; i++) {
        const label = typeof getStageLabel === "function" ? getStageLabel(i) : null;
        if (!label || !label.blurb) continue; // skip any stage that hasn't defined onboarding-worthy text
        slides.push({ title: label.main, body: label.blurb });
    }
    return slides;
}

function hasSeenOnboarding() {
    try {
        return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
    } catch {
        return true; // if localStorage is unavailable for some reason, don't block the feed over it
    }
}

function markOnboardingSeen() {
    try {
        localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    } catch {
        // ignore -- worst case, onboarding shows again next visit, not worth blocking over
    }
}

// onComplete is called once the visitor finishes or skips -- this is how
// shorts_feed.js knows when it's safe to actually start loading the feed.
function showOnboarding(onComplete) {
    const slides = buildOnboardingSlides();

    if (slides.length === 0) {
        // no stage metadata available (e.g. stage_renderers.js somehow
        // didn't load) -- don't show a broken, empty onboarding; just get
        // out of the way and let the feed start normally
        markOnboardingSeen();
        onComplete();
        return;
    }

    let currentSlide = 0;

    const overlay = document.createElement("div");
    overlay.className = "onboarding-overlay";

    function render() {
        const slide = slides[currentSlide];
        const isLast = currentSlide === slides.length - 1;

        overlay.innerHTML = `
            <div class="onboarding-card">
                <div class="onboarding-dots">
                    ${slides.map((_, i) =>
                        `<span class="onboarding-dot${i === currentSlide ? " active" : ""}"></span>`
                    ).join("")}
                </div>
                <h2 class="onboarding-title">${slide.title}</h2>
                <p class="onboarding-body">${slide.body}</p>
                <div class="onboarding-actions">
                    <button class="onboarding-skip">Skip</button>
                    <button class="onboarding-next">${isLast ? "Get Started" : "Next"}</button>
                </div>
            </div>
        `;

        overlay.querySelector(".onboarding-skip").addEventListener("click", finish);
        overlay.querySelector(".onboarding-next").addEventListener("click", () => {
            if (isLast) {
                finish();
            } else {
                currentSlide++;
                render();
            }
        });
    }

    function finish() {
        markOnboardingSeen();
        overlay.remove();
        onComplete();
    }

    render();
    document.body.appendChild(overlay);
}