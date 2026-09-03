// ---------------------------------------------------------------------------
// shorts_feed.js
// The main entry point: builds cards from real backend data, paginates as
// the user scrolls, wires each card into the shared visibility observer,
// and handles session-level bookkeeping (the "nice session" summary).
//
// Depends on ALL of: pan_tompkins_filter.js, baseline_correction_filter.js,
// hrv_metrics_filter.js, stage_engine.js, rail_controls.js, stage_renderers.js,
// stage_machine.js -- load this one LAST.
// ---------------------------------------------------------------------------

const SESSION_SUMMARY_EVERY = 10; // show the "nice session" card every N cards viewed

// NOTE: no localStorage progress tracking anymore. Under the new rule --
// every card always starts at stage 0, every time you scroll to it, no
// exceptions -- there's nothing to remember across visits. This removes an
// entire category of state (and the bugs that came with keeping it in sync).
let cardsViewedThisSession = 0;

// Each sample's TRUE class label (N/A/O/~), keyed by sampleId. Populated
// below when each card is built, from the real label the backend already
// sent us -- this is what Stage 4 (Verdict) reads from, via its processor
// in stage_renderers.js. Deliberately a plain lookup map, not something a
// processor reads off the DOM -- keeps that concern out of stage_renderers.js
// entirely, and stays correct even if the card markup ever changes shape.
const sampleLabels = new Map();

// ---------------------------------------------------------------------------
// Dynamic card construction. Builds the same DOM structure the static demo
// cards used to have, but from a real sample_id fetched from the backend.
// stageCount defaults to 5 (raw -> corrected -> peaks -> metrics -> verdict) --
// the full pipeline is now real, end to end.
// ---------------------------------------------------------------------------
function buildCardElement(sampleId, label, stageCount = 5) {
    sampleLabels.set(sampleId, label);

    const card = document.createElement("section");
    card.className = "card";
    card.dataset.sampleId = sampleId;
    card.dataset.trueLabel = label ?? ""; // kept for any DOM-level/CSS use;
                                            // sampleLabels above is the real
                                            // source of truth for JS logic

    // shown/hidden purely via the .paused class on the card itself (see
    // togglePause() in stage_machine.js) -- no JS-driven show/hide logic needed here
    const pauseIndicator = document.createElement("div");
    pauseIndicator.className = "pause-indicator";
    pauseIndicator.innerHTML = "&#10074;&#10074;"; // ⏸ rendered as two bars, safe across fonts

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    bar.dataset.stageCount = stageCount;

    const viewport = document.createElement("div");
    viewport.className = "stage-viewport";

    for (let i = 0; i < stageCount; i++) {
        const segment = document.createElement("div");
        segment.className = "segment";
        segment.dataset.stage = i;
        segment.innerHTML = '<div class="fill"></div>';
        bar.appendChild(segment);

        // Reads label metadata straight from THIS stage's own registration
        // (stage_renderers.js's registerStage() calls) -- not a separate,
        // independently-maintained array. Plain-word first, technical term
        // kept small alongside: a casual viewer reads one clear phrase and
        // keeps scrolling; anyone curious still sees the real term, right
        // there, just secondary.
        const stageLabel = (typeof getStageLabel === "function" && getStageLabel(i)) || { main: `Stage ${i}`, small: "" };

        const stageContent = document.createElement("div");
        stageContent.className = i === 0 ? "stage-content active" : "stage-content";
        stageContent.dataset.stage = i;
        stageContent.innerHTML = `
            <div class="stage-label${i === stageCount - 1 ? " verdict-label" : ""}">
                ${stageLabel.main}
                ${stageLabel.small ? `<span class="stage-label-small">${stageLabel.small}</span>` : ""}
            </div>
            <div class="chart-frame${i === stageCount - 1 ? " verdict-frame" : ""}" id="chart-${sampleId}-${i}"></div>
        `;
        viewport.appendChild(stageContent);
    }

    const footer = document.createElement("div");
    footer.className = "card-footer";
    footer.innerHTML = `
        <span class="sample-id">#${sampleId}</span>
        <span class="tap-hint">tap right to advance &middot; swipe up for next</span>
    `;

    // Right-side control rail, YT Shorts-style positioning. Speed and theme
    // are GLOBAL state (same across every card); invert is PER-SAMPLE, so
    // its pressed-state reflects only THIS card's own inverted status.
    const rail = document.createElement("div");
    rail.className = "stage-rail";
    rail.innerHTML = `
        <button class="rail-btn rail-speed" data-role="speed" title="Playback speed">
            <span class="rail-speed-label">${SPEED_MODES[speedModeIndex].label}</span>
        </button>
        <button class="rail-btn rail-invert" data-role="invert" title="Invert signal" aria-pressed="${invertedSamples.has(sampleId)}">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v6M9 6l3-3 3 3"/>
                <path d="M12 21v-6M9 18l3 3 3-3"/>
            </svg>
        </button>
        <button class="rail-btn rail-theme" data-role="theme" title="Theme (${THEMES[themeIndex].label})">
            <svg viewBox="0 0 24 24" width="20" height="20">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>
                <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>
            </svg>
            <span class="swatch-dot" style="--swatch:${THEMES[themeIndex].traceColor}"></span>
        </button>
        <button class="rail-btn rail-algo" data-role="algo" title="Peak detection algorithm">
            <span class="rail-algo-label">${(typeof getSelectedDetector === "function" ? getSelectedDetector().label : "PT")}</span>
        </button>
    `;

    card.appendChild(bar);
    card.appendChild(viewport);
    card.appendChild(footer);
    card.appendChild(rail);
    card.appendChild(pauseIndicator);
    return card;
}

// ---------------------------------------------------------------------------
// Pagination state. PAGE_SIZE controls how many cards load per batch --
// both the initial load AND every subsequent "load more" as the sentinel
// is reached. totalAvailable is filled in from the server's first response,
// so we know exactly when to stop trying (genuinely out of records) rather
// than requesting forever.
// ---------------------------------------------------------------------------
const PAGE_SIZE = 10;
let loadedCount = 0;
let totalAvailable = null;
let isLoadingMore = false;

async function fetchSamplesPage(offset) {
    const res = await fetch(`/shorts/api/samples?limit=${PAGE_SIZE}&offset=${offset}`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    return res.json(); // { samples, total, offset }
}

async function loadFeedCards() {
    const feed = document.getElementById("feed");
    try {
        const { samples, total } = await fetchSamplesPage(0);
        totalAvailable = total;

        if (samples.length === 0) {
            feed.innerHTML = '<p style="color:#747d8c;text-align:center;margin-top:40vh;">No records found in cache.</p>';
            return;
        }

        samples.forEach(({ record_id, label }) => feed.appendChild(buildCardElement(record_id, label)));
        loadedCount = samples.length;
    } catch (err) {
        console.error("Failed to load sample list:", err);
        feed.innerHTML = '<p style="color:#a32638;text-align:center;margin-top:40vh;">Could not load records.</p>';
    }
}

// Called by the sentinel observer (see initFeed) whenever it comes into
// view -- appends the next page, and hooks each new card into the SAME
// controller map + visibility observer as the original batch, via the
// registerCard callback initFeed provides.
async function loadMoreCards(registerCard) {
    if (isLoadingMore) return; // guard against a double-trigger while a fetch is already in flight
    if (totalAvailable !== null && loadedCount >= totalAvailable) return; // genuinely out of records

    isLoadingMore = true;
    try {
        const { samples } = await fetchSamplesPage(loadedCount);
        const feed = document.getElementById("feed");
        const sentinel = document.getElementById("load-more-sentinel");

        samples.forEach(({ record_id, label }) => {
            const card = buildCardElement(record_id, label);
            feed.insertBefore(card, sentinel); // new cards go BEFORE the sentinel, so it stays last
            registerCard(card);
        });
        loadedCount += samples.length;
    } catch (err) {
        console.error("Failed to load more samples:", err);
    } finally {
        isLoadingMore = false;
    }
}

function initFeed() {
    // controllers and cardObserver both live in this closure, but are
    // reachable via registerCard -- so loadMoreCards() can add NEW cards
    // into the exact same visibility system as the original batch, rather
    // than those cards being invisible to the observer entirely.
    const controllers = new Map();

    const cardObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const controller = controllers.get(entry.target);
            if (!controller) return;
            if (entry.isIntersecting) {
                controller.activate(); // always starts fresh at stage 0 -- see enterStage()
                currentlyVisibleController = controller;
                onCardEntered(entry.target);
            } else {
                clearAutoAdvance(controller.sampleId);
                cancelSweepAnimation(controller.sampleId); // stop the rAF loop -- nothing needs to resume it anymore
            }
        });
    }, { threshold: 0.6 });

    function registerCard(cardEl) {
        const controller = initCard(cardEl);
        controllers.set(cardEl, controller);
        cardObserver.observe(cardEl);
    }

    Array.from(document.querySelectorAll(".card")).forEach(registerCard);

    // Sentinel: a thin, invisible element kept as the LAST child of #feed.
    // When it scrolls into view, we're near the bottom -- time to fetch the
    // next page. Reusing IntersectionObserver here rather than a manual
    // scroll-position calculation keeps this consistent with how the rest
    // of the feed already detects visibility.
    const sentinel = document.createElement("div");
    sentinel.id = "load-more-sentinel";
    sentinel.style.height = "1px";
    document.getElementById("feed").appendChild(sentinel);

    const sentinelObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            loadMoreCards(registerCard);
        }
    }, { threshold: 0.01 }); // trivial threshold -- sentinel is 1px tall, any visibility at all counts

    sentinelObserver.observe(sentinel);
}

const seenThisSession = new Set();

function onCardEntered(cardEl) {
    const sampleId = cardEl.dataset.sampleId;
    if (seenThisSession.has(sampleId)) return;
    seenThisSession.add(sampleId);
    cardsViewedThisSession++;
    if (cardsViewedThisSession % SESSION_SUMMARY_EVERY === 0) {
        showSessionSummary();
    }
}

function showSessionSummary() {
    const overlay = document.getElementById("session-summary");
    document.getElementById("summary-count").textContent = cardsViewedThisSession;
    overlay.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", async () => {
    // set these FIRST, before any chart can render, so nothing ever
    // briefly shows the CSS file's hardcoded defaults before JS catches up.
    // Both bg and trace color now come from the SAME merged theme entry --
    // they're one atomic choice, not two independently-defaulted ones.
    // Done regardless of onboarding, so the onboarding overlay ITSELF
    // renders against the correct theme too, not a flash of wrong colors.
    const defaultTheme = THEMES[themeIndex];
    document.documentElement.style.setProperty("--bg", defaultTheme.bg);
    document.documentElement.style.setProperty("--card-bg", defaultTheme.cardBg);
    document.documentElement.style.setProperty("--ecg-trace-color", defaultTheme.traceColor);
    document.documentElement.style.setProperty("--grid-color", defaultTheme.gridColor);
    document.documentElement.style.setProperty("--zero-line-color", defaultTheme.zeroLineColor);

    async function startFeed() {
        await loadFeedCards(); // build real cards first...
        initFeed();             // ...then wire up stage machinery + scroll watching

        const dismissBtn = document.getElementById("summary-dismiss");
        if (dismissBtn) {
            dismissBtn.addEventListener("click", () => {
                document.getElementById("session-summary").classList.add("hidden");
            });
        }

        // ------------------------------------------------------------------
        // Rail controls -- ONE delegated listener on #feed, rather than
        // wiring buttons x N cards individually. Matters once pagination
        // adds many more cards later; this scales regardless of card count.
        // ------------------------------------------------------------------
        document.getElementById("feed").addEventListener("click", (e) => {
            const speedBtn = e.target.closest(".rail-speed");
            const invertBtn = e.target.closest(".rail-invert");
            const themeBtn = e.target.closest(".rail-theme");
            const algoBtn = e.target.closest(".rail-algo");
            if (!speedBtn && !invertBtn && !themeBtn && !algoBtn) return;

            e.stopPropagation(); // don't let this also trigger stage tap-navigation
            const cardEl = e.target.closest(".card");
            const sampleId = cardEl?.dataset.sampleId;

            if (speedBtn) cycleSpeedMode();
            if (invertBtn && sampleId) toggleInvert(sampleId);
            if (themeBtn) cycleTheme();
            if (algoBtn) cyclePeakDetector();
        });
    }

    // Onboarding is optional -- if onboarding.js isn't loaded, or the
    // visitor has already seen it, the feed just starts immediately, same
    // as before onboarding existed at all.
    const shouldShowOnboarding = typeof hasSeenOnboarding === "function" && !hasSeenOnboarding();
    if (shouldShowOnboarding) {
        showOnboarding(startFeed); // feed only starts once onboarding finishes or is skipped
    } else {
        startFeed();
    }
});
