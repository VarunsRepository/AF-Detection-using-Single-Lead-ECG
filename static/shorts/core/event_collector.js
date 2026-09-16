// ---------------------------------------------------------------------------
// core/event_collector.js
//
// Captures what happens in the feed and posts it to /shorts/analytics.
// Feeds the recommendation engine, which needs to reason about three
// things -- and critically about their COMBINATION:
//
//     journey_name   which recipe played        "ecg", "dwt"
//     sample_id      which record it ran on     "A00042"
//     sample_label   what that record IS        "N" | "A" | "O" | "~"
//
// WHY ALL THREE: journey-only stats say "DWT gets skipped 60% of the
// time". Journey x label says "DWT on noisy records gets skipped, DWT on
// AFib records gets completed and replayed" -- a fact about the PAIRING
// that neither dimension shows alone. That pairing is what lets the
// recommender sequence for contrast, which is the whole mechanism by
// which pattern recognition develops.
//
// PRIVACY: session_id is a random UUID generated in this browser tab and
// held in memory only. It is not a cookie, not persisted, and identifies
// a SESSION, not a person. No IP address, no device fingerprint, no
// identity of any kind is collected here or server-side.
//
// FAILURE MODE: analytics must never break the feed. Every call is
// wrapped, and a failed flush drops its batch rather than retrying
// forever or growing unbounded.
//
// Depends on: nothing. Loads before journey_scroll_feed.js.
// ---------------------------------------------------------------------------

const ANALYTICS_ENDPOINT   = "/shorts/analytics";
const FLUSH_THRESHOLD      = 20;     // flush once this many events buffer
const FLUSH_INTERVAL_MS    = 15000;  // ...or this often, whichever first
const MAX_BUFFER           = 200;    // hard cap -- drop oldest beyond this

// Random per-tab session identifier. crypto.randomUUID is available in
// all target browsers; the fallback covers insecure-origin dev servers
// where crypto may be unavailable.
const sessionId = (globalThis.crypto?.randomUUID?.())
    ?? `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

// ── Device class ────────────────────────────────────────────────────────
// Derived ONCE per session and attached to every event, because UX can
// differ enormously by device: a journey that holds attention on a laptop
// may be unusable on a phone, and journey-level stats alone would average
// those together into a number that describes neither.
//
// WHAT THIS IS NOT: the full User-Agent string. That is a fingerprinting
// vector -- combined with viewport, timezone and language it often
// identifies a single device uniquely. What is stored instead is a
// CLASS that thousands of users share:
//
//     platform   mobile | tablet | desktop
//     os_family  ios | android | windows | macos | linux | other
//     browser    safari | chrome | firefox | edge | other
//     viewport   bucketed to a size band, not exact pixels
//     dpr        rounded to 1 | 2 | 3
//
// That is enough to answer "does this work on phones?" and not enough to
// single anyone out.
function detectDeviceClass() {
    const ua = navigator.userAgent;
    const w  = window.screen?.width  ?? window.innerWidth;
    const h  = window.screen?.height ?? window.innerHeight;
    const minDim = Math.min(w, h);

    let os_family = "other";
    if (/iPhone|iPad|iPod/i.test(ua))      os_family = "ios";
    else if (/Android/i.test(ua))          os_family = "android";
    else if (/Windows/i.test(ua))          os_family = "windows";
    else if (/Macintosh|Mac OS X/i.test(ua)) os_family = "macos";
    else if (/Linux/i.test(ua))            os_family = "linux";

    // Touch capability plus smallest screen dimension, rather than UA
    // sniffing alone -- iPads report a desktop UA in recent iOS.
    const touch = (navigator.maxTouchPoints ?? 0) > 0;
    let platform = "desktop";
    if (touch && minDim < 600)       platform = "mobile";
    else if (touch && minDim < 1100) platform = "tablet";

    let browser = "other";
    if (/Edg\//i.test(ua))                          browser = "edge";
    else if (/Chrome|CriOS/i.test(ua))              browser = "chrome";
    else if (/Firefox|FxiOS/i.test(ua))             browser = "firefox";
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "safari";

    // Bucketed, not exact -- exact viewport is a strong fingerprinting
    // signal, and a band answers the same UX question.
    const band = minDim < 400 ? "xs"
               : minDim < 600 ? "sm"
               : minDim < 900 ? "md"
               : minDim < 1400 ? "lg" : "xl";

    return {
        platform,
        os_family,
        browser,
        viewport_band: band,
        dpr: Math.round(window.devicePixelRatio ?? 1),
    };
}

const deviceClass = detectDeviceClass();

let eventBuffer   = [];
let flushTimer    = null;
let analyticsOn   = true;   // set false permanently if the endpoint 404s

// Per-sample metadata, populated as cards are built. Lets an event
// carry sample_label without every call site having to pass it.
const sampleMeta = new Map();   // sampleId -> { label, journeyName, cardIndex }

function registerSampleMeta(sampleId, meta) {
    sampleMeta.set(sampleId, { ...(sampleMeta.get(sampleId) ?? {}), ...meta });
}

/**
 * Record one event. Cheap and non-blocking -- appends to a buffer.
 *
 * @param {string} eventType  card_entered | card_exited | stage_started |
 *                            stage_completed | paused | resumed |
 *                            restarted | algorithm_switched |
 *                            renderer_switched | speed_changed
 * @param {string} sampleId
 * @param {object} detail     event-specific extras (stage_index, elapsed_ms...)
 */
function trackEvent(eventType, sampleId, detail = {}) {
    if (!analyticsOn) return;
    try {
        const meta = sampleMeta.get(sampleId) ?? {};
        eventBuffer.push({
            session_id:   sessionId,
            event:        eventType,
            sample_id:    sampleId,
            sample_label: meta.label       ?? null,
            journey_name: meta.journeyName ?? null,
            card_index:   meta.cardIndex   ?? null,
            client_ts:    Date.now(),
            // Device class on every row rather than once per session:
            // it makes every aggregate query a simple GROUP BY without
            // needing a join to a sessions table.
            ...deviceClass,
            ...detail,
        });

        // Bound the buffer -- a long session with a dead endpoint must not
        // grow memory without limit.
        if (eventBuffer.length > MAX_BUFFER) {
            eventBuffer = eventBuffer.slice(-MAX_BUFFER);
        }
        if (eventBuffer.length >= FLUSH_THRESHOLD) flushEvents();
    } catch (err) {
        console.warn("[analytics] trackEvent failed:", err);
    }
}

/**
 * Send buffered events. Uses sendBeacon when the page is going away --
 * a normal fetch() is cancelled during unload, so events from the last
 * card viewed would be lost without it.
 */
function flushEvents({ useBeacon = false } = {}) {
    if (!analyticsOn || eventBuffer.length === 0) return;

    const batch = eventBuffer;
    eventBuffer = [];   // swap out first, so new events during the send
                        // land in a fresh buffer rather than being lost

    const body = JSON.stringify({ events: batch });

    try {
        if (useBeacon && navigator.sendBeacon) {
            navigator.sendBeacon(ANALYTICS_ENDPOINT,
                new Blob([body], { type: "application/json" }));
            return;
        }
        fetch(ANALYTICS_ENDPOINT, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
        }).then(res => {
            if (res.status === 404) {
                // Endpoint isn't deployed -- stop trying for this session
                // rather than logging an error per flush.
                console.info("[analytics] endpoint not found, disabling for this session");
                analyticsOn = false;
            }
        }).catch(() => { /* network blip -- batch is dropped, not retried */ });
    } catch (err) {
        console.warn("[analytics] flush failed:", err);
    }
}

// Periodic flush -- catches sessions where the user lingers on one card
// and never crosses FLUSH_THRESHOLD.
function startAnalytics() {
    if (flushTimer) return;
    flushTimer = setInterval(() => flushEvents(), FLUSH_INTERVAL_MS);

    // pagehide fires reliably on mobile Safari where unload does not.
    window.addEventListener("pagehide", () => flushEvents({ useBeacon: true }));
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            flushEvents({ useBeacon: true });
        }
    });
}

startAnalytics();
