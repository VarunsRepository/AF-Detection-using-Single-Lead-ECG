// ---------------------------------------------------------------------------
// filters/ble_connect_filter.js
//
// Every packet exchanged between two devices from the first advertisement
// to the first temperature reading. Twenty-six of them, 546 bytes on air,
// 338 milliseconds -- to deliver two bytes.
//
// THE MECHANISM
//   A BLE connection is not opened, it is negotiated, and most of the
//   negotiation happens below the application. One advertisement, one
//   CONNECT_IND that dictates all the timing, a heartbeat, three
//   capability exchanges between controllers, an MTU agreement, and then
//   the client reads the server's whole attribute table a row at a time
//   before it is allowed to subscribe to anything.
//
// WHY THIS IS A JOURNEY AND NOT A DIAGRAM
//   Message-sequence diagrams of this exist in every BLE book and they
//   all share one flaw: every arrow is the same length. On a real time
//   axis the gaps differ by two hundred times -- 150 microseconds inside
//   a connection event, 30 milliseconds between them -- and that is the
//   whole reason connecting feels slow while transmitting feels instant.
//
//   The failure it shows: discovery costing dozens of round trips, which
//   is why a bonded device caches the result and an unbonded one makes
//   you wait again every time.
//
// THE DELIBERATE DESIGN DECISION
//   The gap before each packet is REAL TURNAROUND, not flight time.
//   Radio propagation over a metre is three nanoseconds and would be
//   invisible at any zoom. What the animation's transit encodes instead
//   is T_IFS or a connection interval -- the actual reason the next
//   packet is late. Drawn that way the picture teaches something; drawn
//   as a decorative fly-across it would teach that radio is slow, which
//   is false.
//
// COLOURING: BY WHAT THE BYTES CONFIGURE
//   addressing / timing / channels / framing / payload. Chosen over
//   colouring by layer because a setup journey's question is "what is
//   this byte FOR". CONNECT_IND is the case that decides it: all one
//   layer, but three timing fields, two channel fields and three
//   addresses, and that split IS the lesson.
//
// THE ORACLE  (backlog filter, test 3) -- AND ITS LIMIT
//   oracle_ble_connect.py derives every field width, PDU total, on-air
//   total and opcode from Core specification field definitions, sharing
//   no code with this file. Verified agreement:
//     packetsPerStage  [3, 2, 2, 7, 2, 11]
//     advDataBytes     22      advIndOnAir     38
//     connectIndPdu    34      connectIndOnAir 44
//     emptyPduOnAir    10      totalOnAir     546
//
//   WHAT NEITHER FILE CAN VERIFY: the ORDER of stage 4. Either side may
//   start the feature exchange or the length update, and real stacks
//   differ. Only LL_PHY_UPDATE_IND is fixed as central-only. Stage 4's
//   card says so plainly. The honest fix is a capture -- see
//   _check_against_capture.js.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// ── framing every packet pays, from the spec ──────────────────────────
const PREAMBLE_1M    = 1;
const ACCESS_ADDRESS = 4;
const LL_HEADER      = 2;
const CRC            = 3;
const FRAMING = PREAMBLE_1M + ACCESS_ADDRESS + LL_HEADER + CRC;   // 10

const L2CAP_HEADER   = 4;
const ATT_OPCODE     = 1;
const LL_CTRL_OPCODE = 1;

// ── timing ────────────────────────────────────────────────────────────
const T_IFS_US = 150;          // spec, fixed, not negotiable

// MODEL values. Named apart from the spec constants above because the
// cards have to distinguish them, and a reader of this file should not
// have to guess which is which.
const MODEL = {
    advChannelGapUs: 300,      // implementation dependent
    txWindowUs:      1250,     // windowOffset + 1.25 ms minimum
};

// ── what the bytes configure ──────────────────────────────────────────
const ADDRESSING = "addressing";
const TIMING     = "timing";
const CHANNELS   = "channels";
const FRAMING_R  = "framing";
const PAYLOAD    = "payload";

const ROLE_LABELS = {
    addressing: "who",
    timing:     "when",
    channels:   "where",
    framing:    "structure",
    payload:    "the actual content",
};


function f(label, bytes, role) { return { label, bytes, role }; }

function packet(name, sender, opcode, fields, gapBeforeUs, gapKind, note, collapsed) {
    const pduBytes = fields.reduce((s, x) => s + x.bytes, 0);
    return {
        name,
        from: sender,
        to: sender === "peripheral" ? "central" : "peripheral",
        opcode: opcode ?? null,
        fields,
        pduBytes,
        onAirBytes: pduBytes + FRAMING,
        airtimeUs: (pduBytes + FRAMING) * 8,          // LE 1M, 1 bit/symbol
        gapBeforeUs,
        gapKind,                                       // "spec" | "model"
        note: note ?? "",
        collapsed: collapsed ?? 0,
    };
}

// ATT rides on L2CAP, so its link-layer payload carries the L2CAP header
// and the ATT opcode before any parameters.
function attPacket(opcode, name, sender, inner, gap, kind, note, collapsed) {
    return packet(name, sender, opcode,
        [f("L2CAP header", L2CAP_HEADER, FRAMING_R),
         f("ATT opcode", ATT_OPCODE, FRAMING_R), ...inner],
        gap, kind, note, collapsed);
}

// A link-layer control PDU: opcode plus parameters, no L2CAP at all.
function llPacket(opcode, name, sender, inner, gap, kind, note) {
    return packet(name, sender, opcode,
        [f("LL opcode", LL_CTRL_OPCODE, FRAMING_R), ...inner],
        gap, kind, note);
}

// Each advertising data structure is length + type + value.
function advDataBytes(deviceName) {
    const flags  = 1 + 1 + 1;
    const uuid16 = 1 + 1 + 2;
    const name   = 1 + 1 + deviceName.length;
    return flags + uuid16 + name;
}


// ── the stages ────────────────────────────────────────────────────────

function advIndOn(channel, gap, kind, deviceName) {
    return packet(`ADV_IND (ch ${channel})`, "peripheral", null,
        [f("AdvA", 6, ADDRESSING),
         f("AdvData", advDataBytes(deviceName), PAYLOAD)],
        gap, kind, `channel ${channel}`);
}

function stageAdvertising(p) {
    return [
        advIndOn(37, 0, "spec", p.deviceName),
        advIndOn(38, MODEL.advChannelGapUs, "model", p.deviceName),
        advIndOn(39, MODEL.advChannelGapUs, "model", p.deviceName),
    ];
}

function stageConnect(p) {
    return [
        // Re-shown so the CONNECT_IND has something to answer. Counted as
        // a draw, not as a packet -- see journeyTotals below.
        advIndOn(37, 0, "spec", p.deviceName),
        packet("CONNECT_IND", "central", null,
            [f("InitA", 6, ADDRESSING),
             f("AdvA", 6, ADDRESSING),
             f("Access address", 4, ADDRESSING),
             f("CRC init", 3, FRAMING_R),
             f("Window size", 1, TIMING),
             f("Window offset", 2, TIMING),
             f("Interval", 2, TIMING),
             f("Latency", 2, TIMING),
             f("Timeout", 2, TIMING),
             f("Channel map", 5, CHANNELS),
             f("Hop + SCA", 1, CHANNELS)],
            T_IFS_US, "spec",
            "150 us after the advertisement it heard"),
    ];
}

function stageFirstEvent(p) {
    return [
        packet("Empty PDU", "central", null, [],
               MODEL.txWindowUs, "model",
               "the transmit window CONNECT_IND specified"),
        packet("Empty PDU", "peripheral", null, [],
               T_IFS_US, "spec", "acknowledges via NESN"),
    ];
}

function stageNegotiation(p) {
    const iv = p.intervalUs;
    const feat = (op, name, sender, gap, kind) => llPacket(
        op, name, sender, [f("FeatureSet", 8, PAYLOAD)], gap, kind);
    const len = (op, name, sender, gap, kind) => llPacket(
        op, name, sender,
        [f("Max RX octets", 2, PAYLOAD), f("Max RX time", 2, TIMING),
         f("Max TX octets", 2, PAYLOAD), f("Max TX time", 2, TIMING)],
        gap, kind);
    const phy = (op, name, sender, gap, kind) => llPacket(
        op, name, sender,
        [f("TX PHYs", 1, CHANNELS), f("RX PHYs", 1, CHANNELS)], gap, kind);

    return [
        feat(0x08, "LL_FEATURE_REQ", "central", iv, "model"),
        feat(0x0E, "LL_FEATURE_RSP", "peripheral", T_IFS_US, "spec"),
        len(0x14, "LL_LENGTH_REQ", "central", iv, "model"),
        len(0x15, "LL_LENGTH_RSP", "peripheral", T_IFS_US, "spec"),
        phy(0x16, "LL_PHY_REQ", "central", iv, "model"),
        phy(0x17, "LL_PHY_RSP", "peripheral", T_IFS_US, "spec"),
        llPacket(0x18, "LL_PHY_UPDATE_IND", "central",
            [f("PHY central to peripheral", 1, CHANNELS),
             f("PHY peripheral to central", 1, CHANNELS),
             f("Instant", 2, TIMING)],
            iv, "model",
            "central only -- the one ordering the spec does fix"),
    ];
}

function stageMtu(p) {
    return [
        attPacket(0x02, "ATT_EXCHANGE_MTU_REQ", "central",
            [f("Client RX MTU", 2, PAYLOAD)], p.intervalUs, "model",
            "first packet whose payload is L2CAP, not control"),
        attPacket(0x03, "ATT_EXCHANGE_MTU_RSP", "peripheral",
            [f("Server RX MTU", 2, PAYLOAD)], T_IFS_US, "spec",
            "agreed value is the smaller of the two"),
    ];
}

function stageDiscovery(p) {
    const iv = p.intervalUs;
    return [
        attPacket(0x10, "ATT_READ_BY_GROUP_TYPE_REQ", "central",
            [f("Start handle", 2, ADDRESSING), f("End handle", 2, ADDRESSING),
             f("UUID 0x2800", 2, PAYLOAD)], iv, "model",
            "list your primary services"),
        attPacket(0x11, "ATT_READ_BY_GROUP_TYPE_RSP", "peripheral",
            [f("Entry length", 1, FRAMING_R),
             f("Start handle", 2, ADDRESSING), f("End handle", 2, ADDRESSING),
             f("Service UUID", 2, PAYLOAD)], T_IFS_US, "spec",
            "one entry: 0x181A at handles 1-4"),

        attPacket(0x08, "ATT_READ_BY_TYPE_REQ", "central",
            [f("Start handle", 2, ADDRESSING), f("End handle", 2, ADDRESSING),
             f("UUID 0x2803", 2, PAYLOAD)], iv, "model",
            "same opcode number as LL_FEATURE_REQ, different namespace"),
        attPacket(0x09, "ATT_READ_BY_TYPE_RSP", "peripheral",
            [f("Entry length", 1, FRAMING_R),
             f("Declaration handle", 2, ADDRESSING),
             f("Properties", 1, PAYLOAD),
             f("Value handle", 2, ADDRESSING),
             f("Char UUID", 2, PAYLOAD)], T_IFS_US, "spec",
            "0x2A6E, notify, value at handle 3"),

        // Round three, collapsed. Two full rounds have taught the shape;
        // a third identical one teaches only that there are many, which a
        // marker says faster. collapsed > 0 is the renderer's cue.
        attPacket(0x04, "ATT_FIND_INFORMATION_REQ", "central",
            [f("Start handle", 2, ADDRESSING), f("End handle", 2, ADDRESSING)],
            iv, "model", "anything after the value?", 2),
        attPacket(0x05, "ATT_FIND_INFORMATION_RSP", "peripheral",
            [f("Format", 1, FRAMING_R), f("Handle", 2, ADDRESSING),
             f("Descriptor UUID", 2, PAYLOAD)], T_IFS_US, "spec",
            "the CCCD, handle 4", 2),

        // A client never receives an error out of nowhere. It asks once
        // more for a range past the end of the table, and THAT fails.
        attPacket(0x04, "ATT_FIND_INFORMATION_REQ", "central",
            [f("Start handle", 2, ADDRESSING), f("End handle", 2, ADDRESSING)],
            iv, "model", "asking past the end of the table"),
        attPacket(0x01, "ATT_ERROR_RSP", "peripheral",
            [f("Failed opcode", 1, FRAMING_R), f("Handle", 2, ADDRESSING),
             f("Error 0x0A", 1, PAYLOAD)], T_IFS_US, "spec",
            "Attribute Not Found -- how the client learns it is done"),

        attPacket(0x12, "ATT_WRITE_REQ", "central",
            [f("Handle 4", 2, ADDRESSING), f("Value 0x0001", 2, PAYLOAD)],
            iv, "model", "subscribe, by writing the CCCD"),
        attPacket(0x13, "ATT_WRITE_RSP", "peripheral", [],
            T_IFS_US, "spec", "bare acknowledgement"),

        attPacket(0x1B, "ATT_HANDLE_VALUE_NTF", "peripheral",
            [f("Handle 3", 2, ADDRESSING), f("Temperature", 2, PAYLOAD)],
            iv, "model", "the first value -- 0x0929, 23.45 degrees"),
    ];
}

// `unverified` is PER STAGE, and that matters.
//
// CAUGHT BY _check_connect_copy.js: the first version put one journey-wide
// unverified list on every stage's oracle. The policy check then demanded
// that stages 1, 2, 3 and 5 disclose a limitation that is not theirs --
// their packet contents and sizes are exact spec arithmetic with nothing
// unverified about them. Attaching a caveat to a card it does not apply to
// is its own dishonesty: it trains the reader to skip the disclosures.
//
// Only stages 4 and 6 contain an ordering the spec does not fix.
const STAGES = {
    1: { title: "Shouting into an empty room",      build: stageAdvertising,
         unverified: [] },
    2: { title: "One packet makes a connection",    build: stageConnect,
         unverified: [] },
    3: { title: "Alive, and carrying nothing",      build: stageFirstEvent,
         unverified: [] },
    4: { title: "Agreeing what both can do",        build: stageNegotiation,
         unverified: [
             "the order shown is a model -- either side may start the "
             + "feature exchange or the length update",
             "whether any real stack sequences these three this way",
         ] },
    5: { title: "Twenty-three bytes by default",    build: stageMtu,
         unverified: [] },
    6: { title: "Reading the table, then subscribing", build: stageDiscovery,
         unverified: [
             "how many discovery rounds a real server needs -- it depends "
             + "on its table, and this one has a single service",
         ] },
};

// The real flow, for the journey-wide totals. Stage 2's leading ADV_IND is
// a re-show, so it is dropped here -- counting it would inflate every
// headline on every card by one packet and 38 bytes.
function realFlow(p) {
    return [
        ...stageAdvertising(p),
        ...stageConnect(p).slice(1),
        ...stageFirstEvent(p),
        ...stageNegotiation(p),
        ...stageMtu(p),
        ...stageDiscovery(p),
    ];
}


registerDspAlgorithm("ble_connect", {

    // Interval is the control because it is what makes setup slow: every
    // request/response pair after stage 3 waits a whole interval, so the
    // 338 ms total is mostly this number repeated.
    choices() {
        return [
            {
                key: "intervalMs",
                label: "Interval",
                values: [7.5, 15, 30, 100],
                value: 30,
                display: { 7.5: "7.5 ms", 15: "15 ms", 30: "30 ms", 100: "100 ms" },
            },
        ];
    },

    process(data, parameters) {
        const raw = parameters ?? {};
        const stage = Math.min(6, Math.max(1, raw.stage ?? 1));
        const intervalMs = raw.intervalMs ?? 30;
        const deviceName = raw.deviceName ?? "nRF Temp Demo";

        if (intervalMs <= 0) return { error: "intervalMs must be > 0." };
        if (!deviceName.length) return { error: "deviceName must not be empty." };
        if (deviceName.length > 26) {
            return { error: `deviceName "${deviceName}" leaves no room: `
                          + `flags and a service UUID take 7 of the 31 AdvData bytes.` };
        }

        const p = { intervalMs, intervalUs: intervalMs * 1000, deviceName };
        const def = STAGES[stage];
        const exchanges = def.build(p);

        // ── bytes by role, for the legend ─────────────────────────────
        const roleBytes = {};
        for (const pk of exchanges) {
            for (const fl of pk.fields) {
                roleBytes[fl.role] = (roleBytes[fl.role] ?? 0) + fl.bytes;
            }
        }

        const stageOnAir   = exchanges.reduce((s, x) => s + x.onAirBytes, 0);
        const stageAirtime = exchanges.reduce((s, x) => s + x.airtimeUs, 0);
        const stageElapsed = exchanges.reduce(
            (s, x) => s + x.gapBeforeUs + x.airtimeUs, 0);

        const flow = realFlow(p);
        const journeyOnAir   = flow.reduce((s, x) => s + x.onAirBytes, 0);
        const journeyElapsed = flow.reduce(
            (s, x) => s + x.gapBeforeUs + x.airtimeUs, 0);

        // No glossary here on purpose. The term definitions are a VIEW
        // concern -- they change nothing this function computes -- so
        // they live in catalog/glossaries/wireless.py and arrive on the
        // renderer's config instead. A DSPE should not have to know the
        // card wants to explain itself.

        const oracle = {
            method: "sum of Core-spec field widths; airtime = bits / symbol rate",
            framingBytes: FRAMING,
            tIfsUs: T_IFS_US,
            advDataBytes: advDataBytes(deviceName),
            packetsThisStage: exchanges.length,
            packetsPerStage: Object.keys(STAGES)
                .map(k => STAGES[k].build(p).length),
            stageOnAirBytes: stageOnAir,
            journeyOnAirBytes: journeyOnAir,
            journeyPacketCount: flow.length,
            journeyElapsedUs: journeyElapsed,
            overheadRatio: journeyOnAir / 2,
            // STATED, not hidden: what this oracle does not cover ON THIS
            // STAGE. Empty for the four stages where every claim is exact
            // spec arithmetic. See the note above STAGES.
            unverified: def.unverified,
        };

        return {
            interimOutputs: exchanges.map((x, i) => ({
                id: `pkt_${i}`,
                label: x.name,
                from: x.from,
                bytes: x.onAirBytes,
                fields: x.fields,
            })),

            finalOutput: {
                stage,
                stageTitle: def.title,
                stageCount: 6,

                // Left and right of the canvas. Peripheral on the left
                // because it speaks first, and the eye reads left to right.
                parties: {
                    left:  { id: "peripheral", label: "Peripheral",
                             sub: "your nRF52840 — advertiser, GATT server" },
                    right: { id: "central", label: "Central",
                             sub: "the phone — scanner, GATT client" },
                },

                exchanges,
                roleBytes,
                roleLabels: ROLE_LABELS,

                intervalMs,
                deviceName,

                totals: {
                    stageOnAirBytes: stageOnAir,
                    stageAirtimeUs: stageAirtime,
                    stageElapsedUs: stageElapsed,
                    journeyOnAirBytes: journeyOnAir,
                    journeyPacketCount: flow.length,
                    journeyElapsedUs: journeyElapsed,
                    payloadBytes: 2,
                    overheadRatio: journeyOnAir / 2,
                },

                oracle,
            },
        };
    },
});

})();
