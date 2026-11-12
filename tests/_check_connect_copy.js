// Runs every stage of the real ble_connect recipe through the real DSPE and
// renderer, then checks that the numbers QUOTED IN THE PROSE match what the
// code computes.
//
// Plus one policy check the backlog's third filter requires and nothing else
// enforces: if a stage's oracle lists something it cannot verify, that stage's
// own description must say so. An animation that implies certainty the oracle
// does not have is the specific failure the filter exists to prevent.

const fs = require("fs");
const vm = require("vm");

const P = require("./_paths");
const recipe = JSON.parse(P.read("_connect_recipe.json"));

const DSP = {}, RE = {};
let drawOps = 0;
function stubCtx() {
    const noop = () => {}, count = () => { drawOps++; };
    return new Proxy({
        canvas: { width: 1170, height: 1260 }, globalAlpha: 1,
        fillRect: count, strokeRect: count, fillText: count, stroke: count, fill: count,
        measureText: () => ({ width: 10 }),
    }, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => (t[k] = v, true) });
}
const sweeps = [];
const sandbox = {
    registerDspAlgorithm: (id, i) => { DSP[id] = i; },
    registerRenderingAlgorithm: (id, i) => { RE[id] = i; },
    startSweepLoop: (s, d, cb) => { sweeps.push({ d, cb }); },
    getComputedStyle: () => ({ getPropertyValue: () => "#4aa3d8" }),
    devicePixelRatio: 3,
    ResizeObserver: class { observe() {} },
    document: { documentElement: {}, createElement: () => ({ style: {}, getContext: () => stubCtx(), appendChild() {} }) },
    console, Math, Set, Array, Number, String, Object, JSON, Infinity,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ["ble_connect_filter.js", "exchange_view.js"]) {
    vm.runInContext(P.read(f), sandbox, { filename: f });
}

let fails = 0;
const fail = m => { fails++; console.log(`  FAIL ${m}`); };
const ok   = m => console.log(`  ok   ${m}`);

console.log(`recipe: ${recipe.name} v${recipe.version}, "${recipe.category}", `
          + `${recipe.stageCount} stages\n`);

// ── 1. every stage resolves and renders ───────────────────────────────
console.log("every stage resolves and renders");
const out = {};
for (const s of recipe.stages) {
    const o = DSP[s.algorithm].process(null, s.parameters);
    if (o.error) { fail(`${s.stageId}: DSPE error "${o.error}"`); continue; }
    out[s.stageId] = o.finalOutput;

    drawOps = 0; sweeps.length = 0;
    const container = { innerHTML: "", style: {}, offsetWidth: 390, offsetHeight: 420, appendChild() {} };
    try {
        RE[s.renderer].render(container, o, s.rendererConfig, "chk", 500, s.durationMs);
        const sw = sweeps[0];
        for (let i = 0; i <= 16; i++) sw.cb((i / 16) * sw.d);
        if (drawOps < 20) throw new Error("drew nothing");
        ok(`${s.stageId}  (${o.finalOutput?.exchanges?.length ?? o.exchanges?.length ?? "?"} packets, ${drawOps} draw ops)`);
    } catch (e) { fail(`${s.stageId}: renderer threw -- ${e.message}`); }
}

// ── 2. stage numbers are 1..6 in order, none skipped ──────────────────
console.log("\nstage parameters");
{
    const got = recipe.stages.map(s => s.parameters.stage);
    const want = [1, 2, 3, 4, 5, 6];
    if (JSON.stringify(got) === JSON.stringify(want)) ok(`stages ${got.join(", ")}`);
    else fail(`stage parameters are ${got.join(", ")}, want ${want.join(", ")}`);
}

// ── 3. quoted numbers must match computed values ──────────────────────
console.log("\nquoted numbers must match computed values");

function text(id) {
    const s = recipe.stages.find(x => x.stageId === id);
    return `${s.title} ${s.caption} ${s.description}`;
}
function says(id, needle, label) {
    if (text(id).includes(needle)) ok(`${id}: "${needle}" present (${label})`);
    else fail(`${id}: prose does not contain "${needle}" (${label})`);
}

const adv = out.advertising, con = out.connect_ind, fev = out.first_event;
const neg = out.negotiation, mtu = out.mtu, dis = out.discovery;

// stage 1
says("advertising", "38 bytes", "advIndOnAir");
says("advertising", "22 of the 38", "advDataBytes");
says("advertising", "0x8E89BED6", "the fixed advertising access address");
says("advertising", "31-byte", "AdvData ceiling");
says("advertising", "10.24 seconds", "max advertising interval");
if (adv.exchanges[0].onAirBytes === 38 && adv.oracle.advDataBytes === 22
    && adv.exchanges.length === 3) ok("advertising: 3 packets of 38 B, 22 B AdvData");
else fail(`advertising: ${adv.exchanges.length} packets, ${adv.exchanges[0].onAirBytes} B, ${adv.oracle.advDataBytes} B AdvData`);

// stage 2
says("connect_ind", "34 bytes", "CONNECT_IND PDU");
says("connect_ind", "150 microseconds", "T_IFS");
says("connect_ind", "37-bit", "channel map width");
says("connect_ind", "32-bit", "access address width");
{
    const ci = con.exchanges[1];
    const timing = ci.fields.filter(f => f.role === "timing").length;
    const chan   = ci.fields.filter(f => f.role === "channels").length;
    const addr   = ci.fields.filter(f => f.role === "addressing").length;
    if (ci.pduBytes === 34) ok("connect_ind: 34 B PDU");
    else fail(`connect_ind: ${ci.pduBytes} B PDU, want 34`);
    // The card names these counts in words, so check the WORDS against
    // the computed counts rather than against a literal I typed here --
    // which is how the first version of this check managed to fail after
    // the prose had already been corrected.
    const WORD = ["zero", "one", "two", "three", "four", "five", "six",
                  "seven", "eight", "nine", "ten"];
    const claims = [
        [`${WORD[addr]} addresses`, addr, "addressing"],
        [`${WORD[timing]} timing fields`, timing, "timing"],
        [`${WORD[chan]} channel fields`, chan, "channels"],
    ];
    for (const [phrase, n, role] of claims) {
        if (text("connect_ind").includes(phrase))
            ok(`connect_ind: prose says "${phrase}", and there are ${n}`);
        else
            fail(`connect_ind: ${n} ${role} fields, so the prose should say `
               + `"${phrase}" and does not`);
    }
}

// stage 3
says("first_event", "Ten bytes", "empty PDU on air");
says("first_event", "80 microseconds", "empty PDU airtime");
if (fev.exchanges[0].onAirBytes === 10 && fev.exchanges[0].airtimeUs === 80)
    ok("first_event: 10 B, 80 us");
else fail(`first_event: ${fev.exchanges[0].onAirBytes} B, ${fev.exchanges[0].airtimeUs} us`);

// stage 4
says("negotiation", "Seven packets", "stage 4 count");
says("negotiation", "8-byte", "FeatureSet width");
says("negotiation", "bit 5", "DLE feature bit");
says("negotiation", "bit 8", "2M PHY feature bit");
says("negotiation", "27 bytes", "default LL payload");
if (neg.exchanges.length === 7) ok("negotiation: 7 packets");
else fail(`negotiation: ${neg.exchanges.length} packets, want 7`);

// stage 5
says("mtu", "23 bytes", "default ATT MTU");
says("mtu", "20 bytes", "usable value bytes");
says("mtu", "4-byte L2CAP", "L2CAP header width");
says("mtu", "only happen once", "the one-shot rule");

// stage 6, and the journey headline
says("discovery", "Eleven packets", "stage 6 count");
says("discovery", "handle 4", "the CCCD handle");
says("discovery", "26 packets", "journeyPacketCount");
says("discovery", "546 bytes", "journeyOnAirBytes");
says("discovery", "338 milliseconds", "journeyElapsed");
says("discovery", "273", "overheadRatio");
says("discovery", "11.5", "ble_txpath's ratio, for comparison");
says("discovery", "twenty-four times", "273 / 11.5");
{
    const t = dis.totals;
    const checks = [
        ["journeyPacketCount", t.journeyPacketCount, 26],
        ["journeyOnAirBytes", t.journeyOnAirBytes, 546],
        ["overheadRatio", t.overheadRatio, 273],
        ["stage 6 packets", dis.exchanges.length, 11],
    ];
    for (const [l, got, want] of checks) {
        if (got === want) ok(`discovery: ${l} = ${got}`);
        else fail(`discovery: ${l} = ${got}, prose implies ${want}`);
    }
    const ms = t.journeyElapsedUs / 1000;
    if (Math.abs(ms - 338) < 1) ok(`discovery: elapsed ${ms.toFixed(1)} ms matches "338"`);
    else fail(`discovery: elapsed ${ms.toFixed(1)} ms, prose says 338`);
    // the cross-journey claim
    const ratio = t.overheadRatio / 11.5;
    if (Math.round(ratio) === 24) ok(`discovery: 273/11.5 = ${ratio.toFixed(1)}, rounds to 24`);
    else fail(`discovery: 273/11.5 = ${ratio.toFixed(1)}, prose says twenty-four`);
}

// ── 4. the policy check: unverified claims must be disclosed ──────────
console.log("\nany stage whose oracle cannot verify something must say so");
for (const s of recipe.stages) {
    const o = out[s.stageId];
    if (!o?.oracle) continue;
    const unver = o.oracle.unverified ?? [];
    if (!unver.length) { ok(`${s.stageId}: oracle covers every claim`); continue; }
    // Stage 4 is the one that carries an unverifiable ordering claim. Any
    // stage in that position must disclose it in its own description --
    // not in a sibling's, and not only in a code comment.
    const d = s.description.toLowerCase();
    const discloses = /honest limit|no oracle|is a model|cannot verify|sniff your own/
                      .test(d);
    if (discloses) ok(`${s.stageId}: ${unver.length} unverified claim(s), disclosed in the card`);
    else fail(`${s.stageId}: oracle lists ${unver.length} unverified claim(s) `
            + `and the description does not admit it`);
}

// ── 5. the not-to-scale disclosure, where gaps differ wildly ──────────
console.log("\nstages whose gaps span orders of magnitude must say so");
for (const s of recipe.stages) {
    const o = out[s.stageId];
    const gaps = (o?.exchanges ?? []).map(x => x.gapBeforeUs).filter(g => g > 0);
    if (gaps.length < 2) { ok(`${s.stageId}: fewer than two gaps, nothing to disclose`); continue; }
    const spread = Math.max(...gaps) / Math.min(...gaps);
    if (spread < 10) { ok(`${s.stageId}: gaps within one order of magnitude`); continue; }
    if (/not to scale/i.test(s.description))
        ok(`${s.stageId}: gaps span ${spread.toFixed(0)}x, disclosed`);
    else fail(`${s.stageId}: gaps span ${spread.toFixed(0)}x and the card does not say "not to scale"`);
}

// ── 6. glossary terms are real and defined ────────────────────────────
// The terms come from the RECIPE now, via catalog/glossaries/wireless.py,
// so they are checked where they actually live rather than in DSPE output.
console.log("\nglossary, carried on the renderer config");
for (const s of recipe.stages) {
    const g = s.rendererConfig?.glossary ?? [];
    if (g.length && g.every(x => x.acronym && x.full && x.plain))
        ok(`${s.stageId}: ${g.length} terms, all defined`);
    else fail(`${s.stageId}: no glossary on the renderer config`);
}

console.log(fails === 0
    ? "\nRECIPE CONSISTENT WITH THE CODE\n"
    : `\n${fails} INCONSISTENCY(S)\n`);
process.exit(fails === 0 ? 0 : 1);
