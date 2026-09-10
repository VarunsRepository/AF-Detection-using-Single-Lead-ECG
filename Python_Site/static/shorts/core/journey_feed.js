// ---------------------------------------------------------------------------
// journey_feed.js
// The GENERIC feed engine: builds cards from real backend data, paginates
// as the user scrolls, wires each card into the shared visibility
// observer, and handles session-level bookkeeping (the "nice session"
// summary). Parameterized by journeyName + apiEndpoint -- this file has
// ZERO knowledge of "ecg" specifically, unlike its predecessor which had
// all of this logic hardcoded inline in shorts_feed.js.
//
// Every function that needs journeyName/apiEndpoint is defined AS A
// CLOSURE inside startJourneyFeed(), rather than taking them as a
// parameter threaded through every call. This also means all pagination/
// session state (loadedCount, totalAvailable, cardsViewedThisSession,
// etc) is genuinely PER-INVOCATION now, not module-level -- two journey
// feeds on the same page (not a current need, but no longer structurally
// impossible either) couldn't corrupt each other's state the way shared
// module-level variables would have.
//
// shorts_feed.js becomes a tiny ECG-specific bootstrap that just calls
// startJourneyFeed({journeyName: "ecg", apiEndpoint: "/shorts/api/samples"})
// -- this file itself never auto-starts anything, so a different page
// (e.g. a future DWT journey) can load it purely to reuse the engine,
// without also accidentally triggering the ECG feed.
//
// Depends on stage_engine.js (getRegisteredStageCount, getStageLabel),
// rail_controls.js (SPEED_MODES, invertedSamples, THEMES), core registries
// (getSelectedDetector, getSelectedPreFilter -- both optional, checked via
// typeof), stage_machine.js (initCard, clearAutoAdvance,
// currentlyVisibleController), shared_signal_utils.js (cancelSweepAnimation)
// -- all must be loaded before this file, which itself loads before any
// journey-specific bootstrap that calls startJourneyFeed().
// ---------------------------------------------------------------------------

// journeyName + apiEndpoint: the only two things that make one journey's
// feed different from another's. Everything else below is genuinely
// shared mechanics.
async function startJourneyFeed({ journeyName, apiEndpoint }) {
    const PAGE_SIZE = 10;
    let loadedCount = 0;
    let totalAvailable = null;
    let isLoadingMore = false;

    // Each sample's TRUE class label, keyed by sampleId -- populated when
    // each card is built, from whatever the backend already sent. Kept as
    // a plain lookup map, not something a processor reads off the DOM.
    const sampleLabels = new Map();

    const SESSION_SUMMARY_EVERY = 10;
    let cardsViewedThisSession = 0;
    const seenThisSession = new Set();

    function buildCardElement(sampleId, label, stageCount = (typeof getRegisteredStageCount === "function" ? getRegisteredStageCount(journeyName) : 5)) {
        sampleLabels.set(sampleId, label);

        const card = document.createElement("section");
        card.className = "card";
        card.dataset.sampleId = sampleId;
        card.dataset.journey = journeyName; // read by stage_machine.js's initCard() to route every engine call correctly
        card.dataset.trueLabel = label ?? "";

        const pauseIndicator = document.createElement("div");
        pauseIndicator.className = "pause-indicator";
        pauseIndicator.innerHTML = "&#10074;&#10074;";

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

            const stageLabel = (typeof getStageLabel === "function" && getStageLabel(journeyName, i)) || { main: `Stage ${i}`, small: "" };

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

        // Right-side control rail. Speed/Invert/Theme are meaningful for
        // ANY journey operating on this kind of raw signal data -- Invert
        // (flip polarity) and Speed (playback pace) aren't ECG-specific
        // concepts, they're properties of the sweep-animation mechanism
        // itself. Algo/Pre-Filter stay correctly hidden for any journey
        // whose stages never declare them in railControls (see
        // stage_machine.js) -- so this SAME markup is safe to reuse
        // as-is, rather than needing its own per-journey variant.
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
            <button class="rail-btn rail-prefilter" data-role="prefilter" title="Signal pre-filter">
                <span class="rail-prefilter-label">${(typeof getSelectedPreFilter === "function" ? getSelectedPreFilter().label : "BC")}</span>
            </button>
        `;

        card.appendChild(bar);
        card.appendChild(viewport);
        card.appendChild(footer);
        card.appendChild(rail);
        card.appendChild(pauseIndicator);
        return card;
    }

    async function fetchSamplesPage(offset) {
        const res = await fetch(`${apiEndpoint}?limit=${PAGE_SIZE}&offset=${offset}`);
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

    async function loadMoreCards(registerCard) {
        if (isLoadingMore) return;
        if (totalAvailable !== null && loadedCount >= totalAvailable) return;

        isLoadingMore = true;
        try {
            const { samples } = await fetchSamplesPage(loadedCount);
            const feed = document.getElementById("feed");
            const sentinel = document.getElementById("load-more-sentinel");

            samples.forEach(({ record_id, label }) => {
                const card = buildCardElement(record_id, label);
                feed.insertBefore(card, sentinel);
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
        const controllers = new Map();

        const cardObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const controller = controllers.get(entry.target);
                if (!controller) return;
                if (entry.isIntersecting) {
                    controller.activate();
                    currentlyVisibleController = controller;
                    onCardEntered(entry.target);
                } else {
                    clearAutoAdvance(controller.sampleId);
                    cancelSweepAnimation(controller.sampleId);
                }
            });
        }, { threshold: 0.6 });

        function registerCard(cardEl) {
            const controller = initCard(cardEl);
            controllers.set(cardEl, controller);
            cardObserver.observe(cardEl);
        }

        Array.from(document.querySelectorAll(".card")).forEach(registerCard);

        const sentinel = document.createElement("div");
        sentinel.id = "load-more-sentinel";
        sentinel.style.height = "1px";
        document.getElementById("feed").appendChild(sentinel);

        const sentinelObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                loadMoreCards(registerCard);
            }
        }, { threshold: 0.01 });

        sentinelObserver.observe(sentinel);
    }

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

    await loadFeedCards();
    initFeed();

    const dismissBtn = document.getElementById("summary-dismiss");
    if (dismissBtn) {
        dismissBtn.addEventListener("click", () => {
            document.getElementById("session-summary").classList.add("hidden");
        });
    }

    // Rail controls -- ONE delegated listener on #feed. Mechanically
    // generic: harmless to listen for "rail-algo"/"rail-prefilter" clicks
    // even on a journey whose cards never show those buttons (nothing to
    // find, nothing fires).
    document.getElementById("feed").addEventListener("click", (e) => {
        const speedBtn = e.target.closest(".rail-speed");
        const invertBtn = e.target.closest(".rail-invert");
        const themeBtn = e.target.closest(".rail-theme");
        const algoBtn = e.target.closest(".rail-algo");
        const prefilterBtn = e.target.closest(".rail-prefilter");
        if (!speedBtn && !invertBtn && !themeBtn && !algoBtn && !prefilterBtn) return;

        e.stopPropagation();
        const cardEl = e.target.closest(".card");
        const sampleId = cardEl?.dataset.sampleId;

        if (speedBtn) cycleSpeedMode();
        if (invertBtn && sampleId) toggleInvert(sampleId);
        if (themeBtn) cycleTheme();
        if (algoBtn) cyclePeakDetector();
        if (prefilterBtn) cyclePreFilter();
    });
}
