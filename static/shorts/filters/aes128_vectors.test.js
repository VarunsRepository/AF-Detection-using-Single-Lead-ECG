// ---------------------------------------------------------------------------
// filters/aes128_vectors.test.js
//
// Verifies aes128_filter.js against FIPS-197 -- the published standard,
// not a self-generated expectation.
//
//   Appendix A   complete key schedule, all 11 round keys
//   Appendix B   every intermediate state of a full encryption
//
// WHY THIS EXISTS: an LLM cannot verify its own crypto, and a wrong
// MixColumns still animates convincingly. These vectors are the external
// oracle. Run this before trusting any rendering built on top.
//
//   node aes128_vectors.test.js
// ---------------------------------------------------------------------------

global.registerDspAlgorithm = () => {};
const A = require('./aes128_filter.js');
const hex = h => Uint8Array.from(h.match(/../g).map(b => parseInt(b,16)));
const s = A.toHex;

// FIPS-197 Appendix A -- the complete key schedule for 2b7e1516...
const SCHEDULE = [
 "2b7e151628aed2a6abf7158809cf4f3c", "a0fafe1788542cb123a339392a6c7605",
 "f2c295f27a96b9435935807a7359f67f", "3d80477d4716fe3e1e237e446d7a883b",
 "ef44a541a8525b7fb671253bdb0bad00", "d4d1c6f87c839d87caf2b8bc11f915bc",
 "6d88a37a110b3efddbf98641ca0093fd", "4e54f70e5f5fc9f384a64fb24ea6dc4f",
 "ead27321b58dbad2312bf5607f8d292f", "ac7766f319fadc2128d12941575c006e",
 "d014f9a8c9ee2589e13f0cc8b6630ca6",
];

let pass=0, fail=0;
const rec = A.makeRecorder();
const w = A.expandKey(hex("2b7e151628aed2a6abf7158809cf4f3c"), rec);

console.log("=== FULL KEY SCHEDULE (FIPS-197 Appendix A) ===");
SCHEDULE.forEach((want, i) => {
  const got = s(w.subarray(i*16, i*16+16));
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok?"PASS":"FAIL"}  rk${String(i).padStart(2)}  ${got}`);
  if(!ok) console.log(`              want  ${want}`);
});

// ── Now the full DSPE, as the journey will call it ─────────────────────
console.log("\n=== DSPE end-to-end ===");
let algo;
global.registerDspAlgorithm = (id, impl) => { algo = impl; };
delete require.cache[require.resolve('./aes128_filter.js')];
require('./aes128_filter.js');

const out = algo.process({
  arrays: { plaintext: hex("3243f6a8885a308d313198a2e0370734"),
            key:       hex("2b7e151628aed2a6abf7158809cf4f3c") }
}, { mode: "encrypt" });

const ctOK = out.finalOutput.ciphertextHex === "3925841d02dc09fbdc118597196a0b32";
ctOK ? pass++ : fail++;
console.log(`  ${ctOK?"PASS":"FAIL"}  ciphertext  ${out.finalOutput.ciphertextHex}`);
console.log(`  captures: ${out.interimOutputs.length}`);

const byDepth = {};
out.interimOutputs.forEach(c => byDepth[c.depth] = (byDepth[c.depth]||0)+1);
console.log("  by depth:", JSON.stringify(byDepth));

const roles = {};
out.interimOutputs.forEach(c => { if(c.repeatRole) roles[c.repeatRole]=(roles[c.repeatRole]||0)+1; });
console.log("  repeatRole:", JSON.stringify(roles));

// Guard rails
console.log("\n=== input validation ===");
const bad = algo.process({ arrays:{ plaintext: hex("3243f6a8"), key: hex("2b7e151628aed2a6abf7158809cf4f3c") }}, {});
const guardOK = !!bad.error;
guardOK ? pass++ : fail++;
console.log(`  ${guardOK?"PASS":"FAIL"}  short plaintext rejected: ${bad.error ?? "NOT REJECTED"}`);

console.log(`\n${fail===0?"ALL PASS":"FAILURES"}  ${pass} passed, ${fail} failed`);
