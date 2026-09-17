// ---------------------------------------------------------------------------
// journey_scroll_feed.js
// Scrolling feed -- builds one card per sample, lazy-starts interpretJourney
// when a card enters the viewport, cancels sweep when it leaves.
// Velocity scroll: touch + rAF + spring easing replaces CSS scroll-snap.
// ---------------------------------------------------------------------------

const DEFAULT_LAYOUT = {
    title: "top", caption: "top", description: "top",
    plot: "center", railControls: "bottom",
};

async function startJourneyScrollFeed({ apiEndpoint, journeyJson, shortsBatch, feedContainer }) {

    const PAGE_SIZE = 10;
    let loadedCount    = 0;
    let totalAvailable = null;
    let isLoadingMore  = false;

    // Analytics is optional. event_collector.js loads before this file,
    // but if it ever fails to load these calls would throw and take the
    // whole feed down on the first card -- losing the feed to save the
    // telemetry. No-op fallbacks keep the call sites clean and make the
    // dependency genuinely optional.
    const track      = (typeof trackEvent === "function")
                       ? trackEvent : () => {};
    const regMeta    = (typeof registerSampleMeta === "function")
                       ? registerSampleMeta : () => {};

    const activeJourneys = new Map();
    const cardElements   = new Map();
    // sampleId -> card index (position in the feed). Drives which
    // pattern entry, and therefore which recipe, the card uses.
    const cardIndexMap   = new Map();
    let   nextCardIndex  = 0;

    // ── Batch recipe support ──────────────────────────────────────────────
    // shortsBatch (from /shorts or /feed) has the shape:
    //   { recipes: {ecg: {...}, dwt: {...}}, pattern: [{journey:"ecg"}, ...] }
    //
    // Recipes are shipped ONCE and referenced by name. The pattern is the
    // play order and repeats: card N uses pattern[N % pattern.length].
    // A recipe holds no data -- the same "ecg" recipe drives many cards,
    // each against a different sampleId resolved at view time.
    //
    // null in single-journey mode (/journey/<name>), where every card
    // shares journeyJson.
    const batchRecipes = shortsBatch?.recipes ?? null;
    const batchPattern = shortsBatch?.pattern ?? null;

    function getPatternEntry(cardIndex) {
        if (!batchPattern || batchPattern.length === 0) return null;
        return batchPattern[cardIndex % batchPattern.length];
    }

    function getRecipeForCard(cardIndex) {
        const entry = getPatternEntry(cardIndex);
        if (!entry) return journeyJson;          // single-journey mode
        const recipe = batchRecipes[entry.journey];
        if (!recipe) {
            console.error(`[FEED] pattern references journey "${entry.journey}" `
                + `but it is not in recipes [${Object.keys(batchRecipes).join(", ")}]. `
                + `Falling back to journeyJson.`);
            return journeyJson;
        }
        return recipe;
    }

    // Journey name per card -- for analytics (Sprint 3) and the dev HUD.
    function getJourneyNameForCard(cardIndex) {
        return getPatternEntry(cardIndex)?.journey ?? "single";
    }

    // ── Pagination fetch ──────────────────────────────────────────────────
    async function fetchSamplesPage(offset) {
        const res  = await fetch(`${apiEndpoint}?limit=${PAGE_SIZE}&offset=${offset}`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        const samples = data.samples ?? data.data ?? data.records ?? [];
        const total   = data.total   ?? data.count ?? data.totalCount ?? null;
        if (!Array.isArray(samples)) {
            console.error("fetchSamplesPage: unexpected response shape", data);
            return { samples: [], total: null };
        }
        return { samples, total };
    }

    // ── Card builder ──────────────────────────────────────────────────────
    function buildCard(sampleId, cardIndex) {
        const recipe = getRecipeForCard(cardIndex);
        const layout = { ...DEFAULT_LAYOUT, ...(recipe.layout || {}) };

        const card = document.createElement("section");
        card.className    = "journey-card";
        card.dataset.sampleId = sampleId;
        card.innerHTML = `
            <div class="stage-bar"></div>
            <div class="layout-zone" data-zone="top"></div>
            <div class="layout-zone" data-zone="center"></div>
            <div class="layout-zone" data-zone="bottom"></div>
            <div class="stage-rail"></div>
        `;

        const titleEl = document.createElement("h2");
        titleEl.className   = "stage-title";
        titleEl.textContent = "Loading...";

        // Tapping the title reveals caption + description; tapping again
        // hides them. The class goes on the ZONE rather than on either
        // text element, because both appear together and the zone is what
        // grows -- CSS then animates one max-height instead of two.
        //
        // stopPropagation matters: the card's own click handler treats a
        // left tap as restart and a right tap as next-stage, so without it
        // opening the text would also skip the stage.
        titleEl.addEventListener("click", (e) => {
            e.stopPropagation();
            // Toggle the zone the title is in, whichever that is. Every
            // current recipe puts title/caption/description in "bottom",
            // but layout is recipe-controlled and could split them -- so
            // toggle both the title's own zone and the caption's, rather
            // than assuming they are the same element.
            const zones = new Set([
                titleEl.closest(".layout-zone"),
                captionEl.closest(".layout-zone"),
                descriptionEl.closest(".layout-zone"),
            ].filter(Boolean));
            const opening = !titleEl.closest(".layout-zone")
                                    ?.classList.contains("text-expanded");
            zones.forEach(z => z.classList.toggle("text-expanded", opening));
        });

        const captionEl = document.createElement("p");
        captionEl.className = "stage-caption";

        const descriptionEl = document.createElement("p");
        descriptionEl.className = "stage-description";

        const chartEl = document.createElement("div");
        chartEl.className = "chart";

        [[titleEl, layout.title], [captionEl, layout.caption],
         [descriptionEl, layout.description], [chartEl, layout.plot]
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

        const CENTER_ZONE_FRACTION  = 0.34;
        const DOUBLE_TAP_THRESHOLD_MS = 350;
        let lastLeftTapTime = 0;

        card.addEventListener("click", (e) => {
            if (e.target.closest(".stage-rail")) return;
            const cardRect = card.getBoundingClientRect();
            if (e.clientX > cardRect.right - 80) return;
            const journey = activeJourneys.get(sampleId);
            if (!journey) return;
            const relativeX   = (e.clientX - cardRect.left) / cardRect.width;
            const centerStart = 0.5 - CENTER_ZONE_FRACTION / 2;
            const centerEnd   = 0.5 + CENTER_ZONE_FRACTION / 2;
            if (relativeX >= centerStart && relativeX <= centerEnd) {
                journey.togglePause();
                track("paused", sampleId);
            } else if (relativeX > centerEnd) {
                journey.next();
            } else {
                const now = Date.now();
                if (now - lastLeftTapTime < DOUBLE_TAP_THRESHOLD_MS) {
                    journey.prev();
                } else {
                    journey.restart();
                    track("restarted", sampleId);
                }
                lastLeftTapTime = now;
            }
        });

        return card;
    }

    // ── Fetch and build initial cards ─────────────────────────────────────
    async function loadFeedCards() {
        try {
            const { samples, total } = await fetchSamplesPage(0);
            totalAvailable = total;

            if (samples.length === 0) {
                feedContainer.innerHTML = '<p style="color:#747d8c;text-align:center;margin-top:40vh;">No records found.</p>';
                return;
            }

            samples.forEach(({ record_id, label }) => {
                const card = buildCard(record_id, nextCardIndex);
                cardIndexMap.set(record_id, nextCardIndex);
                // label ("N"|"A"|"O"|"~") comes from the samples API and
                // was previously discarded. The recommender needs it to
                // sequence for contrast, so register it for analytics.
                regMeta(record_id, {
                    label,
                    journeyName: getJourneyNameForCard(nextCardIndex),
                    cardIndex:   nextCardIndex,
                });
                nextCardIndex++;
                feedContainer.appendChild(card);
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
            samples.forEach(({ record_id, label }) => {
                const card = buildCard(record_id, nextCardIndex);
                cardIndexMap.set(record_id, nextCardIndex);
                regMeta(record_id, {
                    label,
                    journeyName: getJourneyNameForCard(nextCardIndex),
                    cardIndex:   nextCardIndex,
                });
                nextCardIndex++;
                feedContainer.insertBefore(card, sentinel);
                // CRITICAL: without this the card exists in the DOM but
                // nothing watches it, so interpretJourney() never runs and
                // it renders as a permanently blank card. cardObserver is
                // declared below but is always defined by the time this
                // function is first called.
                cardObserver.observe(card);
            });
            loadedCount += samples.length;
        } catch (err) {
            console.error("Failed to load more samples:", err);
        } finally {
            isLoadingMore = false;
        }
    }

    // ── Sentinel (pagination trigger) ─────────────────────────────────────
    await loadFeedCards();

    // ── Pagination trigger ────────────────────────────────────────────────
    // The sentinel is ONLY an insertion anchor -- new cards are inserted
    // before it so they land after the existing ones. It is deliberately
    // NOT observed for visibility.
    //
    // WHY NOT: under `scroll-snap-type: y mandatory` every card is a snap
    // point, but a 1px sentinel is not. The scroll position can never
    // come to rest where the sentinel is visible -- the snap engine pulls
    // back to the last card. An IntersectionObserver on it therefore
    // never fires, and the feed silently stopped at PAGE_SIZE cards.
    //
    // Instead pagination is driven by CARD visibility, which scroll-snap
    // guarantees: once a card within PRELOAD_MARGIN of the end comes into
    // view, fetch the next page.
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "height:1px;flex-shrink:0;";
    feedContainer.appendChild(sentinel);

    const PRELOAD_MARGIN = 3;   // begin loading 3 cards before the end

    function maybeLoadMore(sampleId) {
        const cardIdx = cardIndexMap.get(sampleId);
        if (cardIdx === undefined) return;
        if (cardIdx >= loadedCount - PRELOAD_MARGIN) {
            loadMoreCards(sentinel);
        }
    }

    // ── Card observer (CSS scroll-snap) ───────────────────────────────────
    const cardObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const sampleId = entry.target.dataset.sampleId;
            if (!sampleId) return;

            if (entry.isIntersecting) {
                if (!activeJourneys.has(sampleId)) {
                    const els    = cardElements.get(sampleId);
                    if (!els) return;
                    const cardIdx = cardIndexMap.get(sampleId) ?? 0;
                    const recipe  = getRecipeForCard(cardIdx);
                    const journey = interpretJourney(
                        recipe, sampleId,
                        els.chartEl, els.railEl, els.titleEl,
                        els.captionEl, els.progressBarEl, els.descriptionEl
                    );
                    activeJourneys.set(sampleId, journey);
                    journey.start();
                }
                track("card_entered", sampleId);
                // Card is on screen -- are we near the end of what's loaded?
                maybeLoadMore(sampleId);
            } else {
                const control = activeSweepControl.get(sampleId);
                track("card_exited", sampleId, {
                    elapsed_ms: control ? Math.round(control.lastElapsedMs) : null,
                });
                cancelSweepAnimation(sampleId);
            }
        });
    }, {
        root:      feedContainer,
        threshold: 0.5,
    });

    feedContainer.querySelectorAll(".journey-card").forEach(card => {
        cardObserver.observe(card);
    });

    // Scroll backup -- IntersectionObserver with a DOM root can stop
    // firing after several scroll cycles on Android Chrome
    // (crbug.com/840590). This catches pagination the observer misses.
    // Uses scrollHeight/scrollTop, which stay accurate under scroll-snap
    // (unlike sentinel visibility, see the note above).
    let scrollThrottle = null;
    feedContainer.addEventListener("scroll", () => {
        if (scrollThrottle) return;
        scrollThrottle = setTimeout(() => {
            scrollThrottle = null;
            const distanceFromBottom = feedContainer.scrollHeight
                - feedContainer.scrollTop
                - feedContainer.clientHeight;
            if (distanceFromBottom < window.innerHeight * PRELOAD_MARGIN) {
                loadMoreCards(sentinel);
            }
        }, 200);
    }, { passive: true });
}