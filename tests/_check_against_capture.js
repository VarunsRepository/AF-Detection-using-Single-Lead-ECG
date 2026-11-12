// ---------------------------------------------------------------------------
// _check_against_capture.js
//
// Closes the one hole oracle_ble_connect.py admits to: it can verify every
// byte but not the ORDER of the link-layer negotiation, because the spec
// does not fix it and real stacks differ.
//
// A capture fixes that, and nothing else does.
//
// HOW TO PRODUCE ONE
//   1. Flash the nRF Sniffer for Bluetooth LE firmware onto an nRF52840
//      Dongle and install the Wireshark plugin.
//   2. Start capturing BEFORE the devices connect. This is not optional:
//      the sniffer follows a connection by running the same hop
//      arithmetic as the participants, so it needs the CONNECT_IND to
//      learn the access address, hop increment and channel map. Start
//      late and you capture nothing at all.
//   3. Power the peripheral, connect from the phone, wait for the first
//      notification, stop.
//   4. File -> Export Packet Dissections -> As JSON, all packets.
//   5. node _check_against_capture.js <that-file.json>
//
// WHAT IT TELLS YOU
//   - which packets the journey shows that the capture does not contain
//   - which the capture contains that the journey omits
//   - whether stage 4's ordering matches reality, which is the whole point
//
// A DISAGREEMENT IS NOT AUTOMATICALLY A BUG IN THE JOURNEY. Your phone is
// one central; iOS, Android and a Linux host all negotiate differently.
// What the journey must not do is present one stack's behaviour as the
// protocol. If the capture disagrees, the fix is usually a sentence on
// stage 4's card, not a change to the packet list.
//
// THE PARSING IS BEST-EFFORT AND SAYS SO. Wireshark's JSON field names
// shift between versions and dissector builds. If this finds nothing it
// reports the shape it actually saw rather than claiming a clean run --
// a checker that silently matches zero packets is worse than none.
// ---------------------------------------------------------------------------

const fs = require("fs");
const vm = require("vm");
const P = require("./_paths");

const path = process.argv[2];
if (!path) {
    console.log("usage: node _check_against_capture.js <wireshark-export.json>");
    console.log("see the header of this file for how to produce one");
    process.exit(2);
}
if (!fs.existsSync(path)) {
    console.log(`no such file: ${path}`);
    process.exit(2);
}

// ── what the journey claims ────────────────────────────────────────────
const DSP = {};
const sandbox = {
    registerDspAlgorithm: (id, i) => { DSP[id] = i; },
    console, Math, Set, Array, Number, String, Object, JSON, Infinity,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ["ble_glossary.js", "ble_connect_filter.js"]) {
    vm.runInContext(P.read(f), sandbox, { filename: f });
}

const claimed = [];
for (let s = 1; s <= 6; s++) {
    const o = DSP.ble_connect.process(null, { stage: s }).finalOutput;
    // stage 2 re-shows the advertisement for context; not a real packet
    const ex = s === 2 ? o.exchanges.slice(1) : o.exchanges;
    for (const x of ex) claimed.push({ stage: s, name: x.name, from: x.from });
}

// ── what the capture contains ──────────────────────────────────────────
// Mapped to the journey's own names so the two lists are comparable.
const ADV_PDU = {
    0: "ADV_IND", 1: "ADV_DIRECT_IND", 2: "ADV_NONCONN_IND",
    3: "SCAN_REQ", 4: "SCAN_RSP", 5: "CONNECT_IND", 6: "ADV_SCAN_IND",
};
const LL_OPCODE = {
    0x02: "LL_TERMINATE_IND", 0x08: "LL_FEATURE_REQ", 0x0E: "LL_FEATURE_RSP",
    0x14: "LL_LENGTH_REQ", 0x15: "LL_LENGTH_RSP",
    0x16: "LL_PHY_REQ", 0x17: "LL_PHY_RSP", 0x18: "LL_PHY_UPDATE_IND",
    0x00: "LL_CONNECTION_UPDATE_IND", 0x01: "LL_CHANNEL_MAP_IND",
    0x03: "LL_ENC_REQ", 0x09: "LL_VERSION_IND",
};
const ATT_OPCODE = {
    0x01: "ATT_ERROR_RSP", 0x02: "ATT_EXCHANGE_MTU_REQ",
    0x03: "ATT_EXCHANGE_MTU_RSP", 0x04: "ATT_FIND_INFORMATION_REQ",
    0x05: "ATT_FIND_INFORMATION_RSP", 0x08: "ATT_READ_BY_TYPE_REQ",
    0x09: "ATT_READ_BY_TYPE_RSP", 0x0A: "ATT_READ_REQ", 0x0B: "ATT_READ_RSP",
    0x10: "ATT_READ_BY_GROUP_TYPE_REQ", 0x11: "ATT_READ_BY_GROUP_TYPE_RSP",
    0x12: "ATT_WRITE_REQ", 0x13: "ATT_WRITE_RSP",
    0x1B: "ATT_HANDLE_VALUE_NTF", 0x1D: "ATT_HANDLE_VALUE_IND",
};

const num = v => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s.startsWith("0x") ? parseInt(s, 16) : parseInt(s, 10);
};

// Walks a dissection tree for the first key matching any of several
// names, because the exact path differs by Wireshark version.
function findKey(obj, candidates, depth = 0) {
    if (obj === null || typeof obj !== "object" || depth > 8) return undefined;
    for (const c of candidates) if (c in obj) return obj[c];
    for (const k of Object.keys(obj)) {
        const r = findKey(obj[k], candidates, depth + 1);
        if (r !== undefined) return r;
    }
    return undefined;
}

let raw;
try {
    raw = JSON.parse(fs.readFileSync(path, "utf8"));
} catch (e) {
    console.log(`could not parse ${path} as JSON: ${e.message}`);
    console.log("expected a Wireshark 'Export Packet Dissections -> As JSON' file");
    process.exit(2);
}
if (!Array.isArray(raw)) {
    console.log("that JSON is not an array of packets, which is what Wireshark exports");
    process.exit(2);
}

const seen = [];
const shapes = new Set();
for (const p of raw) {
    const layers = p?._source?.layers;
    if (!layers) continue;
    for (const k of Object.keys(layers)) shapes.add(k);

    const advType = num(findKey(layers, [
        "btle.advertising_header.pdu_type", "btle.advertising_header_pdu_type"]));
    const llOp = num(findKey(layers, [
        "btle.control_opcode", "btle.control.opcode"]));
    const attOp = num(findKey(layers, ["btatt.opcode"]));
    const len = num(findKey(layers, [
        "btle.data_header.length", "btle.length"]));

    let name = null;
    if (attOp !== null && ATT_OPCODE[attOp]) name = ATT_OPCODE[attOp];
    else if (llOp !== null && LL_OPCODE[llOp]) name = LL_OPCODE[llOp];
    else if (advType !== null && ADV_PDU[advType]) name = ADV_PDU[advType];
    else if (len === 0) name = "Empty PDU";

    if (name) seen.push(name);
}

console.log(`capture: ${raw.length} frames, ${seen.length} identified\n`);

if (seen.length === 0) {
    // Loud, per the header. A checker that reports success on zero
    // matches teaches you to trust it when it is blind.
    console.log("IDENTIFIED NOTHING. This is a parsing failure, not a clean run.");
    console.log("Top-level layer keys actually present in the export:");
    console.log("  " + [...shapes].sort().join(", "));
    console.log("\nAdjust the findKey() candidate names above to match, then rerun.");
    process.exit(1);
}

// ── compare ────────────────────────────────────────────────────────────
const claimedNames = claimed.map(c => c.name.replace(/ \(ch \d+\)$/, ""));
const cSet = new Set(claimedNames), sSet = new Set(seen);

const missing = [...cSet].filter(n => !sSet.has(n));
const extra   = [...sSet].filter(n => !cSet.has(n));

let fails = 0;
console.log("packets the journey shows");
if (missing.length) {
    fails++;
    console.log(`  NOT IN CAPTURE: ${missing.join(", ")}`);
    console.log("  -> either your stack skips these, or the journey invented them");
} else console.log("  ok   every packet the journey shows appears in the capture");

console.log("\npackets the capture contains");
if (extra.length) {
    console.log(`  NOT IN JOURNEY: ${extra.join(", ")}`);
    console.log("  -> real traffic the journey omits. LL_VERSION_IND and");
    console.log("     LL_CONNECTION_UPDATE_IND are the usual ones, and omitting");
    console.log("     them is a scoping choice; anything else is worth a look.");
} else console.log("  ok   the journey covers everything in the capture");

// ── the actual point: stage 4's ordering ───────────────────────────────
console.log("\nstage 4 ordering -- the claim the spec oracle cannot check");
const stage4 = claimed.filter(c => c.stage === 4).map(c => c.name);
const seen4 = seen.filter(n => stage4.includes(n));
const journey4 = stage4.filter(n => seen4.includes(n));

if (!seen4.length) {
    console.log("  capture has none of stage 4's packets -- cannot judge");
} else if (JSON.stringify(seen4) === JSON.stringify(journey4)) {
    console.log(`  ok   capture order matches: ${seen4.join(" -> ")}`);
    console.log("  -> stage 4's card can drop the modelling caveat for THIS stack");
} else {
    fails++;
    console.log(`  DIFFERS`);
    console.log(`    journey: ${journey4.join(" -> ")}`);
    console.log(`    capture: ${seen4.join(" -> ")}`);
    console.log("  -> expected, and the reason the caveat is on the card. Either");
    console.log("     reorder the journey to match the stack you care about, or");
    console.log("     leave it and say which stack the card is modelling.");
}

console.log(fails === 0
    ? "\nCAPTURE AGREES WITH THE JOURNEY\n"
    : `\n${fails} AREA(S) OF DISAGREEMENT -- read the notes above before changing anything\n`);
process.exit(fails === 0 ? 0 : 1);
