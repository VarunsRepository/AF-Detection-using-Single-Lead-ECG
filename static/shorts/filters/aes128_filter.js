// ---------------------------------------------------------------------------
// filters/aes128_filter.js
//
// AES-128 encryption as a DSPE. Ported from the user's tested C++
// (AES_CORE.cpp), which used SSE/SIMD intrinsics -- replaced here with
// plain byte loops. The logic is identical; AES on 16 bytes is fast
// enough that SIMD buys nothing in a browser.
//
// WHAT WAS PORTED, AND WHAT WASN'T
//   The C++ was ALREADY INSTRUMENTED -- every capture point needed is
//   present there as a print_m128i_lanes() call with a hand-chosen
//   label. Those labels are reproduced verbatim below. The port swaps
//   the SINK (cout -> capture array); it does not add capture points,
//   because the judgement about which states matter was already made by
//   someone who understands AES.
//
// BYTE ORDER -- verified, not assumed
//   FIPS-197 state is COLUMN-MAJOR: byte k is row k%4, column k//4.
//   The C++ ShiftRows shuffle mask was tested against that convention
//   and matches exactly. So state[0..3] is column 0, [4..7] column 1,
//   and so on. Getting this backwards yields a grid that looks entirely
//   plausible and is transposed, which is why it was checked rather
//   than read.
//
// WHY NOT AES-NI
//   AESENC fuses SubBytes+ShiftRows+MixColumns+AddRoundKey into one
//   atomic instruction -- the intermediates do not exist anywhere
//   readable. It is a hardware black box by design, which is the exact
//   opposite of what this journey needs.
//
// CORRECTNESS
//   An LLM cannot verify its own crypto. FIPS-197 Appendix B publishes
//   every intermediate state for a known plaintext/key pair; that is
//   the oracle. See aes128_vectors.test.js -- the implementation is
//   checked step-by-step before any renderer consumes it.
//
// DEPTH TAGGING
//   Each capture carries {depth, parent}. The array stays FLAT -- the
//   tree is encoded, not nested, so journey_interpreter can filter it
//   without walking anything. Depth 1 is round-level, 2 is step-level,
//   3 is inside-a-step.
//
// Self-registers into DSP_ALGORITHMS (dsp_registry.js must load first).
// ---------------------------------------------------------------------------

// ── S-box (FIPS-197 Figure 7) ────────────────────────────────────────────
// Copied from the standard, not computed. Computing it means implementing
// multiplicative inverse in GF(2^8) plus an affine transform -- two more
// places to be subtly wrong, for a table that never changes.
const AES_SBOX = new Uint8Array([
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
]);

// RCON -- round constants. Matches RCON[10] in the C++.
const AES_RCON = new Uint8Array([0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36]);

// ── GF(2^8) arithmetic ───────────────────────────────────────────────────
// xtime is multiply-by-2 in the AES field. The 0x1b is the reduction
// polynomial x^8+x^4+x^3+x+1 with the x^8 term dropped -- applied only
// when the high bit was set, i.e. when the shift would overflow 8 bits.
// Everything in MixColumns is built from this. Four lines, and the one
// place an implementation is most often subtly wrong.
function xtime(b) {
    return ((b << 1) ^ ((b & 0x80) ? 0x1b : 0x00)) & 0xff;
}

// Multiply by 3 = multiply by 2, then XOR the original. (3 = 2 XOR 1)
function gmul3(b) { return xtime(b) ^ b; }

// ── Capture helper ───────────────────────────────────────────────────────
// Replaces print_m128i_lanes() from the C++. Same labels, same call
// sites; the state is COPIED because the algorithm mutates in place and
// a reference would show the final state everywhere.
function makeRecorder() {
    const captures = [];
    let currentPhase = "expansion";
    return {
        captures,
        // `phase` separates the two journeys that share this one run:
        // expandKey always executes (encryption needs the round keys) and
        // emits its own captures. Without this tag a depth-1 filter picks
        // up "Round key 6" alongside "Round 1", mixing two journeys into
        // one card. The renderer filters on phase first, depth second.
        capture(label, tech, depth, parent, state, extra = {}) {
            captures.push({
                label, tech, depth, parent,
                phase: currentPhase,
                data: new Uint8Array(state),   // copy, not reference
                ...extra,
            });
        },
        setPhase(p) { currentPhase = p; },
    };
}

// ── Key expansion ────────────────────────────────────────────────────────
// Ported from expandKey(). The C++ used the shift-and-XOR trick the CPU
// uses; expressed here word-wise, which is the same computation and
// easier to follow.
//
// Emits depth-2 captures for the first round key only (the mechanism is
// identical for all ten), then depth-1 for each finished key. Rounds
// 2-10 are tagged repeatRole:"repeat" so a renderer can compress them --
// watching the same rotate-substitute-XOR ten times teaches nothing
// after the first.
function expandKey(key, rec) {
    const w = new Uint8Array(176);          // 11 round keys x 16 bytes
    w.set(key, 0);

    rec.capture("Round key 0", "The cipher key itself", 1, "expansion",
                w.subarray(0, 16), { roundKey: 0, repeatRole: "exemplar" });

    for (let round = 1; round <= 10; round++) {
        const prev = round * 16 - 16;
        const cur  = round * 16;
        const showDetail = (round === 1);   // depth-2 detail for round 1 only

        // W3 of the previous key -- the word that gets transformed
        const t = [w[prev+12], w[prev+13], w[prev+14], w[prev+15]];
        if (showDetail) {
            rec.capture("previousLane", "W3 of the previous round key",
                        2, "Round key 1", padWord(t));
        }

        // RotWord: rotate left by one byte
        const rot = [t[1], t[2], t[3], t[0]];
        if (showDetail) {
            rec.capture("rotated", "RotWord -- rotate left by one byte",
                        2, "Round key 1", padWord(rot));
        }

        // SubWord: S-box each byte
        const sub = rot.map(b => AES_SBOX[b]);
        if (showDetail) {
            rec.capture("substituted", "SubWord -- S-box each byte",
                        2, "Round key 1", padWord(sub));
        }

        // XOR the round constant into the first byte only
        sub[0] ^= AES_RCON[round - 1];
        if (showDetail) {
            rec.capture("after RCON", `XOR Rcon[${round}] = 0x${
                        AES_RCON[round-1].toString(16).padStart(2,"0")}`,
                        2, "Round key 1", padWord(sub));
        }

        // W4 = W0 XOR t, then each subsequent word XORs the one before.
        // This is the cascade the C++ achieved with progressive shifts.
        for (let i = 0; i < 4; i++) w[cur + i] = w[prev + i] ^ sub[i];
        for (let word = 1; word < 4; word++) {
            for (let i = 0; i < 4; i++) {
                w[cur + word*4 + i] = w[cur + (word-1)*4 + i]
                                    ^ w[prev + word*4 + i];
            }
            if (showDetail) {
                rec.capture(`W${round*4 + word} cascade`,
                            `W${round*4+word} = W${round*4+word-1} XOR W${(round-1)*4+word}`,
                            2, "Round key 1", w.subarray(cur, cur + 16));
            }
        }

        rec.capture(`Round key ${round}`,
                    `Derived from round key ${round - 1}`,
                    1, "expansion", w.subarray(cur, cur + 16),
                    { roundKey: round,
                      repeatRole: round === 1 ? "exemplar" : "repeat" });
    }
    return w;
}

// A 4-byte word shown in a 16-cell grid -- padded so the renderer can use
// one grid component throughout rather than a special 1x4 case.
function padWord(word) {
    const g = new Uint8Array(16);
    g.set(word, 0);
    return g;
}

// ── Round operations ─────────────────────────────────────────────────────

function subBytes(s) {
    for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]];
}

// Row r rotates LEFT by r. State is column-major, so the byte at
// row r, column c lives at index r + 4c. Verified against the shuffle
// mask in the original C++ (Helper.h RotateBlock::ShiftRowsForEncryption).
function shiftRows(s) {
    const t = new Uint8Array(s);
    for (let r = 1; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            s[r + 4*c] = t[r + 4*((c + r) % 4)];
        }
    }
}

// Each column treated as a 4-term polynomial, multiplied by a fixed
// polynomial in GF(2^8). Per-column captures are depth 3 -- this is the
// one round step with genuinely interesting substructure, which is why
// the depth ladder exists at all.
function mixColumns(s, rec, parent) {
    for (let c = 0; c < 4; c++) {
        const i = 4 * c;
        const a0 = s[i], a1 = s[i+1], a2 = s[i+2], a3 = s[i+3];
        s[i]   = xtime(a0) ^ gmul3(a1) ^ a2        ^ a3;
        s[i+1] = a0        ^ xtime(a1) ^ gmul3(a2) ^ a3;
        s[i+2] = a0        ^ a1        ^ xtime(a2) ^ gmul3(a3);
        s[i+3] = gmul3(a0) ^ a1        ^ a2        ^ xtime(a3);

        if (rec) {
            rec.capture(`column ${c}`,
                        `Column ${c} multiplied in GF(2\u2078)`,
                        3, parent, s, { column: c });
        }
    }
}

function addRoundKey(s, w, round) {
    for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i];
}

// ── The DSPE ─────────────────────────────────────────────────────────────

registerDspAlgorithm("aes128_encrypt", {
    process(envelope, parameters) {
        // Defensive: this DSPE needs exactly 16 bytes of plaintext and
        // 16 of key. Without the check a short input produces a
        // convincing-looking but meaningless animation.
        const plaintext = envelope.arrays?.plaintext ?? envelope.y;
        const key       = envelope.arrays?.key;

        if (!plaintext || plaintext.length !== 16) {
            return { error: `aes128_encrypt needs 16 bytes of plaintext, got ${plaintext?.length ?? 0}` };
        }
        if (!key || key.length !== 16) {
            return { error: `aes128_encrypt needs a 16-byte key, got ${key?.length ?? 0}` };
        }

        const mode = parameters?.mode ?? "encrypt";   // "encrypt" | "expansion"
        const rec  = makeRecorder();

        const w = expandKey(Uint8Array.from(key), rec);

        // Journey 1 stops here -- key expansion is a journey in its own
        // right, and its captures are already recorded above.
        if (mode === "expansion") {
            return {
                interimOutputs: rec.captures,
                finalOutput: {
                    roundKeys: w,
                    keyHex:    toHex(key),
                    lastKeyHex: toHex(w.subarray(160, 176)),
                },
            };
        }

        // Everything from here belongs to the encryption journey, not
        // the key-expansion one.
        rec.setPhase("encrypt");

        const s = Uint8Array.from(plaintext);

        rec.capture("Plaintext", "The block before any transformation",
                    1, "encrypt", s);

        // Pre-whitening. Labels below match the C++ verbatim.
        addRoundKey(s, w, 0);
        rec.capture("keyPreWhitening", "Plaintext XOR round key 0",
                    1, "encrypt", s, { round: 0, repeatRole: "exemplar" });

        // Rounds 1-9. Round 1 is the exemplar -- shown in full. The rest
        // are structurally identical, so they carry repeatRole "repeat"
        // and a renderer can compress them.
        for (let round = 1; round <= 9; round++) {
            const parent = `Round ${round}`;
            const role   = round === 1 ? "exemplar" : "repeat";

            subBytes(s);
            rec.capture("substitutedBlock", "SubBytes -- S-box each of the 16 bytes",
                        2, parent, s, { round, repeatRole: role });

            shiftRows(s);
            rec.capture("rowsShiftedBlock", "ShiftRows -- row r rotates left by r",
                        2, parent, s, { round, repeatRole: role });

            // Per-column captures at depth 3, exemplar round only --
            // 9 rounds x 4 columns would be 36 near-identical captures.
            mixColumns(s, round === 1 ? rec : null, "mixedColumnsBlock");
            rec.capture("mixedColumnsBlock", "MixColumns -- GF(2\u2078) mix within each column",
                        2, parent, s, { round, repeatRole: role });

            addRoundKey(s, w, round);
            rec.capture("roundKeyAdded", `AddRoundKey -- XOR round key ${round}`,
                        2, parent, s, { round, repeatRole: role });

            rec.capture(parent, `State after round ${round}`,
                        1, "encrypt", s, { round, repeatRole: role });
        }

        // Round 10 -- no MixColumns. The asymmetry is deliberate in the
        // spec (it would add nothing, since decryption inverts it away)
        // and is worth its own stage rather than being hidden in a loop.
        subBytes(s);
        rec.capture("substitutedBlock", "SubBytes -- final round",
                    2, "Round 10", s, { round: 10 });

        shiftRows(s);
        rec.capture("rowsShiftedBlock", "ShiftRows -- final round",
                    2, "Round 10", s, { round: 10 });

        addRoundKey(s, w, 10);
        rec.capture("roundKeyAdded", "AddRoundKey -- no MixColumns in the final round",
                    2, "Round 10", s, { round: 10 });

        rec.capture("Ciphertext", "The encrypted block",
                    1, "encrypt", s, { round: 10 });

        return {
            interimOutputs: rec.captures,
            finalOutput: {
                ciphertext:    s,
                ciphertextHex: toHex(s),
                plaintextHex:  toHex(plaintext),
                keyHex:        toHex(key),
                roundKeys:     w,
                rounds:        10,
            },
        };
    },
});

function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Exported for the FIPS-197 vector test, which runs outside the browser.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { AES_SBOX, AES_RCON, xtime, gmul3, expandKey,
                       subBytes, shiftRows, mixColumns, addRoundKey,
                       makeRecorder, toHex };
}
