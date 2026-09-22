// ---------------------------------------------------------------------------
// filters/spn_cipher_filter.js
//
// A 16-bit substitution-permutation network -- the structure that AES,
// PRESENT and most modern block ciphers are built from, shrunk until
// every bit fits on screen.
//
// This is Heys' cipher, from Howard Heys' "A Tutorial on Linear and
// Differential Cryptanalysis". It is the standard pedagogical SPN
// precisely because it is small enough to trace by hand.
//
// WHY 16 BITS RATHER THAN AES's 128
//   AES hides its structure behind scale: 128 bits, a 256-entry S-box,
//   and GF(2^8) arithmetic in MixColumns. The SHAPE of an SPN -- confuse,
//   then diffuse, then add key, repeat -- is identical but invisible
//   underneath that. At 16 bits you can watch one bit flip and follow it
//   across the whole block.
//
// THE STRUCTURE
//   rounds 1-3   XOR round key -> S-box each nibble -> permute bits
//   round 4      XOR round key -> S-box each nibble -> XOR final key
//
//   The last round drops the permutation deliberately. A permutation at
//   the end would be publicly invertible and add nothing -- the same
//   reason AES omits MixColumns from its final round.
//
// WHY SUBSTITUTION AND PERMUTATION ARE BOTH NEEDED
//   Substitution alone: each nibble is scrambled but stays in its own
//   lane, so flipping an input bit only ever affects 4 output bits.
//   Permutation alone: bits move but their values never change, so the
//   cipher is linear and trivially broken.
//   Together, one flipped input bit reaches all 16 outputs within three
//   rounds. That is the avalanche the journey is built to show.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped -- filter files share
// one global scope.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// Heys' 4-bit S-box. A bijection on 0-15: every input maps to a distinct
// output, which is what makes the cipher invertible at all.
const SBOX     = [0xE,4,0xD,1,2,0xF,0xB,8,3,0xA,6,0xC,5,9,0,7];
const SBOX_INV = (() => { const inv = new Array(16);
    SBOX.forEach((v, i) => inv[v] = i); return inv; })();

// Bit permutation, 0-indexed: output bit i takes input bit PERM[i].
// The pattern is a transpose -- bit j of nibble n moves to nibble j,
// position n. Every nibble therefore contributes exactly one bit to
// every other nibble, which is what spreads a change across the block.
const PERM = [0,4,8,12, 1,5,9,13, 2,6,10,14, 3,7,11,15];

const toBits = v => Array.from({length:16}, (_, i) => (v >> (15 - i)) & 1);
const hex4   = v => v.toString(16).padStart(4, "0").toUpperCase();

function substitute(block) {
    let out = 0;
    for (let n = 0; n < 4; n++) {
        const nib = (block >> (12 - 4*n)) & 0xF;
        out |= SBOX[nib] << (12 - 4*n);
    }
    return out & 0xFFFF;
}

function permute(block) {
    let out = 0;
    for (let i = 0; i < 16; i++) {
        const bit = (block >> (15 - PERM[i])) & 1;
        out |= bit << (15 - i);
    }
    return out & 0xFFFF;
}

// Round keys. Heys' tutorial uses independent round keys rather than a
// schedule -- the cryptanalysis it teaches assumes they are unrelated.
// A 32-bit key here is sliced into five overlapping 16-bit subkeys,
// which keeps the recipe to one key value without pretending to a real
// schedule.
function roundKeys(key32) {
    const keys = [];
    for (let r = 0; r < 5; r++) {
        keys.push((Number(BigInt(key32) >> BigInt(16 - 4*r)) & 0xFFFF));
    }
    return keys;
}

function encrypt(plaintext, keys, rec) {
    let state = plaintext & 0xFFFF;

    rec.push("Plaintext", "the block before any transformation",
             1, "encrypt", state);

    for (let r = 0; r < 4; r++) {
        const round = `Round ${r + 1}`;
        const last  = (r === 3);

        state ^= keys[r];
        rec.push("AddRoundKey", `XOR subkey ${hex4(keys[r])}`,
                 2, round, state, { round: r + 1, key: keys[r] });

        state = substitute(state);
        rec.push("Substitute", "each nibble through the S-box",
                 2, round, state, { round: r + 1 });

        if (!last) {
            const before = state;
            state = permute(state);
            rec.push("Permute", "bits scatter across all four nibbles",
                     2, round, state, { round: r + 1, before });
        } else {
            state ^= keys[4];
            rec.push("Final key", `XOR subkey ${hex4(keys[4])} -- no permutation`,
                     2, round, state, { round: 4, key: keys[4] });
        }

        rec.push(round, `state after round ${r + 1}`,
                 1, "encrypt", state, { round: r + 1 });
    }

    rec.push("Ciphertext", "the encrypted block", 1, "encrypt", state);
    return state;
}

// Decryption exists only as an ORACLE -- the journey never shows it.
// Encrypt-then-decrypt returning the original is a property that must
// hold, and it catches errors the forward path alone would not: a wrong
// permutation still produces plausible ciphertext, but breaks roundtrip.
function decrypt(ciphertext, keys) {
    let state = ciphertext & 0xFFFF;
    state ^= keys[4];
    for (let r = 3; r >= 0; r--) {
        if (r !== 3) state = permute(state);   // PERM is its own inverse
        let out = 0;
        for (let n = 0; n < 4; n++) {
            const nib = (state >> (12 - 4*n)) & 0xF;
            out |= SBOX_INV[nib] << (12 - 4*n);
        }
        state = out ^ keys[r];
    }
    return state & 0xFFFF;
}

function makeRecorder() {
    const captures = [];
    return {
        captures,
        push(label, tech, depth, parent, value, extra = {}) {
            captures.push({
                label, tech, depth, parent,
                value,
                bits: toBits(value),
                hex:  hex4(value),
                ...extra,
            });
        },
    };
}


registerDspAlgorithm("spn_cipher", {
    process(envelope, parameters) {
        const pt  = envelope.arrays?.plaintext;
        const key = envelope.arrays?.key;

        if (!pt || !key) {
            return { error: "spn_cipher needs arrays.plaintext and arrays.key "
                          + "(2 bytes and 4 bytes respectively)." };
        }

        // 2 bytes -> 16-bit block, 4 bytes -> 32-bit key material.
        const plaintext = ((pt[0] << 8) | pt[1]) & 0xFFFF;
        const key32 = ((key[0] << 24) | (key[1] << 16) |
                       (key[2] << 8)  |  key[3]) >>> 0;

        const keys = roundKeys(key32);
        const rec  = makeRecorder();
        const ct   = encrypt(plaintext, keys, rec);

        // Roundtrip check runs on every call. It is cheap, and a cipher
        // that cannot decrypt its own output is broken in a way no
        // amount of plausible-looking animation would reveal.
        const back = decrypt(ct, keys);
        if (back !== plaintext) {
            return { error: `spn_cipher failed its roundtrip check: `
                          + `${hex4(plaintext)} -> ${hex4(ct)} -> ${hex4(back)}` };
        }

        // Avalanche: flip the lowest input bit, encrypt again, count how
        // many output bits differ. A healthy SPN gives roughly 8 of 16.
        const altCt = encrypt(plaintext ^ 1, keys, makeRecorder());
        let flipped = 0;
        for (let i = 0; i < 16; i++) if (((ct ^ altCt) >> i) & 1) flipped++;

        return {
            interimOutputs: rec.captures,
            finalOutput: {
                ciphertext:    ct,
                ciphertextHex: hex4(ct),
                plaintextHex:  hex4(plaintext),
                roundKeys:     keys,
                roundKeysHex:  keys.map(hex4),
                avalancheBits: flipped,
                sbox:          SBOX,
                perm:          PERM,
                rounds:        4,
            },
        };
    },
});

if (typeof module !== "undefined" && module.exports) {
    module.exports = { SBOX, SBOX_INV, PERM, substitute, permute,
                       roundKeys, encrypt, decrypt, makeRecorder, toBits };
}

})();
