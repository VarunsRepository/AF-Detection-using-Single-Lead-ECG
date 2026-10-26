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

// OPENING THE SHEET PAUSES THE JOURNEY.
//
// Not cosmetic, and the one judgement call in this feature. Stages
// auto-advance every ~12s and the description is PER STAGE, so without
// this the text being read is replaced mid-sentence by the next stage's
// -- which is also why the interpreter used to slam the old overlay shut
// on every stage change. Reading the explanation is the most engaged a
// viewer ever is; yanking it away at that moment is hostile.
//
// Pausing makes the problem disappear rather than managing it: no stage
// can change while the sheet is open, so there is nothing to collapse
// and nothing to resynchronise. Closing resumes where it stopped.
//
// suspend()/resumeIfPlaying(), NOT togglePause(), because those two are
// silent -- togglePause flashes the play/pause glyph, and a glyph that
// fires because you opened the description is a lie about what you did.
//
// One line to turn off if it ever proves wrong.
const SHEET_PAUSES_PLAYBACK = true;

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

        // ── IS THIS CARD A SHEET? ──────────────────────────────────────
        // Only when all three text elements land in the bottom zone,
        // which is what every current recipe does. If a recipe ever
        // splits them, the title would end up outside the handle and the
        // sheet would have no peek -- an invisible control. That case
        // falls back to the plain stacked zone instead, which is also
        // what DEFAULT_LAYOUT's "top" placement has always produced.
        const useSheet = layout.title === "bottom"
                      && layout.caption === "bottom"
                      && layout.description === "bottom"
                      && typeof mountSheet === "function";

        const card = document.createElement("section");
        card.className    = "journey-card";
        card.dataset.sampleId = sampleId;
        card.innerHTML = `
            <div class="stage-bar"></div>
            <div class="layout-zone" data-zone="top"></div>
            <div class="layout-zone" data-zone="center"></div>
            <div class="card-chip-slot"></div>
            <div class="layout-zone${useSheet ? " stage-sheet" : ""}" data-zone="bottom">${
                useSheet
                ? `<div class="sheet-handle">`
                  + `<span class="sheet-grab" aria-hidden="true"></span>`
                  + `</div><div class="sheet-body"></div>`
                : ""
            }</div>
            <div class="stage-rail"></div>
        `;

        const titleEl = document.createElement("h2");
        titleEl.className   = "stage-title";
        titleEl.textContent = "Loading...";

        // NO CLICK LISTENER HERE ANY MORE.
        //
        // Tapping the title used to toggle a .text-expanded class on the
        // zone. That gesture now belongs to the sheet's handle, which the
        // title sits inside -- mountSheet() handles tap AND drag from one
        // set of pointer handlers, so the two cannot disagree about which
        // state the panel is in. See static/shorts/controls/sheet.js.

        const captionEl = document.createElement("p");
        captionEl.className = "stage-caption";

        const descriptionEl = document.createElement("p");
        descriptionEl.className = "stage-description";

        const chartEl = document.createElement("div");
        chartEl.className = "chart";

        // A sheet has two slots rather than one: the title is the PEEK
        // (always visible, and the drag handle), the prose is the BODY.
        // Any zone that is not a sheet keeps taking everything directly,
        // exactly as before.
        function slotFor(zoneName, role) {
            const zoneEl = card.querySelector(`.layout-zone[data-zone="${zoneName}"]`)
                        || card.querySelector('.layout-zone[data-zone="top"]');
            if (!zoneEl.classList.contains("stage-sheet")) return zoneEl;
            return zoneEl.querySelector(role === "peek" ? ".sheet-handle"
                                                        : ".sheet-body");
        }

        [[titleEl,       layout.title,       "peek"],
         [captionEl,     layout.caption,     "body"],
         [descriptionEl, layout.description, "body"],
         [chartEl,       layout.plot,        "body"]
        ].forEach(([el, zone, role]) => slotFor(zone, role).appendChild(el));



// Curated cards only -- the one rung of the ladder, see buildMoreChip().
        //
        // ITS OWN SLOT NOW, just above the sheet's top edge, instead of
        // inside the text zone under the title. Two reasons: it is
        // navigation rather than description, and inside the sheet it
        // would either make the peek two rows tall or hide behind a
        // panel nobody opened. YouTube puts its equivalent chip in the
        // same place, permanently visible above the description bar.
        const moreChip = buildMoreChip(sampleId, cardIndex);
        if (moreChip) {
            (card.querySelector(".card-chip-slot")
             || card.querySelector('.layout-zone[data-zone="bottom"]')
            ).appendChild(moreChip);
        }

        const railEl = card.querySelector(".stage-rail");
        railEl.dataset.zone = layout.railControls;

        // ── MOUNT THE SHEET ────────────────────────────────────────────
        // Optional in exactly the way analytics and the gesture hints are
        // optional: if controls/sheet.js failed to load, useSheet is
        // false, the zone stays a plain stacked column and the card still
        // plays. Losing the feed to save a control would be the wrong
        // trade.
        //
        // The journey does not exist yet -- it is built when the card
        // first intersects -- so the callbacks look it up when they fire
        // rather than closing over it.
        const sheet = useSheet
            ? mountSheet(card.querySelector(".stage-sheet"), {
                  id: `sheet-${cardIndex}`,
                  onOpen: () => {
                      if (SHEET_PAUSES_PLAYBACK) {
                          activeJourneys.get(sampleId)?.suspend?.();
                      }
                      // Not in VALID_EVENTS server-side until the one-line
                      // change in the install notes lands, at which point
                      // this answers the only question that matters about
                      // this feature: does anyone open it at all.
                      track("sheet_opened", sampleId);
                  },
                  onClose: () => {
                      if (SHEET_PAUSES_PLAYBACK) {
                          activeJourneys.get(sampleId)?.resumeIfPlaying?.();
                      }
                  },
              })
            : null;

        cardElements.set(sampleId, {
            titleEl, captionEl, descriptionEl, chartEl, railEl, sheet,
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
        // .stage-sheet covers the handle, the grabber, the title and the
        // body in one selector; .sheet-scrim is how a tap-to-close is
        // stopped from ALSO advancing a stage on its way out. Both are
        // needed because this listener runs in the CAPTURE phase, which
        // is before any stopPropagation a descendant could call.
        const TAP_EXEMPT = ".stage-rail, .scrub-bar, .stage-title, .more-from, "
                         + ".stage-sheet, .sheet-scrim, .card-chip-slot";
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
                // CLOSE THE SHEET WITH THE CARD. Silently: the close
                // callback would call resumeIfPlaying() on a card that
                // has just been suspended for leaving the screen, and
                // restart it off-view. Scrolling back finds the card
                // where it was, with the sheet shut.
                cardElements.get(sampleId)?.sheet?.close({ silent: true });
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
