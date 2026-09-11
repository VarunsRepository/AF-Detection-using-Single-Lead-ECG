// ---------------------------------------------------------------------------
// journey_scroll_feed.js
// The real scrolling feed for the NEW dispatcher/registry/interpreter
// system -- distinct from core/journey_feed.js, which drives the OLDER
// registerStage-based pipeline still used by shorts_feed.html/dwt_journey.html.
// This one builds one card per real sample, calls interpretJourney() per
// card (lazy-started only when it scrolls into view), and cancels
// animations for cards that scroll out of view.
//
// Each card gets its OWN title/caption/chart/rail elements, scoped via
// class selectors WITHIN that card -- not global IDs, which would collide
// the instant more than one card exists on screen (the exact bug
// interpretJourney()'s title/caption parameters were just fixed to avoid).
//
// Depends on core/journey_interpreter.js (interpretJourney) and
// core/shared_signal_utils.js (cancelSweepAnimation) -- both must load
// before this file.
// ---------------------------------------------------------------------------

// Matches the CURRENT, existing layout exactly -- if a recipe has no
// "layout" field at all, behavior is byte-for-byte identical to before
// this feature existed. Only recipes that EXPLICITLY set "layout" get
// anything different.
const DEFAULT_LAYOUT = {
    title: "top",
    caption: "top",
    description: "top",
    plot: "center",
    railControls: "bottom",
};

async function startJourneyScrollFeed({ apiEndpoint, journeyJson, feedContainer }) {
    const PAGE_SIZE = 10; // was 5 -- with only 5 cards the sentinel becomes visible too quickly, tightening the window before pagination fires
    let loadedCount = 0;
    let totalAvailable = null;
    let isLoadingMore = false;

    const activeJourneys = new Map();
    const cardElements = new Map();

    async function fetchSamplesPage(offset) {
        const res = await fetch(`${apiEndpoint}?limit=${PAGE_SIZE}&offset=${offset}`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();

        // Normalise API response shape -- guard against shape mismatches
        // that would cause samples.forEach to throw and leave isLoadingMore
        // stuck as true, silently blocking all future pagination.
        const samples = data.samples ?? data.data ?? data.records ?? [];
        const total   = data.total   ?? data.count ?? data.totalCount ?? null;

        if (!Array.isArray(samples)) {
            console.error("fetchSamplesPage: unexpected response shape", data);
            return { samples: [], total: null };
        }

        return { samples, total };
    }

    function buildCard(sampleId) {
        const layout = { ...DEFAULT_LAYOUT, ...(journeyJson.layout || {}) };

        const card = document.createElement("section");
        card.className = "journey-card";
        card.dataset.sampleId = sampleId;
        card.innerHTML = `
            <div class="stage-bar"></div>
            <div class="layout-zone" data-zone="top"></div>
            <div class="layout-zone" data-zone="center"></div>
            <div class="layout-zone" data-zone="bottom"></div>
            <div class="stage-rail"></div>
        `;

        // Content elements created standalone, THEN placed into whichever
        // zone the layout config names -- journey_interpreter.js never
        // needs to know or care where any of these physically ended up,
        // it just receives references to them, same as before.
        const titleEl = document.createElement("h2");
        titleEl.className = "stage-title";
        titleEl.textContent = "Loading...";

        const captionEl = document.createElement("p");
        captionEl.className = "stage-caption";

        const descriptionEl = document.createElement("p");
        descriptionEl.className = "stage-description";
        // Tap description to expand/collapse -- stopPropagation prevents
        // the card tap zone from treating this as a navigation gesture
        descriptionEl.addEventListener("click", (e) => {
            e.stopPropagation();
            descriptionEl.classList.toggle("expanded");
        });

        const chartEl = document.createElement("div");
        chartEl.className = "chart";

        // Fixed relative order within any zone that ends up sharing
        // multiple elements -- avoids ambiguity about which stacks above
        // which.
        [
            [titleEl, layout.title],
            [captionEl, layout.caption],
            [descriptionEl, layout.description],
            [chartEl, layout.plot],
        ].forEach(([el, zone]) => {
            const zoneEl = card.querySelector(`.layout-zone[data-zone="${zone}"]`);
            (zoneEl || card.querySelector('.layout-zone[data-zone="top"]')).appendChild(el);
        });

        const railEl = card.querySelector(".stage-rail");
        railEl.dataset.zone = layout.railControls;

        cardElements.set(sampleId, {
            titleEl, captionEl, descriptionEl, chartEl, railEl,
            progressBarEl: card.querySelector(".stage-bar"),
        });

        // Tap zones -- left third = restart-current-or-previous (see
        // below), right third = next, CENTER third = pause/resume.
        // Scoped to the WHOLE CARD, not just .chart -- tapping the
        // title/caption/description areas, or any empty space, should
        // navigate too, matching how Shorts/Reels make the entire screen
        // tappable. This means .stage-rail is a DESCENDANT of this
        // listener, so an explicit guard is needed: without it, tapping
        // a rail button would ALSO trigger navigation underneath it.
        // DWT's toggle buttons still work correctly via their own
        // existing stopPropagation() (rendering_registry.js) -- that
        // protection doesn't depend on where THIS listener is attached.
        const CENTER_ZONE_FRACTION = 0.34; // matches the main app's own tap-zone convention

        // Restart-vs-previous: matches Instagram Stories/TikTok's own
        // left-tap behavior. First left tap replays the CURRENT stage;
        // a second left tap, fast enough, actually goes to the previous
        // one. 350ms sits centered in the standard 300-500ms double-tap
        // detection window used across iOS/Android/desktop conventions --
        // grounded in typical human motor-response timing for
        // distinguishing an intentional rapid double-tap from two
        // separate, deliberate single taps.
        //
        // one instance per card, so each card's double-tap timing is
        // naturally independent of the others, not shared/confused
        // across different samples.
        const DOUBLE_TAP_THRESHOLD_MS = 350;
        let lastLeftTapTime = 0;

        card.addEventListener("click", (e) => {
            // Guard 1: click landed directly on a rail element (button, SVG, path)
            if (e.target.closest(".stage-rail")) return;

            // Guard 2: click landed in the rightmost 80px of the card --
            // the visual rail zone. Catches near-misses where the finger
            // touches the card AROUND a button rather than the button
            // itself. Without this, a slightly-off tap in the right-hand
            // 20% of the card triggers journey.next() instead of being
            // silently ignored. 80px covers the rail's right:12px position
            // + 46px button width + comfortable touch margin.
            const cardRect = card.getBoundingClientRect();
            if (e.clientX > cardRect.right - 80) return;
            const journey = activeJourneys.get(sampleId);
            if (!journey) return;
            const rect = card.getBoundingClientRect();
            const relativeX = (e.clientX - rect.left) / rect.width;
            const centerStart = 0.5 - CENTER_ZONE_FRACTION / 2;
            const centerEnd = 0.5 + CENTER_ZONE_FRACTION / 2;

            if (relativeX >= centerStart && relativeX <= centerEnd) {
                journey.togglePause();
            } else if (relativeX > centerEnd) {
                journey.next();
            } else {
                const now = Date.now();
                if (now - lastLeftTapTime < DOUBLE_TAP_THRESHOLD_MS) {
                    journey.prev(); // fast second tap -- genuinely go back
                } else {
                    journey.restart(); // first tap (or a slow, separate one) -- just replay the current stage
                }
                lastLeftTapTime = now;
            }
        });

        return card;
    }

    const cardObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const sampleId = entry.target.dataset.sampleId;
            if (!sampleId) return;

            if (entry.isIntersecting) {
                if (!activeJourneys.has(sampleId)) {
                    const els = cardElements.get(sampleId);
                    if (!els) return;
                    const journey = interpretJourney(journeyJson, sampleId, els.chartEl, els.railEl, els.titleEl, els.captionEl, els.progressBarEl, els.descriptionEl);
                    activeJourneys.set(sampleId, journey);
                    journey.start();
                }
            } else {
                cancelSweepAnimation(sampleId);
            }
        });
    }, {
        // root: feedContainer is CRITICAL for Android Chrome.
        // Without it, IntersectionObserver defaults to the viewport as root.
        // When the scroll container is a DOM element (not window), Android
        // Chrome's observer fires unreliably -- iOS Safari works fine without
        // root but Android doesn't. Explicit root = the actual scroll container
        // fixes observation against the correct coordinate space.
        root: feedContainer,
        threshold: 0.1,
    });

    async function loadFeedCards() {
        try {
            const { samples, total } = await fetchSamplesPage(0);
            totalAvailable = total;

            if (samples.length === 0) {
                feedContainer.innerHTML = '<p style="color:#747d8c;text-align:center;margin-top:40vh;">No records found.</p>';
                return;
            }

            samples.forEach(({ record_id }) => {
                const card = buildCard(record_id);
                feedContainer.appendChild(card);
                cardObserver.observe(card);
            });
            loadedCount = samples.length;
        } catch (err) {
            console.error("Failed to load sample list:", err);
            feedContainer.innerHTML = '<p style="color:#a32638;text-align:center;margin-top:40vh;">Could not load records.</p>';
        }
    }

    async function loadMoreCards(sentinel) {
        if (isLoadingMore) return;
        if (totalAvailable !== null && loadedCount >= totalAvailable) return;

        isLoadingMore = true;
        try {
            const { samples } = await fetchSamplesPage(loadedCount);
            samples.forEach(({ record_id }) => {
                const card = buildCard(record_id);
                feedContainer.insertBefore(card, sentinel);
                cardObserver.observe(card);
            });
            loadedCount += samples.length;
        } catch (err) {
            console.error("Failed to load more samples:", err);
        } finally {
            isLoadingMore = false;
        }
    }

    await loadFeedCards();

    // Sentinel -- triggers pagination when the user nears the end.
    // scroll-snap-align: none is CRITICAL: without it, scroll-snap-type:y
    // mandatory treats the sentinel as a potential snap target. Since it's
    // 1px with no snap alignment defined, the snap engine can refuse to
    // scroll past the last real card, making the feed appear stuck even
    // though more cards exist. Explicit none opts it out of snap entirely.
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "height:1px; scroll-snap-align:none; flex-shrink:0;";
    feedContainer.appendChild(sentinel);

    const sentinelObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            loadMoreCards(sentinel).then(() => {
                sentinelObserver.unobserve(sentinel);
                sentinelObserver.observe(sentinel);
            });
        }
    }, {
        root: feedContainer,  // same fix as cardObserver -- must match scroll container
        threshold: 0.01,
        // Note: rootMargin is NOT used here -- it is ignored by many Android
        // Chrome versions when root is a DOM element (not viewport).
        // The scroll event backup below handles early-trigger instead.
    });
    sentinelObserver.observe(sentinel);

    // ── Scroll event backup (Android reliability) ─────────────────────────
    // IntersectionObserver with a DOM root can silently stop firing on
    // Android Chrome after a few scroll cycles -- a known Chromium bug
    // (crbug.com/840590). A scroll listener as a backup catches cases
    // the observer misses. Throttled to once per 200ms to avoid cost.
    let scrollThrottleTimer = null;
    feedContainer.addEventListener("scroll", () => {
        if (scrollThrottleTimer) return;
        scrollThrottleTimer = setTimeout(() => {
            scrollThrottleTimer = null;
            // Check if user is within 2 card-heights of the bottom
            const distanceFromBottom = feedContainer.scrollHeight
                - feedContainer.scrollTop
                - feedContainer.clientHeight;
            if (distanceFromBottom < window.innerHeight * 2) {
                loadMoreCards(sentinel);
            }
        }, 200);
    }, { passive: true });
}