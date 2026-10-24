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

async function startJourneyScrollFeed({ apiEndpoint, journeyJson, shortsBatch,
                                        feedContainer, startSample = null }) {

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
    // sampleId -> the stop() for that card's gesture hints. Held so a
    // hint can never outlive the card it belongs to: without this a
    // pending hint fires after the viewer has scrolled on and draws a
    // ring around a control on a DIFFERENT short.
    const hintStops      = new Map();
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

    // ── "More from" chip ───────────────────────────────────────────────
    // Curated feeds only, and it is the one rung of the ladder:
    //
    //   /seed        one card per domain   chip -> /tour/<domain>
    //   /tour/ecg    one card per journey  chip -> /journey/<name>?sample=
    //   /journey/ecg every record          no chip: already the long version
    //
    // Always the same question -- more of this? -- so the viewer never
    // learns there is a hierarchy; they just keep finding more when they
    // want more. Which rung a card is on comes from the stop (see `tour`
    // in catalog/tours.py), never from guessing here.
    //
    // ?sample= carries the current recording ACROSS on the journey hop,
    // so the tap lands on the card just watched and the rest of the feed
    // continues underneath it. That parameter already exists and is
    // validated server-side (see the shared-link block in journey_bp.py),
    // so a stale id degrades to an ordinary feed rather than to a card
    // that sits there failing to fetch.
    //
    // MUST LIVE INSIDE startJourneyScrollFeed. It reads isCurated,
    // getPatternEntry, getRecipeForCard and track -- all four are locals
    // of this function, so at module scope the first line throws
    // ReferenceError and the feed renders nothing at all.
    //
    // isCurated is a const declared further down, but this only READS it
    // when called -- and every call happens inside loadFeedCards(), which
    // is awaited after that declaration. Same reasoning as cardObserver.
    function buildMoreChip(sampleId, cardIndex) {
        if (!isCurated) return null;
        const entry = getPatternEntry(cardIndex);
        if (!entry?.journey) return null;

        // TWO LEVELS, ONE CHIP. A stop that names a `tour` is a stop on
        // the master tour, and its card stands for a whole domain -- so
        // the chip leads to that domain's tour, not straight into one
        // journey's 8,528 records. Everywhere else it leads to the
        // journey, carrying the sample across.
        //
        // No ?sample= on the tour hop, deliberately: a tour picks its own
        // stops, and the one it opens with is already this same recording
        // (both draw cursor 0 of the same lister). Passing it would be a
        // parameter /tour/ does not read.
        const toTour = Boolean(entry.tour);
        const label  = toTour
            ? (entry.label || entry.tour)
            : (getRecipeForCard(cardIndex)?.label || entry.journey);

        const a = document.createElement("a");
        a.className   = "more-from";
        a.href        = toTour
            ? `/tour/${encodeURIComponent(entry.tour)}`
            : `/journey/${encodeURIComponent(entry.journey)}`
              + `?sample=${encodeURIComponent(sampleId)}`;
        a.textContent = `More from ${label}`;

        // The card's own click handler reads tap POSITION -- left third
        // restarts, right third advances a stage. Without stopPropagation
        // the chip would navigate AND skip a stage on the way out. The
        // title element already does exactly this, for the same reason.
        a.addEventListener("click", (e) => {
            e.stopPropagation();
            // One event for both hops, distinguished by which field is
            // set. to_tour from the front door is the answer to "which
            // domain do people actually want?" -- nothing else in the app
            // answers it, because until now every session began in the
            // same mixed feed and every signal was confounded.
            track("journey_opened", sampleId, toTour
                ? { to_tour: entry.tour }
                : { to_journey: entry.journey });
        });
        return a;
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



//Code to add curarted cards of a kind of a journey 
                // Sits in whichever zone holds the title, so it lands under the
        // title the way YouTube's does -- without assuming that zone is
        // "bottom", since layout is recipe-controlled.
        const moreChip = buildMoreChip(sampleId, cardIndex);
        if (moreChip) {
            (titleEl.closest(".layout-zone")
             || card.querySelector('.layout-zone[data-zone="bottom"]')
            ).appendChild(moreChip);
        }





        const railEl = card.querySelector(".stage-rail");
        railEl.dataset.zone = layout.railControls;

        cardElements.set(sampleId, {
            titleEl, captionEl, descriptionEl, chartEl, railEl,
            progressBarEl: card.querySelector(".stage-bar"),
        });

        const CENTER_ZONE_FRACTION  = 0.34;
        const DOUBLE_TAP_THRESHOLD_MS = 350;
        let lastLeftTapTime = 0;

        // ── TAP DETECTION, FROM POINTER EVENTS, IN THE CAPTURE PHASE ──────
        //
        // This used to listen for a bubbling `click`, which is why
        // next/previous-stage taps were unreliable on a phone and perfect
        // on a laptop -- and why it was worst on stages with a plot.
        //
        // A plot stage puts Plotly SVG or a canvas inside .chart. Plotly
        // binds its own touch handlers and calls preventDefault() on
        // touchstart, and a touchstart whose default is prevented means
        // the browser NEVER SYNTHESISES A CLICK. There was no event to
        // bubble. Nothing was swallowing the tap; the tap never existed.
        // A mouse click is generated regardless, hence the laptop.
        //
        // Pointer events are not synthesised, so they always arrive. And
        // listening in the CAPTURE phase means the card sees the press
        // before any descendant runs -- a child calling stopPropagation
        // cannot hide it, which removes the whole class of "some library
        // inside the chart ate my event".
        //
        // The trade is that `click`'s own definition of a tap (press and
        // release on the same element, no drag) has to be restated here:
        // same pointer, released quickly, and barely moved. The movement
        // test is also what keeps a scrub from registering as a tap, so
        // suppressClickUntil in journey_interpreter.js is now belt and
        // braces rather than the mechanism.
        const TAP_MAX_MS = 600;
        const TAP_MAX_PX = 14;
        // Anything with its own tap behaviour. These used to rely on
        // stopPropagation during the bubble phase, which a capture-phase
        // listener runs before -- so they have to be named explicitly.
        const TAP_EXEMPT = ".stage-rail, .scrub-bar, .stage-title, .more-from";
        let press = null;

        card.addEventListener("pointerdown", (e) => {
            press = { x: e.clientX, y: e.clientY,
                      t: performance.now(), id: e.pointerId };
        }, true);
        card.addEventListener("pointercancel", () => { press = null; }, true);

        card.addEventListener("pointerup", (e) => {
            const p = press;
            press = null;
            if (!p || e.pointerId !== p.id) return;
            if (performance.now() - p.t > TAP_MAX_MS) return;
            if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_MAX_PX) return;
            if (e.target?.closest?.(TAP_EXEMPT)) return;

            const cardRect = card.getBoundingClientRect();

            // DEAD ZONE DERIVED FROM THE RAIL, NOT A MAGIC 80px.
            //
            // This is why left/right taps worked on a laptop and only
            // sometimes on a phone. The zone is a fixed 80px, which is 6%
            // of a 1280px card and 21% of a 390px one -- and it eats the
            // OUTER part of the right third, so the usable right-third
            // went from 129px nominal to 49px actual on a phone. A third
            // of the screen that is really an eighth.
            //
            // The rail's own box is the honest boundary, plus a small
            // margin for thumbs. The closest() check above already
            // handles a direct hit on a button; this only keeps taps just
            // beside one from counting as "next stage".
            const rail = card.querySelector(".stage-rail");
            const railBox = rail?.getBoundingClientRect();
            const guardFrom = railBox && railBox.width
                ? railBox.left - 10
                : cardRect.right - 56;   // fallback: rail not built yet
            if (e.clientX > guardFrom) return;
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
        }, true);

        return card;
    }

    // ── Fetch and build initial cards ─────────────────────────────────────
    // A CURATED batch names its own sample per card, so cards can come
    // from DIFFERENT sources -- an ECG record, then an AES block, then a
    // 16-bit SPN block. The paginated path cannot do that: it draws every
    // card from one apiEndpoint, which binds the whole feed to a single
    // source. A tour across domains is exactly the case that breaks.
    //
    // Curated feeds are FIXED LENGTH by nature (someone chose the cards),
    // so pagination is skipped rather than looping the same tour forever.
    const isCurated = Array.isArray(batchPattern)
                      && batchPattern.length > 0
                      && batchPattern.every(e => e && e.sampleId);

    function loadCuratedCards() {
        batchPattern.forEach((entry, i) => {
            const card = buildCard(entry.sampleId, i);
            cardIndexMap.set(entry.sampleId, i);
            regMeta(entry.sampleId, {
                label:       entry.label ?? null,
                journeyName: entry.journey,
                cardIndex:   i,
            });
            feedContainer.appendChild(card);
            // NOT observed here. cardObserver is declared further down and
            // this runs during the awaited loadFeedCards() above it -- the
            // const would still be in its temporal dead zone. The loop
            // that runs just after the observer is created picks up every
            // card already in the DOM, which is exactly these.
        });
        nextCardIndex  = batchPattern.length;
        totalAvailable = batchPattern.length;
        loadedCount    = batchPattern.length;   // nothing left to page in
        appendEndCard();                        // a tour is complete by definition
    }

    // Appended once, when there is provably nothing more to load. Guarded
    // by its own presence rather than a flag, so the pagination path and
    // the curated path can both call it without coordinating.
    function appendEndCard() {
        if (feedContainer.querySelector(".feed-end")) return;
        const end = document.createElement("div");
        end.className = "feed-end";
        end.innerHTML =
            `<div class="dot"></div>` +
            `<div class="end-title">That's everything</div>` +
            `<div class="end-sub">${totalAvailable ?? loadedCount} ` +
            `card${(totalAvailable ?? loadedCount) === 1 ? "" : "s"} in this journey` +
            `<br>scroll back up to watch any of them again</div>`;
        feedContainer.appendChild(end);
    }

    async function loadFeedCards() {
        if (isCurated) { loadCuratedCards(); return; }
        try {
            // A SHARED LINK lands on a specific card (?sample=A00042) and
            // then continues with the normal list. The shared card is
            // built FIRST so it is what the viewer sees on arrival, and
            // page 0 follows underneath -- arriving from a link is often
            // a first visit, and dropping someone at record 4,312 of
            // 8,528 makes everything after it arbitrary.
            if (startSample) {
                const card = buildCard(startSample, nextCardIndex);
                cardIndexMap.set(startSample, nextCardIndex);
                regMeta(startSample, {
                    label:       null,
                    journeyName: getJourneyNameForCard(nextCardIndex),
                    cardIndex:   nextCardIndex,
                });
                nextCardIndex++;
                feedContainer.appendChild(card);
            }

            const { samples, total } = await fetchSamplesPage(0);
            totalAvailable = total;
            globalThis.__bootSplash?.step("building cards");

            if (samples.length === 0) {
                feedContainer.innerHTML = '<p style="color:#747d8c;text-align:center;margin-top:40vh;">No records found.</p>';
                globalThis.__bootSplash?.dismiss();
                return;
            }

            samples.forEach(({ record_id, label }) => {
                // Skip the shared card if page 0 also contains it. Two
                // cards with the same sampleId is not a double render --
                // the second never STARTS, because the feed treats that
                // sample as already playing and renders a blank card.
                if (record_id === startSample) return;

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
            if (totalAvailable !== null && loadedCount >= totalAvailable) {
                appendEndCard();   // the whole journey fitted one page
            }

        } catch (err) {
            console.error("Failed to load sample list:", err);
            feedContainer.innerHTML = '<p style="color:#a32638;text-align:center;margin-top:40vh;">Could not load records.</p>';
            globalThis.__bootSplash?.dismiss();
        }
    }

    async function loadMoreCards(sentinel) {
        if (isCurated || isLoadingMore) return;
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
            if (totalAvailable !== null && loadedCount >= totalAvailable) {
                appendEndCard();
            }
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

    // No-ops for a curated feed: loadedCount already equals the total, but
    // being explicit means a future change to that bookkeeping cannot
    // silently start paging a fixed tour.
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

                    // First journey running -- there is now something on
                    // screen, so the splash has done its job.
                    globalThis.__bootSplash?.dismiss();
                } else {
                    // Already built, coming back into view. Without this
                    // the card sat frozen: the exit branch below cancels
                    // its sweep and nothing ever restarted it. Optional-
                    // chained so an older interpreter without the method
                    // simply behaves as before rather than throwing in
                    // the observer callback.
                    activeJourneys.get(sampleId)?.resumeIfPlaying?.();
                }

                // GESTURE HINTS. Started here rather than in buildCard
                // because a hint is only honest once the card is the one
                // being looked at -- cards are built up to three ahead of
                // the viewer, and a hint that counted itself as "shown"
                // while off screen would burn its one appearance on
                // nobody. Optional in exactly the way analytics is: if
                // the script failed to load, the feed must not care.
                if (!hintStops.has(sampleId)
                    && typeof startGestureHints === "function") {
                    const cardIdx = cardIndexMap.get(sampleId) ?? 0;
                    hintStops.set(sampleId, startGestureHints(entry.target, {
                        uiShell:   getRecipeForCard(cardIdx)?.uiShell,
                        isCurated,
                    }) || (() => {}));
                }

                track("card_entered", sampleId);
                // Card is on screen -- are we near the end of what's loaded?
                maybeLoadMore(sampleId);
            } else {
                const control = activeSweepControl.get(sampleId);
                track("card_exited", sampleId, {
                    elapsed_ms: control ? Math.round(control.lastElapsedMs) : null,
                });
                // suspend() stops the sweep AND the auto-advance timer
                // together; the bare cancelSweepAnimation left stages
                // stepping forward off screen. Falls back to the old
                // behaviour if the method is not there.
                const j = activeJourneys.get(sampleId);
                if (j?.suspend) j.suspend();
                else cancelSweepAnimation(sampleId);
                // Tear the hints down with the card, and DROP the entry so
                // scrolling back up can offer one again -- the queue's own
                // seen-list is what prevents a repeat, not this map.
                hintStops.get(sampleId)?.();
                hintStops.delete(sampleId);
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