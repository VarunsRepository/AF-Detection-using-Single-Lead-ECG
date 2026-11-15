// ---------------------------------------------------------------------------
// renderers/exchange_view.js
//
// Two parties, side by side, passing packets. Each packet assembles byte
// by byte at the sender, crosses the corridor between them, and lands as
// a line in a transcript that accumulates down the card.
//
// Built for ble_connect, deliberately generic: anything that is a
// request/response conversation wants this picture. The backlog's Matter
// commissioning (item 18, "a message sequence with the failure branches
// shown"), I2C arbitration (9), CAN error frames (10) and a TCP handshake
// all fit the same contract.
//
// THE CONTRACT, so other journeys can reuse it
//   finalOutput.parties    { left: {id,label,sub}, right: {id,label,sub} }
//   finalOutput.exchanges  [{ name, namePlain, from, to,
//                             fields:[{label,bytes,role}],
//                             pduBytes, onAirBytes, gapBeforeUs, gapKind,
//                             note, collapsed }]
//   finalOutput.roleBytes, roleLabels    the colour legend
//   config.glossary        [{acronym, full, plain}]   optional, and on
//                          the CONFIG not the output -- a glossary is a
//                          view concern, supplied by the recipe
//
//   namePlain is OPTIONAL. A packet without one keeps its jargon name at
//   every depth, so a reuser of this contract (Matter commissioning, a
//   TCP handshake) can ignore it entirely and nothing breaks.
//
// WHAT THIS RENDERER READS FROM THE GLOBAL DIAL
//   --depth-level  "basic" | "guided" | "simple"   definitions strip
//   --term-level   "full" | "plain"                which packet name
// Both written by rail_controls.js. This file owns no control of its own
// any more -- see the note where choices() used to be.
//
// ── FRAME 0 HAS TO BE A FRAME ───────────────────────────────────────────
//   THE BUG THIS FIXES, because it was reported three times as three
//   different bugs: "the stage stays blank till the end", "seeking back
//   and forth makes it render", "seek all the way back and it goes blank
//   again". One cause.
//
//   At elapsed 0, `building` is 0, so `revealBytes` is 0, so every field
//   segment of the active packet draws at zero width. Correct -- a packet
//   that has not started assembling has no bytes on air yet. And the
//   pending packets WERE outlined, exactly as the note below promises,
//   but in DEAD (#3a4049): a 1px dashed near-black line on a near-black
//   card. Structurally present, optically absent.
//
//   So frame 0 was a card with no visible content, and anything that
//   parks the clock at 0 -- a card the feed built while off-screen, a
//   sweep that never started, a resize repainting at lastT before the
//   first tick -- read as a total render failure. Scrubbing forward
//   "fixed" it; scrubbing back to zero "broke" it again.
//
//   THE FIX IS NOT TO FAKE BYTES. Flooring revealBytes to a few percent
//   would put ink on screen and would also misreport the one thing these
//   bars must not lie about. Instead the SILHOUETTES became visible:
//   every packet is stroked in its sender's hue, pending ones faint and
//   dashed, the active one solid. A paused-at-start card now shows the
//   whole shape of the conversation and which way each packet will go,
//   which is what the paragraph below claimed all along.
//
//   Worth stating plainly: this does not fix a stuck clock. It makes a
//   stuck clock look like a paused card instead of a broken one. If a
//   stage still never advances, the fault is in the sweep, not here.
//
// WHY COMPLETED PACKETS STAY ON SCREEN
//   A message-sequence diagram's whole value is that you can see the
//   shape of the conversation -- who spoke, how often, in which
//   direction. An animation that showed one packet at a time and cleared
//   it would be strictly worse than the static diagram it replaces. So
//   finished exchanges compress to one dim line each and stay, and the
//   packets still to come are drawn as empty outlines, so the length of
//   the conversation is visible from the first frame.
//
// WHY THE ACTIVE ROW IS THE ONLY DETAILED ONE
//   Eleven packets with every field labelled is unreadable at 390px. The
//   active row expands to show coloured fields and labels; the rest are
//   a name, a direction and a bar. Detail follows attention.
//
// THE ONE PLACE THIS IS NOT TO SCALE, AND IT SAYS SO
//   Transit duration is NOT proportional to the gap. The real gaps in
//   this journey differ by two hundred times -- 150 microseconds inside a
//   connection event against 30 milliseconds between them -- so a
//   faithful animation would spend its entire length on the last gap.
//   Instead every exchange gets an equal slice, the gap is drawn as a
//   bar whose WIDTH is logarithmic in its duration, and the real figure
//   is printed beside it. The canvas states this in words rather than
//   letting a viewer assume the timing is honest.
//
//   Propagation time is not modelled at all, because over a metre it is
//   three nanoseconds. What the transit represents is turnaround.
//
// COLOUR IS NOT THE ONLY CHANNEL
//   Every field carries its byte count, the active row labels each field
//   in text, and direction is shown by an arrow glyph as well as by which
//   side the packet starts from.
//
// ── WHO IS TALKING: THREE CHANNELS, NONE OF THEM THE FILL ──────────────
//   The bar's fill is spoken for. It carries the FIELD ROLES, and that
//   split is the lesson of the card -- CONNECT_IND being one layer doing
//   three different jobs is the whole reason this journey exists. So
//   device identity cannot use it, and the obvious answer (colour the
//   packet by sender) is the one answer unavailable.
//
//   1. THE BAR IS AN ARROW. A chevron head on the leading edge.
//
//      This one fixes something that was WRONG rather than merely weak. A
//      completed packet parks at its RECEIVER -- it has to, the travel is
//      the point -- so the instant transit ends, position says the
//      opposite of the truth: a packet from the peripheral ends up
//      sitting against the central's rail. The direction glyph stayed
//      out in the sender's gutter, so arrow and bar sat on opposite
//      sides of the card. Putting the head on the shape means the cue
//      travels with the packet and parking cannot contradict it.
//
//   2. NAMES ALIGN TO THEIR SENDER, not to the corridor's centre. The
//      transcript becomes two ragged columns: flush left is the
//      peripheral speaking, flush right is the central. Free, and it is
//      the cue that works at a glance across a whole scrolled stage.
//
//   3. A HUE PER SIDE, on the FURNITURE ONLY -- the edge rail, the party
//      header chip, a 4px cap on each bar's tail, and the name. Never on
//      a field.
//
//      KEYED BY SIDE, NOT BY DEVICE. This renderer is meant to be reused
//      (Matter commissioning, I2C arbitration, a TCP handshake), and a
//      reuser should not have to declare colours to get a consistent
//      picture. Left is left.
//
//      The two defaults clear the role palette deliberately: teal is
//      clear of channels purple, rose is clear of timing amber, and both
//      are desaturated so they read as furniture rather than content.
//      They also differ in lightness, not hue alone, so the distinction
//      survives a colour-blind reader. Overridable via --party-left and
//      --party-right -- and PAYLOAD TAKES THE THEME ACCENT, so whatever
//      a theme sets here must not be a colour it might also pick for
//      the trace.
//
// Self-registers. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// Fractions of one exchange's time slice.
const BUILD_FRAC   = 0.55;
const TRANSIT_FRAC = 0.33;
// remainder is the arrived hold

// Glossary rotation, milliseconds per term.
const TERM_MS = 2600;

registerRenderingAlgorithm("exchange_view", {

    // ── NO choices() ANY MORE, AND THAT IS THE POINT ───────────────────
    // This renderer used to declare one: "Defs", toggling the definitions
    // strip at the foot of the card. It was renamed from "Terms" because
    // "Terms" read like the control for which WORDS the card uses -- and
    // it was not; that was the theme's termLevel, reached through the
    // Theme button, two seats away on the same rail.
    //
    // Renaming it was treating the symptom. There were two controls for
    // one question, one of them in this file and scoped to this renderer,
    // the other welded to a colour scheme. The global Depth control
    // replaces both: see DEPTH_LEVELS in rail_controls.js.
    //
    // WHY NOT KEEP IT AS A LOCAL OVERRIDE: because it could not be one.
    // A choices() control is per-renderer and per-stage, so a viewer who
    // set it on stage 1 lost it on stage 2 and lost it entirely on any
    // card this renderer does not draw. "How much explaining do I want"
    // is a property of the reader, not of a view.

    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const fo = dspOutput.finalOutput ?? {};
        const ex = fo.exchanges ?? [];
        const parties = fo.parties;
        if (!ex.length || !parties?.left || !parties?.right) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">exchange_view needs finalOutput.exchanges and .parties.</p>`;
            return;
        }

        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);

        const iw = container.offsetWidth || 390, ih = container.offsetHeight || 420;
        canvas.width  = Math.round(iw * useDPR);
        canvas.height = Math.round(ih * useDPR);
        canvas.style.width = iw + "px"; canvas.style.height = ih + "px";

        // RESIZING A CANVAS CLEARS IT, so the observer MUST repaint.
        //
        // Without the draw() below the card renders blank on load and
        // only appears once something else triggers a frame -- a seek, or
        // the sweep's first tick. The sequence is: draw(0) paints into a
        // canvas sized from the fallback because the container has not
        // been laid out yet, layout settles, this fires, the canvas is
        // wiped, and nothing repaints. A card the feed has suspended
        // never gets that rescuing frame at all.
        //
        // Repainted at lastT rather than 0 so a resize mid-stage does not
        // jump the animation back to the beginning.
        new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;

            // ADDED: skip when the pixel size has not actually changed.
            // ResizeObserver delivers an initial callback on observe()
            // reporting the size just applied above, and assigning
            // canvas.width reallocates the surface even for an identical
            // value. The draw() below covers it either way, so this is not
            // correctness -- it saves a full clear and a full repaint on
            // every render, which is exactly when the frame budget is
            // tightest.
            const w = Math.round(width  * useDPR);
            const h = Math.round(height * useDPR);
            if (canvas.width === w && canvas.height === h) return;

            canvas.width  = w;
            canvas.height = h;
            canvas.style.width = width + "px"; canvas.style.height = height + "px";
            draw(lastT);
        }).observe(container);

        // Last position drawn, so the resize repaint lands where the
        // animation actually is.
        let lastT = 0;

        // ── Theme values, read ONE way ──────────────────────────────────
        // Through the CSS variables, like every other renderer. This used
        // to read THEMES[themeIndex]?.traceColor directly, which was the
        // last of the second-path reads left in the BLE renderers.
        //
        // typeof-guarded because rail_controls.js owns these readers and
        // renderer load order is decided by rendering_store.resolve()
        // rather than by this file.
        const root = getComputedStyle(document.documentElement);
        const readVar = (name, fallback) =>
            typeof themeColor === "function"
                ? themeColor(root, name, fallback)
                : (root.getPropertyValue(name).trim() || fallback);

        const accent = readVar("--trace-color",
                               readVar("--accent", "#4aa3d8"));
        const MUTED = "#5c6470";
        const DEAD  = "#3a4049";
        const WARN  = "#e0a030";

        // One hue per SIDE of the corridor -- see the header for why by
        // side and not by device, and why these two values.
        const PARTY_LEFT  = readVar("--party-left",  "#6fd3c7");
        const PARTY_RIGHT = readVar("--party-right", "#ef9bb8");
        const partyCol = fromLeft => (fromLeft ? PARTY_LEFT : PARTY_RIGHT);

        // One colour per role. payload takes the theme accent, because it
        // is the thing the viewer came to follow.
        const ROLE_COLOUR = {
            addressing: "#4a8fd0",
            timing:     "#e0a030",
            channels:   "#9b7fe0",
            framing:    "#6c7684",
            payload:    accent,
        };

        // ── THE DEPTH DIAL, READ STRAIGHT FROM THE VARIABLE ─────────────
        // Not through readVar(): that one is themeColor(), which returns
        // its fallback for an empty value, and here an empty value has to
        // be distinguishable so the default is explicit.
        //
        // "basic" is the fallback for a page where rail_controls.js has
        // not written anything yet -- the quietest stop, which is the
        // right thing to be wrong in.
        const depthLevel = root.getPropertyValue("--depth-level").trim() || "basic";
        const plainTerms = root.getPropertyValue("--term-level").trim() === "plain";

        const glossary = config.glossary ?? [];
        // Was config.showGlossary, set by this renderer's own retired
        // choices() control. Now the global dial decides.
        const showGlossary = depthLevel !== "basic" && glossary.length > 0;

        // ── PACKET NAMES FOLLOW THE DIAL ────────────────────────────────
        // The DSPE supplies both forms -- "ATT_WRITE_REQ" and "subscribe"
        // -- side by side in the same packet() call, so the pair cannot
        // drift apart the way a lookup in a second file would.
        //
        // || rather than ?., deliberately: a namePlain the DSPE left as an
        // empty string should fall through to the acronym, not render a
        // nameless row.
        //
        // Any packet with no plain name keeps its acronym. That is what
        // makes this safe to land before all 26 are written, and what
        // stops a half-finished pass showing blanks.
        const nameOf = x => (plainTerms && x.namePlain) || x.name;
        const N = ex.length;

        // Scale every packet in this stage to the stage's largest, so bar
        // lengths are comparable within a card. Rescaling per packet would
        // make a 10-byte empty PDU look the same size as a 44-byte
        // CONNECT_IND, which is the one comparison worth having.
        const maxBytes = Math.max(...ex.map(x => x.onAirBytes), 1);

        // Gap bars are logarithmic in duration. Linear would make every
        // 150 us gap a sub-pixel sliver next to the 30 ms ones.
        const gaps = ex.map(x => x.gapBeforeUs).filter(g => g > 0);
        const gapLo = gaps.length ? Math.min(...gaps) : 1;
        const gapHi = gaps.length ? Math.max(...gaps) : 1;
        const gapFrac = g => {
            if (g <= 0) return 0;
            if (gapHi === gapLo) return 0.5;
            return 0.18 + 0.82 * (Math.log(g / gapLo) / Math.log(gapHi / gapLo));
        };

        const fmtUs = us => us >= 1000 ? `${(us / 1000).toFixed(us >= 10000 ? 0 : 1)} ms`
                                       : `${us.toFixed(0)} µs`;

        // ── t IS SANITISED HERE, ONCE, BEFORE ANYTHING USES IT ──────────
        //
        // THE CRASH THIS FIXES:
        //   exchange_view.js  Cannot read properties of undefined (reading 'from')
        //     at draw        -> const a = ex[active]
        //     at <callback>  -> the sweep's drawFn
        //     at tick        -> shared_signal_utils.js
        //
        //   active came from Math.min(N - 1, Math.floor(t / slice)), which
        //   has a CEILING AND NO FLOOR. Two values of t get through it:
        //
        //     t < 0    -> active = -1   -> ex[-1]   is undefined -> throw
        //     t = NaN  -> active = NaN  -> ex[NaN]  is undefined -> throw
        //
        //   NaN arrives from the sweep callback below when durationMs is
        //   undefined: e / undefined is NaN, and Math.min(1, NaN) is NaN,
        //   not 1 -- Math.min propagates NaN rather than clamping it, which
        //   is exactly the trap a reader expects Math.min to have closed.
        //
        //   A negative t arrives from scrubbing to the very start.
        //
        // WHY IT LOOKED LIKE A RENDER BUG RATHER THAN A CRASH: the throw
        // happens near the END of draw(), after the rows are painted, so
        // the rows loop had already run -- with active negative, every row
        // took the i > active branch and drew as a pending outline. A card
        // of faint outlines and no fills, which is indistinguishable from
        // a card that has not started. Then the exception escaped the rAF
        // callback and killed tick(), so NOTHING repainted for the rest of
        // the stage. Scrubbing forward enters draw() from a different call
        // path with a valid t, which is why it "started working".
        //
        // Clamped at the top rather than guarded at each use: there are
        // four derived values downstream (active, within, building,
        // transit) and a guard on the last one would still leave a NaN
        // flowing through the other three.
        function draw(rawT) {
            const t = Number.isFinite(rawT)
                    ? Math.min(1, Math.max(0, rawT))
                    : 0;
            lastT = t;
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);

            const M = { top: 90 * useDPR, left: 12 * useDPR, right: 12 * useDPR };
            const labelW = 58 * useDPR;
            const corridorX0 = M.left + labelW;
            const corridorX1 = W - M.right - labelW;
            const corridorW = corridorX1 - corridorX0;

            const glossH = showGlossary ? 48 * useDPR : 0;

            // MEASURED, not assumed. At the larger type the five role
            // labels no longer fit one line -- "the actual content" alone
            // is a third of a phone's width -- so the legend wraps and the
            // footer is sized for however many lines that takes. A fixed
            // footer height would clip the last line or leave a gap,
            // depending on which stage you were looking at.
            const LEGEND_PX = 10.5 * useDPR;
            const LEGEND_LINE_H = 17 * useDPR;
            ctx.font = `${LEGEND_PX}px "IBM Plex Mono", monospace`;
            const legendItems = ["addressing", "timing", "channels", "framing", "payload"]
                .filter(r => r in (fo.roleBytes ?? {}))
                .map(r => {
                    const label = fo.roleLabels?.[r] ?? r;
                    return { role: r, label,
                             w: 14 * useDPR + ctx.measureText(label).width + 14 * useDPR };
                });
            const legendAvail = W - 12 * useDPR - 12 * useDPR - 58 * useDPR - 58 * useDPR + 116 * useDPR;
            const legendLines = [[]];
            let lineW = 0;
            for (const it of legendItems) {
                if (lineW + it.w > legendAvail && legendLines[legendLines.length - 1].length) {
                    legendLines.push([]); lineW = 0;
                }
                legendLines[legendLines.length - 1].push(it);
                lineW += it.w;
            }
            const footH = (30 * useDPR) + legendLines.length * LEGEND_LINE_H + 18 * useDPR;

            // ── which exchange, and where within it ──
            // Hoisted above the layout on purpose: the scroll offset
            // is derived from the active row, so it has to exist first.─────────────────
            const slice = 1 / N;
            // BELT AND BRACES, and worth the line: t is already clamped
            // above, so this cannot fire today. It is here because the
            // failure mode when it does fire is not a wrong picture, it is
            // an exception that kills the sweep for the whole card -- and
            // the cost of being wrong in that direction is a stage that
            // never draws again.
            const active = Math.max(0, Math.min(N - 1, Math.floor(t / slice)));
            const within = Math.min(1, (t - active * slice) / slice);
            const building = Math.min(1, within / BUILD_FRAC);
            const transit  = within <= BUILD_FRAC ? 0
                : Math.min(1, (within - BUILD_FRAC) / TRANSIT_FRAC);

            // FIXED row height, and the transcript SCROLLS when the
            // packets do not fit.
            //
            // The previous version sized rows to the count, which made a
            // row 52px on stage 3 and 18px on stage 6 -- the same card
            // looking like two different designs, and the dense stages
            // squeezed below the point where a name fits under a bar.
            //
            // 46px is the smallest row holding a readable bar AND its
            // name, so it is a floor, not a preference. Four fit a phone
            // card: stages 1, 2, 3 and 5 are static, 4 and 6 scroll, and
            // every row now looks identical on every stage.
            const bandTop = M.top;
            const bandH = H - bandTop - glossH - footH;
            const rowH = 46 * useDPR;
            const rowsH = rowH * N;
            const scrolls = rowsH > bandH;
            const barH = Math.max(12 * useDPR, Math.min(24 * useDPR, rowH * 0.55));

            // AUTO ONLY, never draggable. The feed owns vertical gestures,
            // so a user dragging the transcript would change card instead.
            // This is driven entirely by the playhead.
            //
            // Keyed on (active + within), not the integer index, so it
            // glides rather than jumping a row at a time. The active row
            // sits about two thirds down the window: history above it, a
            // hint of what is coming below.
            let scrollY = 0;
            if (scrolls) {
                const want = (active + within + 0.5) * rowH - bandH * 0.68;
                scrollY = Math.max(0, Math.min(rowsH - bandH, want));
            }
            const rowsTop = bandTop + (scrolls ? -scrollY : (bandH - rowsH) / 2);

            // Always true now. The fixed row was chosen as the smallest
            // that holds a bar and its name, so dropping names is no
            // longer a case the layout has to handle.
            const roomForNames = true;

            // How far above its own bar a gap line can sit without
            // crossing into the row above. Derived rather than fixed.
            const gapLift = Math.min(7 * useDPR, (rowH - barH) / 2 - 2 * useDPR);
            const gapLinesForAll = gapLift >= 3 * useDPR;

            // ── party columns ─────────────────────────────────────────
            // A CHIP AS WELL AS A COLOUR. The header is where a reader
            // learns which hue means which device, so the swatch has to
            // be here rather than only in the legend -- and a coloured
            // word alone does not read as a key.
            const CHIP = 9 * useDPR;
            ctx.font = `600 ${13.5 * useDPR}px "IBM Plex Mono", monospace`;

            ctx.fillStyle = PARTY_LEFT;
            ctx.fillRect(M.left, 26 * useDPR - CHIP, CHIP, CHIP);
            ctx.textAlign = "left";
            ctx.fillText(parties.left.label, M.left + CHIP + 5 * useDPR, 26 * useDPR);

            ctx.fillStyle = PARTY_RIGHT;
            ctx.fillRect(W - M.right - CHIP, 26 * useDPR - CHIP, CHIP, CHIP);
            ctx.textAlign = "right";
            ctx.fillText(parties.right.label,
                         W - M.right - CHIP - 5 * useDPR, 26 * useDPR);

            ctx.font = `${9.5 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillStyle = MUTED;
            ctx.textAlign = "left";
            ctx.fillText(parties.left.sub ?? "", M.left, 38 * useDPR);
            ctx.textAlign = "right";
            ctx.fillText(parties.right.sub ?? "", W - M.right, 38 * useDPR);

            // The two edges of the corridor, each in its own party's hue
            // rather than both in the same anonymous grey. These are the
            // one place the colour is a full-height reference, which is
            // what lets the 4px cap on a bar's tail be read at all.
            ctx.lineWidth = 2 * useDPR;
            ctx.globalAlpha = 0.55;
            for (const [x, col] of [[corridorX0, PARTY_LEFT],
                                    [corridorX1, PARTY_RIGHT]]) {
                ctx.strokeStyle = col;
                ctx.beginPath();
                ctx.moveTo(x, bandTop - 6 * useDPR);
                ctx.lineTo(x, bandTop + bandH);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            // ── rows ──────────────────────────────────────────────────
            // Clipped to the band. Without this a scrolled row paints over
            // the party labels above and the glossary below, which is
            // worse than the cramming it replaced.
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, bandTop - 2 * useDPR, W, bandH + 4 * useDPR);
            ctx.clip();

            for (let i = 0; i < N; i++) {
                const x = ex[i];
                const y = rowsTop + i * rowH;
                const cy = y + rowH / 2;
                const fromLeft = x.from === parties.left.id;
                const w = Math.max(10 * useDPR, (x.onAirBytes / maxBytes) * corridorW * 0.86);

                // THE ARROW SILHOUETTE, defined once per row and used for
                // the pending outline, the clip the fields are drawn
                // inside, and the outer stroke. One definition, so the
                // three can never disagree about where the head is.
                //
                // The head is capped at a third of the bar. A 10px empty
                // PDU with a fixed 7px head would be very nearly all
                // head, which reads as a stray triangle rather than as a
                // short packet.
                const headLen = Math.min(7 * useDPR, w * 0.34);
                const arrowPath = (x0) => {
                    const top = cy - barH / 2, bot = cy + barH / 2;
                    ctx.beginPath();
                    if (fromLeft) {
                        ctx.moveTo(x0, top);
                        ctx.lineTo(x0 + w - headLen, top);
                        ctx.lineTo(x0 + w, cy);
                        ctx.lineTo(x0 + w - headLen, bot);
                        ctx.lineTo(x0, bot);
                    } else {
                        ctx.moveTo(x0 + w, top);
                        ctx.lineTo(x0 + headLen, top);
                        ctx.lineTo(x0, cy);
                        ctx.lineTo(x0 + headLen, bot);
                        ctx.lineTo(x0 + w, bot);
                    }
                    ctx.closePath();
                };

                // not reached yet: an empty outline, so the length of the
                // conversation is known from the first frame -- and now
                // its DIRECTION is known too, before it has moved.
                if (i > active) {
                    const px = fromLeft ? corridorX0 + 4 * useDPR
                                        : corridorX1 - 4 * useDPR - w;
                    // ITS SENDER'S HUE, FAINTLY -- not DEAD (#3a4049),
                    // which is a near-black line on a near-black card and
                    // is the reason frame 0 looked empty. Same alpha as
                    // the corridor rails, so a pending packet reads as
                    // part of the furniture rather than as content that
                    // has arrived.
                    //
                    // It also means the whole conversation's DIRECTIONS
                    // are legible before anything has moved, which is
                    // more than the old grey outline ever gave.
                    ctx.globalAlpha = 0.34;
                    ctx.strokeStyle = partyCol(fromLeft);
                    ctx.lineWidth = 1.2 * useDPR;
                    ctx.setLineDash([3 * useDPR, 3 * useDPR]);
                    arrowPath(px);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.globalAlpha = 1;
                    continue;
                }

                // the gap that preceded this packet, as a bar whose width
                // is logarithmic in its real duration
                if (x.gapBeforeUs > 0 && (gapLinesForAll || i === active)) {
                    // The wait before this packet went out. Width is
                    // logarithmic in the duration because the real gaps
                    // span 200x -- a linear bar would make every 150 us
                    // T_IFS a sub-pixel sliver beside the 30 ms ones.
                    //
                    // POSITIONED RELATIVE TO ITS OWN BAR, not to the row's
                    // top edge. At the row's top it sat in the PREVIOUS
                    // row's space, and once the fonts grew the label
                    // collided with that row's name -- both were centred on
                    // the corridor, so they landed on each other exactly.
                    const gw = gapFrac(x.gapBeforeUs) * corridorW * 0.5;
                    const gx = corridorX0 + (corridorW - gw) / 2;
                    const gy = cy - barH / 2 - Math.max(3 * useDPR, gapLift);
                    ctx.strokeStyle = x.gapKind === "model" ? MUTED : WARN;
                    ctx.lineWidth = 1.4 * useDPR;
                    ctx.setLineDash(x.gapKind === "model"
                                    ? [2 * useDPR, 2 * useDPR] : []);
                    ctx.beginPath();
                    ctx.moveTo(gx, gy); ctx.lineTo(gx + gw, gy);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    if (i === active) {
                        // BESIDE the line, not above it. There is no
                        // vertical room above a bar that fills 55% of its
                        // row, and sideways there is plenty.
                        ctx.fillStyle = x.gapKind === "model" ? MUTED : WARN;
                        ctx.font = `${9.5 * useDPR}px "IBM Plex Mono", monospace`;
                        const gTxt = fmtUs(x.gapBeforeUs)
                            + (x.gapKind === "model" ? " *" : "");
                        const fits = gx + gw + 6 * useDPR
                            + ctx.measureText(gTxt).width < corridorX1;
                        ctx.textAlign = fits ? "left" : "right";
                        ctx.fillText(gTxt,
                            fits ? gx + gw + 6 * useDPR : gx - 6 * useDPR,
                            gy + 3.5 * useDPR);
                    }
                }

                // horizontal position: at the sender until transit, then
                // interpolated across, then parked at the receiver
                const startX = fromLeft ? corridorX0 + 4 * useDPR
                                        : corridorX1 - 4 * useDPR - w;
                const endX   = fromLeft ? corridorX1 - 4 * useDPR - w
                                        : corridorX0 + 4 * useDPR;
                const prog = i < active ? 1 : transit;
                // ease so the packet leaves and arrives softly rather than
                // sliding at constant speed, which reads as mechanical
                const eased = prog < 0.5 ? 2 * prog * prog
                                         : 1 - Math.pow(-2 * prog + 2, 2) / 2;
                const px = startX + (endX - startX) * eased;

                const isActive = i === active;
                const alpha = isActive ? 1 : 0.4;

                // ── THE FIELDS, CLIPPED TO THE ARROW ───────────────
                // Clipped rather than reshaped: the segments keep their
                // honest byte-proportional widths and the silhouette
                // trims the last few pixels. Reshaping the final segment
                // into the head instead would have made it look narrower
                // than its byte count, which is the one thing these bars
                // must not lie about.
                //
                // During the build animation the head therefore FORMS as
                // the packet fills, which is a fair picture of a packet
                // that is not finished yet.
                ctx.save();
                arrowPath(px);
                ctx.clip();

                // the bytes, as filled boxes divided by field
                let fx = px;
                const revealBytes = isActive && transit === 0
                    ? building * x.pduBytes : x.pduBytes;
                let drawn = 0;
                ctx.globalAlpha = alpha;
                if (x.fields.length === 0) {
                    // an empty PDU has no fields; draw the framing alone so
                    // it is visibly a packet and visibly carrying nothing
                    ctx.fillStyle = ROLE_COLOUR.framing;
                    ctx.fillRect(px, cy - barH / 2, w, barH);
                    ctx.strokeStyle = "rgba(0,0,0,0.45)";
                    ctx.lineWidth = 1 * useDPR;
                    ctx.strokeRect(px, cy - barH / 2, w, barH);
                } else {
                    for (const fl of x.fields) {
                        const fw = (fl.bytes / x.onAirBytes) * w;
                        const show = Math.max(0, Math.min(fl.bytes, revealBytes - drawn));
                        if (show > 0) {
                            const sw = (show / fl.bytes) * fw;
                            ctx.fillStyle = ROLE_COLOUR[fl.role] ?? MUTED;
                            ctx.fillRect(fx, cy - barH / 2, sw, barH);
                            ctx.strokeStyle = "rgba(0,0,0,0.45)";
                            ctx.lineWidth = 0.8 * useDPR;
                            ctx.strokeRect(fx, cy - barH / 2, sw, barH);
                        }
                        drawn += fl.bytes;
                        fx += fw;
                    }
                    // the framing the radio adds, always shown as the tail
                    const framingW = w - (x.pduBytes / x.onAirBytes) * w;
                    if (framingW > 0.5) {
                        ctx.fillStyle = ROLE_COLOUR.framing;
                        ctx.globalAlpha = alpha * 0.55;
                        ctx.fillRect(fx, cy - barH / 2, framingW, barH);
                        ctx.globalAlpha = alpha;
                        ctx.strokeStyle = "rgba(0,0,0,0.45)";
                        ctx.lineWidth = 0.8 * useDPR;
                        ctx.strokeRect(fx, cy - barH / 2, framingW, barH);
                    }
                }
                ctx.restore();

                // The silhouette's own outline, OUTSIDE the clip -- the
                // per-segment strokeRects above are trimmed at the head,
                // so without this the diagonal edges have no separator
                // and the arrow bleeds into the background.
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = "rgba(0,0,0,0.45)";
                ctx.lineWidth = 1 * useDPR;
                arrowPath(px);
                ctx.stroke();

                // AND THE ACTIVE PACKET GETS A VISIBLE SHELL.
                //
                // The dark stroke above is a separator between fill and
                // background; it is invisible when there is no fill, and
                // at elapsed 0 there is none -- revealBytes is 0 because
                // nothing has been sent yet. Without this the packet
                // currently being assembled is the one packet on the card
                // you cannot see, which is how a card at t=0 ended up
                // looking blank.
                //
                // Solid, where a pending packet's is dashed, so "being
                // sent now" still reads differently from "still to come".
                if (isActive) {
                    ctx.globalAlpha = 0.85;
                    ctx.strokeStyle = partyCol(fromLeft);
                    ctx.lineWidth = 1.4 * useDPR;
                    arrowPath(px);
                    ctx.stroke();
                }

                // THE TAIL CAP, in the sender's hue. At the squared end,
                // never the pointed one: the head already belongs to the
                // direction, and a coloured head would merge two cues
                // into one mark. 4px, which is the corridor rail's width
                // doubled -- enough to read, too narrow to be mistaken
                // for a field.
                ctx.fillStyle = partyCol(fromLeft);
                ctx.fillRect(fromLeft ? px : px + w - 4 * useDPR,
                             cy - barH / 2, 4 * useDPR, barH);
                ctx.globalAlpha = 1;

                // name, direction arrow and size
                ctx.globalAlpha = isActive ? 1 : 0.55;
                ctx.font = `${isActive ? 600 : 400} ${11 * useDPR}px "IBM Plex Mono", monospace`;

                // The gutter glyph stays. It is redundant with the head
                // now, and redundant is the point -- see this file's own
                // rule about colour never being the only channel. It
                // sits outside the corridor in the SENDER's gutter, so
                // with the head on the bar the two agree instead of
                // pointing from opposite sides of the card.
                ctx.fillStyle = partyCol(fromLeft);
                ctx.textAlign = fromLeft ? "left" : "right";
                const nameX = fromLeft ? M.left : W - M.right;
                ctx.fillText(fromLeft ? "→" : "←", nameX, cy + 3 * useDPR);

                // ── ALIGNED TO ITS SENDER, NOT TO THE CORRIDOR ─────
                // Centred, every row's name started in the same place
                // and told you nothing until you read it. Flush to the
                // sender's side, a scrolled stage reads as two ragged
                // columns -- left is the peripheral talking, right is
                // the central -- and that works at a glance, across
                // eleven rows, without reading a word.
                //
                // In the hue too, with alpha carrying active/inactive
                // rather than a grey. Greying the history would be the
                // obvious choice and it would delete the column signal
                // exactly where it is most useful: the completed rows
                // ARE the shape of the conversation.
                ctx.textAlign = fromLeft ? "left" : "right";
                ctx.fillText(
                    `${nameOf(x)}  ${x.onAirBytes}B`
                    + (x.collapsed ? `   ×${x.collapsed + 1}` : ""),
                    fromLeft ? corridorX0 + 2 * useDPR
                             : corridorX1 - 2 * useDPR,
                    cy + barH / 2 + 13 * useDPR);
                ctx.globalAlpha = 1;
            }

            ctx.restore();

            // ── position indicator, only when scrolling ───────────────
            // Scrolling costs the one thing this renderer does better than
            // a message-sequence diagram: seeing the whole conversation at
            // once. This buys some of it back cheaply -- how far through
            // you are, and how many there are.
            if (scrolls) {
                const trackX = W - M.right - 3 * useDPR;
                const thumbH = Math.max(18 * useDPR, bandH * (bandH / rowsH));
                const thumbY = bandTop + (scrollY / (rowsH - bandH))
                                        * (bandH - thumbH);
                ctx.fillStyle = "rgba(255,255,255,0.07)";
                ctx.fillRect(trackX, bandTop, 3 * useDPR, bandH);
                ctx.fillStyle = MUTED;
                ctx.fillRect(trackX, thumbY, 3 * useDPR, thumbH);

                ctx.textAlign = "right";
                ctx.fillStyle = MUTED;
                ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(`${active + 1} / ${N}`,
                             W - M.right - 10 * useDPR, bandTop - 7 * useDPR);
            }

            // ── the active packet, named in the header ────────────────
            // Both lines, always. When rows are tight this is the ONLY
            // place the packet's name appears, so showing the note instead
            // of the name -- which the first version did -- left the card
            // with no way to tell you what you were looking at.
            const a = ex[active];
            const aFromLeft = a.from === parties.left.id;
            ctx.textAlign = "left";
            ctx.font = `600 ${13 * useDPR}px "IBM Plex Mono", monospace`;

            // A DIRECTION GLYPH IN THE SENDER'S HUE, then the name in
            // amber. The header is the most-read line on the card and
            // the only place the name appears while rows are scrolling,
            // so it needs to say who is speaking -- but amber is this
            // card's "here, now" colour and recolouring the whole line
            // would spend that. A two-character prefix buys the same
            // information for almost nothing.
            const dirGlyph = aFromLeft ? "→ " : "← ";
            ctx.fillStyle = partyCol(aFromLeft);
            ctx.fillText(dirGlyph, M.left, 60 * useDPR);
            ctx.fillStyle = WARN;
            ctx.fillText(`${nameOf(a)}  ·  ${a.onAirBytes} B`,
                         M.left + ctx.measureText(dirGlyph).width,
                         60 * useDPR);
            if (a.note) {
                ctx.fillStyle = MUTED;
                ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(a.note, M.left, 76 * useDPR);
            }

            // ── glossary, one term at a time ──────────────────────────
            if (showGlossary) {
                const terms = glossary;
                // durationMs is guarded: if it ever arrives undefined the
                // arithmetic goes NaN, terms[NaN] is undefined, and reading
                // .acronym throws -- aborting draw() partway and leaving a
                // half-painted card.
                const dur = Number.isFinite(durationMs) && durationMs > 0
                    ? durationMs : 8000;
                const idx = Math.abs(Math.floor((t * dur) / TERM_MS)) % terms.length;
                const term = terms[idx] ?? terms[0];
                const gy = H - footH - glossH + 16 * useDPR;
                ctx.textAlign = "left";
                ctx.fillStyle = accent;
                ctx.font = `600 ${12.5 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(`${term.acronym} — ${term.full}`, M.left, gy);
                ctx.fillStyle = MUTED;
                ctx.font = `${11 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(term.plain, M.left, gy + 17 * useDPR);
            }

            // ── role legend ───────────────────────────────────────────
            const legendTop = H - footH + 16 * useDPR;
            ctx.font = `${LEGEND_PX}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "left";
            legendLines.forEach((line, li) => {
                let lx = M.left;
                const ly = legendTop + li * LEGEND_LINE_H;
                for (const it of line) {
                    ctx.fillStyle = ROLE_COLOUR[it.role];
                    ctx.fillRect(lx, ly - 9 * useDPR, 10 * useDPR, 10 * useDPR);
                    ctx.fillStyle = MUTED;
                    ctx.fillText(it.label, lx + 14 * useDPR, ly);
                    lx += it.w;
                }
            });
            const ly = legendTop + (legendLines.length - 1) * LEGEND_LINE_H;

            // The one honesty note the design requires. See the header.
            ctx.fillStyle = DEAD;
            ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "left";
            ctx.fillText("transit is not to scale; gap figures are real, * = model",
                         M.left, ly + 16 * useDPR);

            // ── the closing claim ─────────────────────────────────────
            if (t > 0.92) {
                const tot = fo.totals ?? {};
                ctx.textAlign = "right";
                ctx.font = `600 ${11 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillStyle = WARN;
                ctx.fillText(
                    fo.stage === 6
                        ? `${tot.journeyPacketCount} packets, ${tot.journeyOnAirBytes} B, `
                          + `${(tot.journeyElapsedUs / 1000).toFixed(0)} ms — for 2 bytes`
                        : `${N} packets, ${tot.stageOnAirBytes} B on air`,
                    W - M.right, ly + 16 * useDPR);
            }
        }

        draw(0);

        // ── THE OTHER HALF OF THE SAME BUG ──────────────────────────────
        // Math.min(1, e / durationMs) was doing the clamping, and it does
        // not clamp: with durationMs undefined or 0 the division is NaN or
        // Infinity, and Math.min PROPAGATES NaN instead of rejecting it.
        // draw() now sanitises its own argument, so this could be left as
        // it was -- but a renderer that hands its own draw function a NaN
        // and relies on the callee to notice is one refactor away from the
        // same crash, and the guarded duration is the same guard the
        // glossary block below already uses for the same reason.
        const sweepMs = Number.isFinite(durationMs) && durationMs > 0
                      ? durationMs : 8000;
        startSweepLoop(sampleId, durationMs, e => draw(e / sweepMs));
    },
});

})();