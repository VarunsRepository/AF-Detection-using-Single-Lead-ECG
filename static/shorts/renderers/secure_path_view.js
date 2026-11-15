// ---------------------------------------------------------------------------
// static/shorts/renderers/secure_path_view.js
//
// Four views of one journey, chosen by config.view:
//
//   cipher     the bytes as they sit on the CDN -- noise, with the key
//              and counter printed so anyone can reproduce them
//   pipeline   seven steps from CDN to panel, a frame travelling them,
//              each step coloured by whether the OS can read that memory
//   grab       the same pipeline with the screenshot probe fired, and
//              what it actually came back with
//   table      the published resolution caps, this row lit
//
// Canvas 2D throughout. The pipeline is boxes and a moving token -- SVG
// would be fine too, but the sweep wants a redraw every frame and canvas
// is already what every other renderer here uses.
// ---------------------------------------------------------------------------

(function () {
"use strict";

const COL = {
    open:    "#e05260",   // the OS can read this memory
    sealed:  "#2edac4",   // it cannot
    cipher:  "#7e8e9e",   // readable, but meaningless
    dim:     "#5a6572",
    text:    "#d8dee9",
    faint:   "#9aa4b0",
    grid:    "rgba(116,125,140,0.16)",
    panel:   "rgba(22,27,34,0.92)",
    edge:    "rgba(255,255,255,0.14)",
};

// A stage's colour is its ANSWER, not its name: can a capture read this.
function stageColour(s) {
    if (!s.readable) return COL.sealed;
    if (s.holds === "cipher") return COL.cipher;
    return COL.open;
}

function px(ctx, dpr) { return (n) => Math.round(n * dpr); }

// ── small helpers ────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
}

// Draws a Float32Array of 0-255 greyscale as an image. `mode` lets the
// same function draw the frame, the ciphertext and a black capture --
// which keeps the three visually comparable, which is the point.
function drawBytes(ctx, bytes, w, h, dx, dy, dw, dh, mode) {
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const id = off.getContext("2d").createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        let v;
        if (mode === "black")      v = 0;
        else if (!bytes)           v = 0;
        else                       v = Math.max(0, Math.min(255, bytes[i] | 0));
        id.data[i * 4]     = v;
        id.data[i * 4 + 1] = v;
        id.data[i * 4 + 2] = v;
        id.data[i * 4 + 3] = 255;
    }
    off.getContext("2d").putImageData(id, 0, 0);
    ctx.imageSmoothingEnabled = false;   // the pixels ARE the content
    ctx.drawImage(off, dx, dy, dw, dh);
}

// Shrinks to fit, then truncates. The first version simply drew at a
// computed size and "Media buffer" ran straight out of its box -- which
// reads as a broken renderer rather than a tight layout.
function fitLabel(ctx, text, cx, y, size, colour, maxW) {
    let s = size;
    ctx.font = `${s}px "IBM Plex Mono", ui-monospace, monospace`;
    while (ctx.measureText(text).width > maxW && s > 7) {
        s -= 0.5;
        ctx.font = `${s}px "IBM Plex Mono", ui-monospace, monospace`;
    }
    let t = text;
    while (ctx.measureText(t).width > maxW && t.length > 2) {
        t = t.slice(0, -1);
    }
    if (t !== text && t.length > 1) t = t.slice(0, -1) + "\u2026";
    ctx.fillStyle = colour;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(t, cx, y);
    ctx.textAlign = "left";
}

function label(ctx, text, x, y, size, colour, align) {
    ctx.font = `${size}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillStyle = colour;
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
}

// ── the views ────────────────────────────────────────────────────────────

function viewCipher(ctx, W, H, D, fo, progress) {
    const S = Math.min(W * 0.78, H * 0.46);
    const x = (W - S) / 2, y = H * 0.16;

    // The reveal is the sweep: more of the file has "arrived" as it runs.
    const shown = Math.max(0.04, progress);
    const rows  = Math.max(1, Math.round(fo.frameH * shown));
    const slice = fo.cipher ? fo.cipher.subarray(0, rows * fo.frameW) : null;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x, y, S, S * (fo.frameH / fo.frameW));
    if (slice) {
        drawBytes(ctx, slice, fo.frameW, rows,
                  x, y, S, S * (rows / fo.frameW), "grey");
    }

    ctx.strokeStyle = COL.edge;
    ctx.lineWidth = 1 * D;
    ctx.strokeRect(x, y, S, S * (fo.frameH / fo.frameW));

    const by = y + S * (fo.frameH / fo.frameW) + 30 * D;
    label(ctx, "AES-128-CTR", x, by, 15 * D, COL.cipher);
    label(ctx, `key   ${fo.keyHex}`,   x, by + 22 * D, 12 * D, COL.faint);
    label(ctx, `nonce ${fo.nonceHex}`, x, by + 40 * D, 12 * D, COL.faint);
    label(ctx, `${(fo.cipher ? fo.cipher.length : 0)} bytes · reproducible`,
          x, by + 62 * D, 12 * D, COL.dim);
}

// Seven boxes. Narrow screens stack them two deep rather than shrinking
// the type -- a 48px label is unreadable long before the layout breaks.
function pipelineLayout(W, H, D, n, bottomReserve) {
    const avail = H - (bottomReserve || 0);
    const twoRow = W < 520 * D;
    const perRow = twoRow ? Math.ceil(n / 2) : n;
    const padX   = 14 * D;
    const bw     = (W - padX * 2 - (perRow - 1) * 8 * D) / perRow;
    const bh     = Math.min(70 * D, avail * 0.2);
    const gapY   = bh + 34 * D;
    const block  = twoRow ? bh + gapY : bh;
    // Centred in what is LEFT once the result panel has taken its room.
    const y0     = Math.max(34 * D, (avail - block) / 2 + 14 * D);
    return { twoRow, perRow, padX, bw, bh, y0, gapY,
             box(i) {
                 const r = twoRow && i >= perRow ? 1 : 0;
                 const c = r ? i - perRow : i;
                 return { x: padX + c * (bw + 8 * D), y: y0 + r * gapY,
                          w: bw, h: bh, row: r };
             } };
}

function viewPipeline(ctx, W, H, D, fo, progress, showGrab) {
    const P = fo.pipeline;
    const panelH = showGrab && fo.grab
        ? Math.min(132 * D, H * 0.3) + 16 * D
        : 34 * D;                               // just the key
    const L = pipelineLayout(W, H, D, P.length, panelH);

    // Where the frame has got to. The token moves continuously so the
    // eye follows it between boxes rather than teleporting.
    const at = progress * (P.length - 1);

    for (let i = 0; i < P.length; i++) {
        const s = P[i], b = L.box(i);
        const reached = at >= i - 0.5;
        const c = stageColour(s);

        ctx.globalAlpha = reached ? 1 : 0.32;

        roundRect(ctx, b.x, b.y, b.w, b.h, 8 * D);
        ctx.fillStyle = COL.panel;
        ctx.fill();
        ctx.strokeStyle = s.probed && showGrab ? "#ffffff" : c;
        ctx.lineWidth = (s.probed && showGrab ? 2.4 : 1.4) * D;
        ctx.stroke();

        // A filled bar along the top edge says, at a glance and without
        // reading, whether this memory is open.
        ctx.fillStyle = c;
        roundRect(ctx, b.x, b.y, b.w, 4 * D, 2 * D);
        ctx.fill();

        const cx = b.x + b.w / 2;
        const inner = b.w - 16 * D;      // room for the lock/eye glyph
        fitLabel(ctx, s.label, cx, b.y + b.h / 2 + 2 * D, 12 * D,
                 COL.text, inner);
        fitLabel(ctx, s.where, cx, b.y + b.h / 2 + 17 * D, 9.5 * D,
                 COL.faint, inner);

        // Lock or eye, drawn rather than a glyph font: one shape, two
        // states, legible at 10px.
        const ix = b.x + b.w - 11 * D, iy = b.y + 14 * D;
        ctx.strokeStyle = c; ctx.lineWidth = 1.4 * D;
        if (!s.readable) {
            ctx.strokeRect(ix - 4 * D, iy - 1 * D, 8 * D, 6 * D);
            ctx.beginPath();
            ctx.arc(ix, iy - 1 * D, 2.6 * D, Math.PI, 0);
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.ellipse(ix, iy + 2 * D, 5 * D, 3 * D, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(ix, iy + 2 * D, 1.4 * D, 0, Math.PI * 2);
            ctx.fillStyle = c; ctx.fill();
        }
        ctx.globalAlpha = 1;

        // connector
        if (i < P.length - 1 && !(L.twoRow && i === L.perRow - 1)) {
            const nb = L.box(i + 1);
            ctx.strokeStyle = COL.dim;
            ctx.lineWidth = 1 * D;
            ctx.beginPath();
            ctx.moveTo(b.x + b.w, b.y + b.h / 2);
            ctx.lineTo(nb.x, nb.y + nb.h / 2);
            ctx.stroke();
        }
    }

    // The travelling frame.
    const i0 = Math.max(0, Math.min(P.length - 1, Math.floor(at)));
    const i1 = Math.min(P.length - 1, i0 + 1);
    const t  = at - i0;
    const b0 = L.box(i0), b1 = L.box(i1);
    const tx = b0.x + b0.w / 2 + (b1.x + b1.w / 2 - (b0.x + b0.w / 2)) * t;
    const ty = b0.y + (b1.y - b0.y) * t - 20 * D;
    const tokSize = 15 * D;
    const holds = P[i0].holds;
    ctx.save();
    ctx.shadowColor = stageColour(P[i0]);
    ctx.shadowBlur = 10 * D;
    if (holds === "cipher" && fo.cipher) {
        drawBytes(ctx, fo.cipher.subarray(0, 64), 8, 8,
                  tx - tokSize / 2, ty - tokSize / 2, tokSize, tokSize, "grey");
    } else if (holds === "placeholder") {
        ctx.fillStyle = "#000";
        ctx.fillRect(tx - tokSize / 2, ty - tokSize / 2, tokSize, tokSize);
        ctx.strokeStyle = COL.sealed; ctx.lineWidth = 1.2 * D;
        ctx.strokeRect(tx - tokSize / 2, ty - tokSize / 2, tokSize, tokSize);
    } else if (fo.frame) {
        drawBytes(ctx, fo.frame, fo.frameW, fo.frameH,
                  tx - tokSize / 2, ty - tokSize * 0.28, tokSize,
                  tokSize * (fo.frameH / fo.frameW), "grey");
    }
    ctx.restore();

    if (showGrab && fo.grab) drawGrabResult(ctx, W, H, D, fo, L);
    else drawKey(ctx, W, H, D, fo);
}

function drawKey(ctx, W, H, D, fo) {
    const y = H - 26 * D;
    const items = [["open", "readable"], ["cipher", "encrypted"],
                   ["sealed", "sealed"]];
    let x = 14 * D;
    for (const [k, t] of items) {
        ctx.fillStyle = COL[k];
        ctx.fillRect(x, y - 7 * D, 9 * D, 9 * D);
        label(ctx, t, x + 14 * D, y, 10.5 * D, COL.faint);
        x += ctx.measureText(t).width + 34 * D;
    }
    label(ctx, fo.isForced ? `forced: ${fo.pathShown}` : fo.pathShown,
          W - 14 * D, y, 10.5 * D, COL.dim, "right");
}

// What the capture actually returned, drawn as an image so the three
// outcomes are comparable rather than described.
function drawGrabResult(ctx, W, H, D, fo, L) {
    const g = fo.grab;
    const h = Math.min(132 * D, H * 0.3);
    const y = H - h - 8 * D;
    roundRect(ctx, 10 * D, y, W - 20 * D, h, 10 * D);
    ctx.fillStyle = "rgba(10,12,16,0.95)";
    ctx.fill();
    ctx.strokeStyle = COL.edge; ctx.lineWidth = 1 * D;
    ctx.stroke();

    const thumb = Math.min(h - 26 * D, 76 * D);
    const tx = 22 * D, ty = y + (h - thumb * (fo.frameH / fo.frameW)) / 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(tx, ty, thumb, thumb * (fo.frameH / fo.frameW));
    if (g.result === "frame")      drawBytes(ctx, fo.frame,  fo.frameW, fo.frameH, tx, ty, thumb, thumb * (fo.frameH / fo.frameW), "grey");
    else if (g.result === "noise") drawBytes(ctx, fo.cipher, fo.frameW, fo.frameH, tx, ty, thumb, thumb * (fo.frameH / fo.frameW), "grey");
    else {
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1 * D;
        ctx.strokeRect(tx, ty, thumb, thumb * (fo.frameH / fo.frameW));
    }

    const lx = tx + thumb + 18 * D;
    const verdict = { frame: "the frame", noise: "ciphertext",
                      black: "black", blocked: "nothing" }[g.result];
    label(ctx, `grab @ ${g.label} → ${verdict}`, lx, y + 26 * D,
          13 * D, g.result === "frame" ? COL.open : COL.sealed);

    // wrap the note
    ctx.font = `${10.5 * D}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillStyle = COL.faint;
    const maxw = W - lx - 20 * D;
    let line = "", yy = y + 46 * D;
    for (const word of (g.note || "").split(" ")) {
        const test = line ? line + " " + word : word;
        if (ctx.measureText(test).width > maxw) {
            ctx.fillText(line, lx, yy); yy += 14 * D; line = word;
            if (yy > y + h - 10 * D) break;
        } else line = test;
    }
    if (line && yy <= y + h - 8 * D) ctx.fillText(line, lx, yy);
}

function viewTable(ctx, W, H, D, fo, progress) {
    const rows = fo.table || [];
    const top = H * 0.14;
    const rh = Math.min(34 * D, (H * 0.68) / Math.max(1, rows.length));
    const x0 = 14 * D, x1 = W - 14 * D;

    label(ctx, "BROWSER / OS", x0, top - 10 * D, 10 * D, COL.dim);
    label(ctx, "MAX", x1 - 86 * D, top - 10 * D, 10 * D, COL.dim, "right");
    label(ctx, "PATH", x1, top - 10 * D, 10 * D, COL.dim, "right");

    const shown = Math.ceil(progress * rows.length);
    rows.forEach((r, i) => {
        if (i >= shown) return;
        const y = top + i * rh;
        const mine = r.browser === fo.row.browser && r.os === fo.row.os;
        const hw = r.path === "hardware";

        if (mine) {
            ctx.fillStyle = "rgba(46,218,196,0.10)";
            ctx.fillRect(x0 - 6 * D, y, x1 - x0 + 12 * D, rh - 3 * D);
        }
        ctx.strokeStyle = COL.grid; ctx.lineWidth = 1 * D;
        ctx.beginPath();
        ctx.moveTo(x0, y + rh - 2 * D); ctx.lineTo(x1, y + rh - 2 * D);
        ctx.stroke();

        const fs = Math.min(12.5 * D, rh * 0.46);
        label(ctx, `${r.browser} · ${r.os}`, x0, y + rh * 0.62, fs,
              mine ? COL.text : COL.faint);
        label(ctx, `${r.maxRes}p`, x1 - 86 * D, y + rh * 0.62, fs,
              hw ? COL.sealed : COL.cipher, "right");
        label(ctx, hw ? "hardware" : "software", x1, y + rh * 0.62,
              fs * 0.85, hw ? COL.sealed : COL.open, "right");
    });

    label(ctx, fo.source, x0, H - 14 * D, 9.5 * D, COL.dim);
}

// ── registration ─────────────────────────────────────────────────────────

registerRenderingAlgorithm("secure_path_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }
        const fo = dspOutput.finalOutput;
        if (!fo || !Array.isArray(fo.pipeline)) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">secure_path_view: nothing to draw.</p>`;
            return;
        }

        const view = config?.view || "pipeline";
        const D = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;

        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);

        const iw = container.offsetWidth || 390;
        const ih = container.offsetHeight || 420;
        canvas.width  = Math.round(iw * D);
        canvas.height = Math.round(ih * D);
        canvas.style.width = iw + "px";
        canvas.style.height = ih + "px";

        function drawAtElapsed(elapsed) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            const progress = Math.min(1, Math.max(0, elapsed / durationMs));
            ctx.clearRect(0, 0, W, H);

            if (view === "cipher")      viewCipher(ctx, W, H, D, fo, progress);
            else if (view === "table")  viewTable(ctx, W, H, D, fo, progress);
            else if (view === "grab")   viewPipeline(ctx, W, H, D, fo, progress, true);
            else                        viewPipeline(ctx, W, H, D, fo, progress, false);
        }

        // RESIZING A CANVAS CLEARS IT. With the sweep running the next
        // frame repaints and nobody notices; with it cancelled -- a
        // paused card, which is every rail-button press while paused --
        // nothing repaints and the card goes black. Measured elsewhere in
        // this project: 15,051 lit pixels to 0, two frames later.
        new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            if (!width || !height) return;
            canvas.width  = Math.round(width * D);
            canvas.height = Math.round(height * D);
            canvas.style.width = width + "px";
            canvas.style.height = height + "px";
            const ctl = activeSweepControl.get(sampleId);
            if (ctl) ctl.drawFn(ctl.lastElapsedMs ?? 0);
        }).observe(container);

        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});

})();
