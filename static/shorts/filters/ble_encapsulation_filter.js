// ---------------------------------------------------------------------------
// filters/ble_encapsulation_filter.js
//
// Two bytes of data becoming twenty-three bytes on air.
//
// THE MECHANISM
//   A BLE notification is wrapped once per layer on the way down the
//   stack. Each layer prepends or appends a fixed number of bytes:
//
//     ATT          1 opcode + 2 handle               = 3
//     L2CAP        2 length + 2 channel id           = 4
//     Link layer   1 header + 1 length               = 2
//     CCM          4 message integrity check         = 4
//     RADIO        preamble + access address + CRC   = 8  (at LE 1M)
//
//   None of those are tuneable. They are field widths from the Core
//   specification, so a 2-byte RR interval is 23 bytes on air and there
//   is nothing to be done about it -- except send fewer, larger packets,
//   which is the whole lesson of this pack.
//
// WHY THIS IS A JOURNEY AND NOT A DIAGRAM
//   A static exploded-packet diagram is a staple of every BLE tutorial
//   and it teaches the wrong thing: it draws the headers as small
//   annotations round a large payload, because that is what fits on a
//   page. The truth is the reverse. Animating the growth one layer at a
//   time, with the bar to scale, makes the payload visibly shrink to a
//   twelfth of the packet -- and THAT is the fact that changes how you
//   design a sensor.
//
//   The failure it shows: batchCount = 1 is what everyone writes first.
//
// STAGING
//   One DSPE serves six stages via `upToLayer`. Stage N shows the packet
//   after layer N and nothing beyond it, so each card explains exactly
//   one wrapper. Deliberately NOT six DSPEs -- the arithmetic is one
//   function and splitting it would create six places for it to drift.
//
// THE ORACLE  (backlog filter, test 3)
//   oracle_ble_txpath.py recomputes every layer size, the airtime and
//   the batching ratio from the same spec constants, independently, and
//   asserts the MTU coincidence below. Verified agreement:
//
//     layerBytes        [2, 5, 9, 11, 15, 23]
//     airtimeUs         184.0        at LE 1M
//     overheadRatio     11.5
//     batchedOnAir      41 bytes     for 10 readings
//     batchSavingRatio  5.6098
//
//   The arithmetic is exact, so the oracle is not a tolerance check --
//   any disagreement at all is a bug in one of the two files.
//
// NOT MODELLED, deliberately
//   L2CAP credit-based flow control channels, which have their own
//   header; extended advertising PDUs; and the ATT_MTU negotiation
//   exchange itself. Each is a card of its own, not a footnote here.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// ── spec constants ─────────────────────────────────────────────────────
// Named, not inlined. These are Core specification field widths, not
// tuning choices, and the oracle checks against these same numbers.
const ATT_NOTIFY_HEADER = 3;   // opcode 0x1B + 16-bit attribute handle
const L2CAP_HEADER      = 4;   // 16-bit length + 16-bit channel id
const LL_HEADER         = 2;   // LLID/NESN/SN/MD flags byte + length byte
const MIC               = 4;   // AES-CCM message integrity check
const CRC               = 3;   // 24-bit CRC
const ACCESS_ADDRESS    = 4;   // 32-bit, random per connection
const PREAMBLE_1M       = 1;
const PREAMBLE_2M       = 2;

const DEFAULT_ATT_MTU    = 23;
const DEFAULT_LL_PAYLOAD = 27;

// The ATT channel. Fixed by the spec, shown on the L2CAP card because
// "which of several channels" is the only thing L2CAP is doing here.
const CID_ATT = 0x0004;

// ATT opcode for Handle Value Notification. 0x1D would be an Indication,
// which is acknowledged at the application layer -- a different card.
const OPCODE_NOTIFY = 0x1B;


// Builds the full chain. One function, used for every stage and for the
// batching comparison, so a stage cannot disagree with the summary.
function buildLayers(payloadBytes, encrypted, phy) {
    const preamble = phy === "2M" ? PREAMBLE_2M : PREAMBLE_1M;

    const att   = payloadBytes + ATT_NOTIFY_HEADER;
    const l2cap = att + L2CAP_HEADER;
    const ll    = l2cap + LL_HEADER;
    const enc   = ll + (encrypted ? MIC : 0);
    const onAir = enc + preamble + ACCESS_ADDRESS + CRC;

    return [
        {
            id: "payload",
            name: "Your value",
            owner: "your code",
            bytes: payloadBytes,
            added: payloadBytes,
            fields: [{ label: "value", bytes: payloadBytes }],
            note: "the only bytes anyone wanted",
        },
        {
            id: "att",
            name: "ATT",
            owner: "host, your CPU",
            bytes: att,
            added: ATT_NOTIFY_HEADER,
            fields: [
                { label: `opcode 0x${OPCODE_NOTIFY.toString(16).toUpperCase()}`, bytes: 1 },
                { label: "handle", bytes: 2 },
            ],
            note: "says which attribute this is",
        },
        {
            id: "l2cap",
            name: "L2CAP",
            owner: "host, your CPU",
            bytes: l2cap,
            added: L2CAP_HEADER,
            fields: [
                { label: "length", bytes: 2 },
                { label: `CID 0x${CID_ATT.toString(16).padStart(4, "0")}`, bytes: 2 },
            ],
            note: "says this is ATT traffic and not security or signalling",
        },
        {
            id: "ll",
            name: "Link layer",
            owner: "controller, priority 0",
            bytes: ll,
            added: LL_HEADER,
            fields: [
                { label: "LLID / SN / NESN / MD", bytes: 1 },
                { label: "length", bytes: 1 },
            ],
            note: "the acknowledgement bits live here, in two bits",
        },
        {
            id: "mic",
            name: "Encryption",
            owner: "CCM hardware",
            bytes: enc,
            added: encrypted ? MIC : 0,
            fields: encrypted ? [{ label: "MIC", bytes: MIC }] : [],
            note: encrypted
                ? "payload encrypted in place, integrity check appended"
                : "unencrypted link, nothing added",
        },
        {
            id: "radio",
            name: "On air",
            owner: "RADIO hardware",
            bytes: onAir,
            added: preamble + ACCESS_ADDRESS + CRC,
            fields: [
                { label: "preamble", bytes: preamble },
                { label: "access address", bytes: ACCESS_ADDRESS },
                { label: "CRC", bytes: CRC },
            ],
            note: "whitened and GFSK modulated as it goes out",
        },
    ];
}

// Exact. GFSK carries one bit per symbol, so airtime is just bits over
// the symbol rate. No approximation anywhere in this function.
function airtimeUs(onAirBytes, phy) {
    return (onAirBytes * 8) / (phy === "2M" ? 2 : 1);
}

// Ceiling division. How many link-layer packets one L2CAP packet becomes.
function fragmentsNeeded(l2capBytes, llPayloadMax) {
    return Math.ceil(l2capBytes / llPayloadMax);
}


registerDspAlgorithm("ble_encapsulation", {

    // The rail asks the algorithm what can be varied, rather than the
    // recipe asserting it. Batch size IS the lesson, so it is the
    // control that exists. PHY is offered because it changes the
    // airtime without changing a single byte of payload, which is the
    // second most surprising thing in this pack.
    choices() {
        return [
            {
                key: "batchCount",
                label: "Batch",
                values: [1, 2, 5, 10],
                value: 1,
                display: { 1: "1 reading", 2: "2 readings", 5: "5 readings", 10: "10 readings" },
            },
            {
                key: "phy",
                label: "PHY",
                values: ["1M", "2M"],
                value: "1M",
                display: { "1M": "LE 1M", "2M": "LE 2M" },
            },
        ];
    },

    process(data, parameters) {
        const p = parameters ?? {};

        const bytesPerReading = p.bytesPerReading ?? 2;     // one RR interval
        const batchCount      = Math.max(1, p.batchCount ?? 1);
        const encrypted       = p.encrypted ?? true;
        const phy             = p.phy === "2M" ? "2M" : "1M";
        const attMtu          = p.attMtu       ?? DEFAULT_ATT_MTU;
        const llPayloadMax    = p.llPayloadMax ?? DEFAULT_LL_PAYLOAD;

        // How far down the stack this stage has got. 0 = payload only,
        // 5 = on air. One DSPE, six cards.
        const upToLayer = Math.min(5, Math.max(0, p.upToLayer ?? 5));

        const payloadBytes = bytesPerReading * batchCount;

        // ── the MTU ceiling, which bites before anything else ─────────
        // A notification value cannot exceed MTU - 3. At the default MTU
        // that is 20 bytes, which is exactly ten RR intervals -- so the
        // batch control runs out of room at the same moment the lesson
        // lands. That is a coincidence worth pointing at rather than
        // hiding: see attMtuExactlyFitsLl below.
        const attValueLimit = attMtu - ATT_NOTIFY_HEADER;
        const exceedsMtu    = payloadBytes > attValueLimit;

        if (payloadBytes <= 0) {
            return { error: "payload must be at least one byte." };
        }

        const layers    = buildLayers(payloadBytes, encrypted, phy);
        const visible   = layers.slice(0, upToLayer + 1);
        const current   = visible[visible.length - 1];
        const final     = layers[layers.length - 1];

        const fragments = fragmentsNeeded(layers[2].bytes, llPayloadMax);

        // ── the comparison that makes the point ───────────────────────
        // One packet per reading, against one packet for the batch.
        // Both computed by the same buildLayers(), so they cannot drift.
        const singleOnAir  = buildLayers(bytesPerReading, encrypted, phy)[5].bytes;
        const unbatchedSum = singleOnAir * batchCount;

        // ── the independent arithmetic, carried for checking ──────────
        // Not used to drive anything above. oracle_ble_txpath.py derives
        // all of it from the spec constants and the two must agree
        // exactly -- this is integer arithmetic, so there is no
        // tolerance to hide behind.
        const oracle = {
            method: "sum of Core-spec field widths; airtime = bits / symbol rate",
            specConstants: {
                ATT_NOTIFY_HEADER, L2CAP_HEADER, LL_HEADER,
                MIC, CRC, ACCESS_ADDRESS,
                preamble: phy === "2M" ? PREAMBLE_2M : PREAMBLE_1M,
            },
            layerBytes: layers.map(l => l.bytes),
            airtimeUs: airtimeUs(final.bytes, phy),
            overheadRatio: final.bytes / payloadBytes,
            payloadFractionPct: (100 * payloadBytes) / final.bytes,
            unbatchedOnAirBytes: unbatchedSum,
            batchSavingRatio: unbatchedSum / final.bytes,
            fragments,
            // The defaults coincide: MTU 23 -> 20 value bytes, +3 ATT
            // +4 L2CAP = 27 = the default LL payload maximum. Asserted
            // in the Python oracle. If this ever reads false on default
            // parameters, one of the two constants has been edited.
            attMtuExactlyFitsLl:
                (DEFAULT_ATT_MTU - ATT_NOTIFY_HEADER) + ATT_NOTIFY_HEADER + L2CAP_HEADER
                === DEFAULT_LL_PAYLOAD,
        };

        return {
            // Each layer is its own interim output, in stack order. The
            // explainer UI has nothing consuming these yet, but the
            // semantics here are DECLARED rather than emergent -- a
            // named header of known width -- so this is one of the cases
            // the XAI note says is actually solvable.
            interimOutputs: visible.map(l => ({
                id: l.id,
                label: l.name,
                bytes: l.bytes,
                added: l.added,
                fields: l.fields,
            })),

            finalOutput: {
                layers,
                visibleLayers: visible,
                upToLayer,
                currentLayer: current,

                payloadBytes,
                onAirBytes: final.bytes,
                bytesPerReading,
                batchCount,
                phy,
                encrypted,

                airtimeUs: airtimeUs(final.bytes, phy),
                airtimeUsAtCurrentLayer: airtimeUs(current.bytes, phy),
                overheadRatio: final.bytes / payloadBytes,
                payloadFractionPct: (100 * payloadBytes) / final.bytes,

                attMtu,
                attValueLimit,
                exceedsMtu,
                llPayloadMax,
                fragments,

                unbatchedOnAirBytes: unbatchedSum,
                batchSavingRatio: unbatchedSum / final.bytes,

                oracle,
            },
        };
    },
});

})();
