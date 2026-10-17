// ---------------------------------------------------------------------------
// filters/protocol_filter.js
//
// Recovers bytes from logic-level edges, for UART, SPI, I2C and CAN.
//
// THE SHAPE OF THE PROBLEM
//   This is Pan-Tompkins with square corners: a time series arrives, the
//   features are found, and the features are labelled. Nothing here knows
//   what the sender intended -- the encoder lives in Python on the server
//   and shares no code with this file -- so a decode that comes out right
//   is a genuine round trip rather than an agreement between two halves
//   of the same program.
//
//   That is also what makes the second stage honest. Decoding at the
//   wrong baud rate, or shifting in the wrong way round, produces
//   whatever those sampling instants actually land on. The garbage is
//   computed. None of it is authored.
//
// SAMPLING
//   Every decoder reads a line with levelAt(), which answers "the last
//   transition at or before t". That is what a logic analyser does and
//   what a receiver's input flip-flop does, and it is why the encoder
//   places data so that each protocol's designated sampling instant
//   falls in the middle of a valid window rather than on its edge.
//
// Self-registers into DSP_ALGORITHMS (dsp_registry.js must load first).
// ---------------------------------------------------------------------------

(function () {
"use strict";

// ── reading a line ───────────────────────────────────────────────────────

function lineOf(frame, id) {
    return (frame.lines ?? []).find(l => l.id === id);
}

function levelAt(line, t) {
    // Binary search rather than a scan: I2C at 100kHz over a two-byte
    // write is ~50 edges, but the renderer calls this per pixel per
    // frame, and a linear scan there is the difference between a smooth
    // sweep and a stuttering one.
    const e = line.edges;
    let lo = 0, hi = e.length - 1, ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (e[mid][0] <= t) { ans = e[mid][1]; lo = mid + 1; }
        else hi = mid - 1;
    }
    return ans;
}

/** Transitions to `level` strictly inside (t0, t1]. */
function edgesTo(line, level, t0, t1) {
    const out = [];
    for (let i = 1; i < line.edges.length; i++) {
        const [t, v] = line.edges[i];
        if (t > t0 && t <= t1 && v === level && line.edges[i - 1][1] !== level) {
            out.push(t);
        }
    }
    return out;
}

function bitsToByte(bits, lsbFirst) {
    let v = 0;
    bits.forEach((b, i) => {
        const shift = lsbFirst ? i : bits.length - 1 - i;
        v |= (b & 1) << shift;
    });
    return v;
}

const hex = v => "0x" + v.toString(16).toUpperCase().padStart(2, "0");
const printable = v => (v >= 32 && v < 127) ? String.fromCharCode(v) : null;


// ── UART ─────────────────────────────────────────────────────────────────

function decodeUart(frame, p) {
    const baud   = p.baud   ?? frame.params.baud;
    const parity = p.parity !== undefined ? p.parity : frame.params.parity;
    const stops  = p.stopBits ?? frame.params.stopBits ?? 1;
    const bit    = 1e6 / baud;
    const tx     = lineOf(frame, "tx");

    const steps = [], bytes = [], errors = [];
    let t = 0, guard = 0;

    while (t < frame.tEnd && guard++ < 64) {
        // The frame boundary is a falling edge out of idle, and that is
        // the ONLY synchronisation the protocol offers. Everything after
        // it is counted on the receiver's own clock, which is exactly
        // why a wrong baud rate is silent rather than loud.
        const fall = edgesTo(tx, 0, t, frame.tEnd)[0];
        if (fall === undefined) break;

        const sampleAt = k => fall + (1.5 + k) * bit;
        if (sampleAt(8 + (parity ? 1 : 0) + stops - 1) > frame.tEnd) break;

        steps.push({ id: `start@${fall.toFixed(1)}`, name: "Start bit",
                     kind: "start", lane: "tx",
                     t0: fall, t1: fall + bit, sampleAt: fall + 0.5 * bit,
                     note: "Falling edge — the only timing reference in the frame" });

        const bits = [];
        for (let k = 0; k < 8; k++) {
            const at = sampleAt(k);
            const v = levelAt(tx, at);
            bits.push(v);
            steps.push({ id: `d${k}@${fall.toFixed(1)}`, name: `D${k}`,
                         kind: "bit", lane: "tx", value: v, sampleAt: at,
                         t0: at - bit / 2, t1: at + bit / 2 });
        }
        const byte = bitsToByte(bits, true);   // UART is LSB first, always

        let k = 8;
        if (parity) {
            const at = sampleAt(k++);
            const got = levelAt(tx, at);
            const ones = bits.reduce((a, b) => a + b, 0);
            const want = parity === "even" ? (ones % 2) : 1 - (ones % 2);
            const ok = got === want;
            steps.push({ id: `p@${fall.toFixed(1)}`, name: `Parity (${parity})`,
                         kind: ok ? "parity" : "error", lane: "tx",
                         value: got, sampleAt: at,
                         t0: at - bit / 2, t1: at + bit / 2,
                         note: ok ? null : `expected ${want}, read ${got}` });
            if (!ok) errors.push(`parity error on ${hex(byte)}`);
        }

        const stopAt = sampleAt(k);
        const stopOk = levelAt(tx, stopAt) === 1;
        steps.push({ id: `stop@${fall.toFixed(1)}`, name: "Stop bit",
                     kind: stopOk ? "stop" : "error", lane: "tx",
                     sampleAt: stopAt,
                     t0: stopAt - bit / 2, t1: stopAt + bit / 2,
                     note: stopOk ? null : "line was low — framing error" });
        // A framing error is the symptom a wrong baud rate usually shows
        // FIRST, before anyone notices the bytes are wrong, because the
        // receiver's idea of where the stop bit lives has drifted into
        // the middle of the data.
        if (!stopOk) errors.push("framing error — stop bit was not high");

        bytes.push(byte);
        t = stopAt + bit / 2;
    }

    const text = bytes.map(printable).filter(Boolean).join("");
    return { steps, bytes, errors,
             summary: bytes.map(hex).join(" ") + (text ? `  “${text}”` : ""),
             readout: { Baud: baud, Format: `8${parity ? parity[0].toUpperCase() : "N"}${stops}` } };
}


// ── SPI ──────────────────────────────────────────────────────────────────

function decodeSpi(frame, p) {
    const cpol = p.cpol ?? frame.params.cpol;
    const cpha = p.cpha ?? frame.params.cpha;
    const lsbFirst = (p.bitOrder ?? frame.params.bitOrder ?? "msb") === "lsb";

    const cs = lineOf(frame, "cs"), sclk = lineOf(frame, "sclk");
    const mosi = lineOf(frame, "mosi"), miso = lineOf(frame, "miso");

    const tStart = edgesTo(cs, 0, 0, frame.tEnd)[0];
    const tStop  = tStart === undefined
        ? frame.tEnd : (edgesTo(cs, 1, tStart, frame.tEnd)[0] ?? frame.tEnd);
    if (tStart === undefined) {
        return { steps: [], bytes: [], errors: ["chip select never asserted"],
                 summary: "—", readout: {} };
    }

    // The leading edge is the first move AWAY from idle, which is what
    // CPOL decides. CPHA then picks which of the two edges in a period
    // is the sampling one. Both halves of that sentence matter: modes 0
    // and 3 both sample on a rising edge, which is why swapping them
    // looks like it ought to work.
    const leadingLevel = 1 - cpol;
    const sampleLevel  = cpha === 0 ? leadingLevel : cpol;
    const sampleTimes  = edgesTo(sclk, sampleLevel, tStart, tStop);

    const steps = [], outBits = [], inBits = [];
    const period = sampleTimes.length > 1
        ? sampleTimes[1] - sampleTimes[0] : 1;

    steps.push({ id: "cs", name: "CS asserted", kind: "start", lane: "cs",
                 t0: tStart, t1: tStart + period / 2, sampleAt: tStart,
                 note: "Frame boundary — the slave starts counting here" });

    sampleTimes.forEach((at, i) => {
        const o = levelAt(mosi, at), n = levelAt(miso, at);
        outBits.push(o); inBits.push(n);
        steps.push({ id: `clk${i}`, name: `Clock ${i + 1}`, kind: "bit",
                     lane: "mosi", value: o, sampleAt: at,
                     t0: at - period / 2, t1: at + period / 2,
                     note: i === 0
                        ? `Sampled on the ${sampleLevel === 1 ? "rising" : "falling"} edge`
                        : null });
    });

    const group = arr => {
        const out = [];
        for (let i = 0; i + 8 <= arr.length; i += 8) {
            out.push(bitsToByte(arr.slice(i, i + 8), lsbFirst));
        }
        return out;
    };
    const bytes = group(outBits), back = group(inBits);

    steps.push({ id: "csend", name: "CS released", kind: "stop", lane: "cs",
                 t0: tStop - period / 2, t1: tStop + period / 2, sampleAt: tStop });

    const errors = [];
    if (outBits.length % 8 !== 0) {
        errors.push(`${outBits.length} clocks — not a whole number of bytes`);
    }
    return { steps, bytes, errors,
             summary: `MOSI ${bytes.map(hex).join(" ")}   ·   MISO ${back.map(hex).join(" ")}`,
             readout: { Mode: `${cpol}${cpha}  (CPOL ${cpol}, CPHA ${cpha})`,
                        "Shift in": lsbFirst ? "LSB first" : "MSB first",
                        Clocks: outBits.length } };
}


// ── I2C ──────────────────────────────────────────────────────────────────

function decodeI2c(frame, p) {
    const scl = lineOf(frame, "scl"), sda = lineOf(frame, "sda");

    // START and STOP are the only two moments SDA is permitted to move
    // while SCL is high, which is precisely what makes them findable
    // without any clock counting.
    let tStart = null;
    for (let i = 1; i < sda.edges.length; i++) {
        const [t, v] = sda.edges[i];
        if (v === 0 && sda.edges[i - 1][1] === 1 && levelAt(scl, t - 1e-6) === 1) {
            tStart = t; break;
        }
    }
    if (tStart === null) {
        return { steps: [], bytes: [], errors: ["no START condition found"],
                 summary: "—", readout: {} };
    }

    const rises = edgesTo(scl, 1, tStart, frame.tEnd);
    const period = rises.length > 1 ? rises[1] - rises[0] : 1;

    const steps = [{ id: "start", name: "START", kind: "start", lane: "sda",
                     t0: tStart - period / 4, t1: tStart + period / 4,
                     sampleAt: tStart,
                     note: "SDA falls while SCL is high" }];

    const bytes = [], errors = [];
    let address = null, rw = null, stopped = false;

    for (let b = 0; b * 9 + 8 < rises.length + 1; b++) {
        const slice = rises.slice(b * 9, b * 9 + 9);
        if (slice.length < 9) break;

        const bits = [];
        for (let k = 0; k < 8; k++) {
            const at = slice[k];
            const v = levelAt(sda, at);
            bits.push(v);
            const isAddr = b === 0;
            steps.push({
                id: `b${b}k${k}`,
                name: isAddr ? (k < 7 ? `A${6 - k}` : "R/W") : `D${7 - k}`,
                kind: isAddr ? "addr" : "data", lane: "sda",
                value: v, sampleAt: at,
                t0: at - period / 2, t1: at + period / 2,
                note: (isAddr && k === 7)
                    ? (v ? "read" : "write") + " — the direction is a BIT, not a wire"
                    : null });
        }

        // Ninth clock: the master lets go and the addressed device pulls
        // SDA down. Low is ACK. Nobody there, nobody pulls, the line
        // floats high -- so a NACK is not a signal, it is the absence of
        // one, which is why a missing device looks identical to a broken
        // solder joint.
        const ackAt = slice[8];
        const ack = levelAt(sda, ackAt);
        const acked = ack === 0;
        steps.push({ id: `ack${b}`, name: acked ? "ACK" : "NACK",
                     kind: acked ? "ack" : "nack", lane: "sda",
                     value: ack, sampleAt: ackAt,
                     t0: ackAt - period / 2, t1: ackAt + period / 2,
                     note: acked ? "device pulled SDA low"
                                 : "nobody pulled SDA low" });

        if (b === 0) {
            address = bitsToByte(bits.slice(0, 7), false);
            rw = bits[7];
        } else {
            bytes.push(bitsToByte(bits, false));
        }
        if (!acked) {
            errors.push(b === 0
                ? `no device acknowledged at ${hex(address)}`
                : "device stopped acknowledging mid-transfer");
            stopped = true;
            break;
        }
    }

    const last = steps[steps.length - 1];
    steps.push({ id: "stop", name: "STOP", kind: "stop", lane: "sda",
                 t0: last.t1, t1: last.t1 + period / 2,
                 sampleAt: last.t1 + period / 4,
                 note: stopped ? "master gives up and releases the bus"
                               : "SDA rises while SCL is high" });

    const dir = rw ? "read" : "write";
    return { steps, bytes, errors,
             summary: address === null ? "—"
                : `${hex(address)} ${dir}` +
                  (bytes.length ? `  ${bytes.map(hex).join(" ")}` : "") +
                  (stopped ? "  (aborted)" : ""),
             readout: { Address: address === null ? "—" : hex(address),
                        Direction: dir,
                        Bytes: bytes.length } };
}


// ── CAN ──────────────────────────────────────────────────────────────────

function decodeCan(frame, p) {
    const log = frame.params.bitLog ?? [];
    const nodes = frame.params.nodes ?? [];
    const bit = 1e6 / frame.params.bitrate;
    const t0 = (frame.lines[0].edges[1] ?? [0])[0];
    const idOf = i => nodes[i].id;

    const n = nodes.length;
    const seqs = [];
    for (let i = 0; i < n; i++) {
        const bits = [0];                       // SOF is always dominant
        for (let k = 10; k >= 0; k--) bits.push((idOf(i) >> k) & 1);
        seqs.push(bits);
    }

    const active = new Array(n).fill(true);
    const steps = [];
    const errors = [];
    let winner = null, lostAt = null;

    for (let i = 0; i < seqs[0].length; i++) {
        const intents = seqs.map((s, k) => active[k] ? s[i] : 1);
        // Wired-AND. One dominant transmitter is enough to hold the whole
        // bus down, which is the entire mechanism in one line.
        const busLevel = intents.some(v => v === 0) ? 0 : 1;

        const losers = [];
        for (let k = 0; k < n; k++) {
            if (active[k] && intents[k] === 1 && busLevel === 0) {
                active[k] = false;
                losers.push(k);
            }
        }

        const at = t0 + i * bit;
        steps.push({
            id: `bit${i}`,
            name: i === 0 ? "SOF" : `ID bit ${11 - i}`,
            kind: i === 0 ? "start" : (losers.length ? "lose" : "bit"),
            lane: "bus", value: busLevel, sampleAt: at + bit / 2,
            t0: at, t1: at + bit,
            intents, losers,
            note: losers.length
                ? `${nodes[losers[0]].label.split(" ·")[0]} sent recessive, read dominant — it stops here`
                : (i === 0 ? "Everyone starts together" : null) });

        if (losers.length && lostAt === null) lostAt = i;
    }

    const stillUp = active.map((a, i) => a ? i : -1).filter(i => i >= 0);
    const wIdx = stillUp.length ? stillUp[0] : null;

    // The winner is a NODE, not an identifier. Swapping the two ids
    // leaves the LOWER id winning either way -- the first version of
    // this reported that unchanged id and concluded, wrongly, that
    // nothing had happened. What moves is which box gets to talk, and
    // that is the actual lesson: priority on a CAN bus belongs to the
    // message, never to the device holding it.
    const winnerId = wIdx === null ? null : idOf(wIdx);
    const winnerLabel = wIdx === null ? null : nodes[wIdx].label;

    return { steps, bytes: [], errors,
             summary: wIdx === null ? "—"
                : `${winnerLabel} wins — 0x${winnerId.toString(16).toUpperCase()}` +
                  (lostAt === null ? "" : `, decided at bit ${lostAt}`),
             readout: {
                 Winner: winnerLabel ?? "—",
                 "Its id": winnerId === null ? "—" : "0x" + winnerId.toString(16).toUpperCase(),
                 "Decided at": lostAt === null ? "—" : `bit ${lostAt} of 11`,
                 Retransmits: "none — the winner's frame is never interrupted" },
             winnerNode: wIdx, winnerId,
             nodes: nodes.map((nd, i) => ({ ...nd, id: idOf(i) })),
             arbitration: true };
}


// ── perturbations ────────────────────────────────────────────────────────
// Each frame names its own failure, the way each pathway names its own
// regulated step: one stage, a different lesson per card.

function perturbedFrame(frame) {
    // A world perturbation carries its own encoded waveform, so the
    // drawing and the decode can never disagree -- which they did while
    // the NACK and the identifier swap were faked inside the decoders,
    // leaving a trace showing an ACK beside a readout reporting a NACK.
    const pert = frame.perturbation ?? {};
    if (pert.mode !== "world") return frame;
    return { ...frame, lines: pert.lines, tEnd: pert.tEnd,
             params: pert.params, expect: pert.expect ?? frame.expect };
}

function perturbedParams(frame, params) {
    // A receiver perturbation leaves the wire alone and misconfigures the
    // listener. Nothing is re-encoded; the picture stays identical, which
    // is the entire point of those cards.
    const p = { ...params };
    const pert = frame.perturbation ?? {};
    if (pert.mode === "receiver") {
        switch (pert.kind) {
            case "baud":     p.baud = pert.baud;         break;
            case "parity":   p.parity = pert.parity;     break;
            case "bitOrder": p.bitOrder = pert.bitOrder; break;
        }
    }
    p.__note = pert.note ?? null;
    return p;
}


const DECODERS = { uart: decodeUart, spi: decodeSpi, i2c: decodeI2c, can: decodeCan };

const DEFAULT_VOCAB = {
    node: "line", edge: "bit", edges: "bits",
    side: "field", sides: "fields", chain: "frame", cycle: "loop",
};


registerDspAlgorithm("protocol", {

    // Condition controls built from the frame itself, so a SPI card gets
    // a Mode button and a UART card does not -- rather than every card
    // carrying a control that five of them ignore.
    choices(envelope) {
        const f = envelope?.meta?.frame;
        if (!f) return [];
        if (f.protocol === "spi") {
            return [{ key: "bitOrder", label: "Shift", value: "msb",
                      values: ["msb", "lsb"],
                      display: { msb: "MSB first", lsb: "LSB first" } }];
        }
        if (f.protocol === "uart") {
            const real = f.params.baud;
            return [{ key: "baud", label: "Receiver", value: real,
                      values: [real, real * 2],
                      display: { [real]: `${real} baud`, [real * 2]: `${real * 2} baud` } }];
        }
        return [];
    },

    process(data, params = {}) {
        const declared = data?.meta?.frame;
        if (!declared) return { error: "no frame in meta.frame" };
        const decode = DECODERS[declared.protocol];
        if (!decode) return { error: `no decoder for "${declared.protocol}"` };

        const frame = params.perturb ? perturbedFrame(declared) : declared;
        const p = params.perturb ? perturbedParams(declared, params)
                                 : { ...params };
        let r;
        try {
            r = decode(frame, p);
        } catch (e) {
            return { error: `decode failed: ${e.message}` };
        }

        // The verdict is computed by COMPARING, never by trusting. The
        // decoder never saw `expect`; it is read here, after the fact,
        // only to mark the answer right or wrong.
        let verdict = null;
        const exp = frame.expect;
        if (exp) {
            if (exp.bytes) {
                const match = r.bytes.length === exp.bytes.length &&
                              r.bytes.every((b, i) => b === exp.bytes[i]);
                // Errors fail the decode even when the bytes came out
                // right. A parity mismatch delivers perfectly good data
                // that the receiver then throws away, and calling that a
                // success would teach the opposite of the lesson.
                verdict = { ok: match && r.errors.length === 0,
                            expected: exp.bytes.map(hex).join(" "),
                            why: match && r.errors.length
                                 ? "bytes correct, but the receiver rejected them"
                                 : null };
            } else if (exp.winnerNode !== undefined) {
                verdict = { ok: r.winnerNode === exp.winnerNode,
                            expected: (frame.params.nodes[exp.winnerNode] ?? {}).label };
            }
        }

        return {
            interimOutputs: r.steps.map(s => ({
                label: s.name, kind: s.kind, value: s.value ?? null })),
            finalOutput: {
                protocol: frame.protocol,
                name: frame.name,
                blurb: frame.blurb,
                lines: frame.lines,
                tEnd: frame.tEnd,
                steps: r.steps,
                stepCount: r.steps.length,
                bytes: r.bytes,
                summary: r.summary,
                readout: r.readout,
                errors: r.errors,
                nodes: r.nodes ?? null,
                arbitration: !!r.arbitration,
                perturbed: !!params.perturb,
                perturbNote: p.__note,
                verdict,
                vocabulary: { ...DEFAULT_VOCAB, ...(frame.vocabulary ?? {}) },
            },
        };
    },
});

// Exported for the round-trip test, which runs this file under node with
// no browser and no registry. Harmless in the browser.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { DECODERS, perturbedFrame, perturbedParams, levelAt, lineOf };
}

})();
