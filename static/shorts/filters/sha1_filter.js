// ---------------------------------------------------------------------------
// filters/sha1_filter.js
//
// SHA-1, captured round by round.
//
// WHY SHA-1 AFTER AES AND THE SPN
//   Those two are CIPHERS -- reversible, key-driven, output the same size
//   as the input. SHA-1 is a HASH: no key, no inverse, and any input
//   length collapses to exactly 160 bits. Placing it beside them is the
//   point. The machinery looks similar (rounds, rotations, constants) but
//   the goal is the opposite: a cipher must be undoable by the key
//   holder, a hash must be undoable by nobody.
//
// THE STRUCTURE
//   pad        message -> 512-bit blocks, length appended
//   schedule   16 words -> 80, by XOR and rotate
//   80 rounds  in four groups of 20, each with its own mix function and
//              constant: Ch, Parity, Maj, Parity
//   add        the five working words fold back into the running digest
//
// WHY FOUR GROUPS MATTER
//   The function changes every 20 rounds -- Ch (choose), Parity (XOR),
//   Maj (majority), Parity again. Watching the state cross those
//   boundaries is the clearest thing this journey shows: the same five
//   words, processed four different ways.
//
// A NOTE ON SHA-1's STATUS
//   Broken for collision resistance since 2017 (SHAttered). Kept here
//   BECAUSE it is broken and small: it teaches the Merkle-Damgard shape
//   that SHA-256 still uses, without implying anyone should deploy it.
//   The journey says so on screen.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped -- filter files share
// one global scope.
// ---------------------------------------------------------------------------

(function () {
"use strict";

const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
const hex8 = x => (x >>> 0).toString(16).padStart(8, "0");
const bits32 = x => Array.from({length: 32}, (_, i) => (x >>> (31 - i)) & 1);

// Merkle-Damgard padding: a 1 bit, zeros, then the ORIGINAL length as a
// 64-bit big-endian count of BITS. Appending the length is what stops
// two different messages sharing a padded form.
function padMessage(bytes) {
    const bitLen = bytes.length * 8;
    const out = Array.from(bytes);
    out.push(0x80);
    while (out.length % 64 !== 56) out.push(0x00);
    // JS bitwise ops are 32-bit, so the high word is computed by division
    // rather than shifting -- a >>> 32 would silently be a no-op.
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    for (let i = 3; i >= 0; i--) out.push((hi >>> (i * 8)) & 0xff);
    for (let i = 3; i >= 0; i--) out.push((lo >>> (i * 8)) & 0xff);
    return out;
}

const GROUPS = [
    { from: 0,  to: 19, name: "Ch",     k: 0x5A827999,
      note: "choose: bits of c or d, selected by b" },
    { from: 20, to: 39, name: "Parity", k: 0x6ED9EBA1,
      note: "parity: b XOR c XOR d" },
    { from: 40, to: 59, name: "Maj",    k: 0x8F1BBCDC,
      note: "majority: whichever bit value appears twice" },
    { from: 60, to: 79, name: "Parity", k: 0xCA62C1D6,
      note: "parity again, with a different constant" },
];

function mixFor(i, b, c, d) {
    if (i < 20) return ((b & c) | (~b & d)) >>> 0;
    if (i < 40) return (b ^ c ^ d) >>> 0;
    if (i < 60) return ((b & c) | (b & d) | (c & d)) >>> 0;
    return (b ^ c ^ d) >>> 0;
}

function makeRecorder() {
    const captures = [];
    return {
        captures,
        push(label, tech, depth, parent, words, extra = {}) {
            captures.push({
                label, tech, depth, parent,
                words: Array.from(words),
                hex:   Array.from(words).map(hex8),
                bits:  Array.from(words).map(bits32),
                ...extra,
            });
        },
    };
}

function sha1(bytes, rec) {
    let h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];

    rec.push("Initial state",
             "five constants, fixed by the standard",
             1, "hash", h);

    const padded = padMessage(bytes);
    const blocks = padded.length / 64;

    for (let blk = 0; blk < blocks; blk++) {
        const off = blk * 64;

        // Message schedule: 16 words from the block, extended to 80 by
        // XOR-and-rotate. Every later round therefore depends on the
        // whole block, not just its own 32 bits.
        const w = new Uint32Array(80);
        for (let i = 0; i < 16; i++) {
            w[i] = ((padded[off+4*i] << 24) | (padded[off+4*i+1] << 16) |
                    (padded[off+4*i+2] << 8) | padded[off+4*i+3]) >>> 0;
        }
        for (let i = 16; i < 80; i++) {
            w[i] = rotl(w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16], 1);
        }

        rec.push(`Schedule (block ${blk + 1})`,
                 "16 message words expanded to 80",
                 1, "hash", w.slice(0, 5),
                 { schedule: Array.from(w).map(hex8), block: blk });

        let [a, b, c, d, e] = h;

        for (const g of GROUPS) {
            const parent = `${g.name} \u00b7 rounds ${g.from + 1}-${g.to + 1}`;

            for (let i = g.from; i <= g.to; i++) {
                const f    = mixFor(i, b, c, d);
                const temp = (rotl(a, 5) + f + e + g.k + w[i]) >>> 0;
                e = d; d = c; c = rotl(b, 30); b = a; a = temp;

                // Only the first round of each group is shown in full;
                // the other 19 are structurally identical, so they carry
                // repeatRole "repeat" and a renderer can compress them.
                rec.push(`Round ${i + 1}`,
                         `${g.name}, K = ${hex8(g.k)}`,
                         2, parent, [a, b, c, d, e],
                         { round: i + 1, group: g.name, w: hex8(w[i]),
                           repeatRole: i === g.from ? "exemplar" : "repeat" });
            }

            rec.push(parent, g.note, 1, "hash", [a, b, c, d, e],
                     { group: g.name });
        }

        // The fold-back. Adding rather than replacing is what makes this
        // one-way: the previous digest is mixed in and cannot be peeled
        // off again.
        h = [ (h[0]+a)>>>0, (h[1]+b)>>>0, (h[2]+c)>>>0,
              (h[3]+d)>>>0, (h[4]+e)>>>0 ];

        rec.push(`Block ${blk + 1} folded in`,
                 "working words ADDED to the digest, not copied over",
                 1, "hash", h, { block: blk });
    }

    return h;
}


registerDspAlgorithm("sha1_hash", {
    process(envelope, parameters) {
        const msg = envelope.arrays?.message;
        if (!msg) {
            return { error: "sha1_hash needs arrays.message (the bytes to hash)." };
        }

        const bytes = Array.from(msg);
        const rec   = makeRecorder();
        const h     = sha1(bytes, rec);
        const digest = h.map(hex8).join("");

        rec.push("Digest", "160 bits, whatever the input length was",
                 1, "hash", h, { digest });

        // Avalanche, measured rather than asserted: flip one bit of the
        // message and count how many of the 160 output bits move. A
        // healthy hash gives about 80.
        let flipped = 0;
        if (bytes.length > 0) {
            const alt = bytes.slice();
            alt[0] ^= 1;
            const h2 = sha1(alt, makeRecorder());
            for (let i = 0; i < 5; i++) {
                let x = (h[i] ^ h2[i]) >>> 0;
                while (x) { flipped += x & 1; x >>>= 1; }
            }
        }

        return {
            interimOutputs: rec.captures,
            finalOutput: {
                digest,
                digestWords:   h,
                messageBytes:  bytes.length,
                blocks:        padMessage(bytes).length / 64,
                avalancheBits: flipped,
                rounds:        80,
            },
        };
    },
});

if (typeof module !== "undefined" && module.exports) {
    module.exports = { sha1, padMessage, makeRecorder, hex8, rotl };
}

})();
