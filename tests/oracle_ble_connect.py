# ---------------------------------------------------------------------------
# oracle_ble_connect.py
#
# Independent ground truth for the `ble_connect` journey: every packet
# exchanged from the first advertisement to the first temperature value.
#
# WHAT THIS ORACLE CAN AND CANNOT VERIFY -- read this before trusting it
#
#   CAN, exactly:
#     every field width, from Core specification field definitions
#     every PDU payload total, by addition
#     every on-air total, by adding the framing
#     every ATT and LL control opcode
#     T_IFS, and the two-scale structure of the gaps
#
#   CANNOT:
#     THE ORDER of the link-layer negotiation. Either side may start the
#     feature exchange or the length update, and the three procedures may
#     interleave or run across several connection events. Only
#     LL_PHY_UPDATE_IND is constrained -- central only. The journey picks
#     ONE plausible ordering and its card says so.
#
#     WHETHER A REAL STACK DOES IT THIS WAY. Zephyr, the SoftDevice and
#     iOS all differ in what they request and when. Nothing here is
#     measurement.
#
#   The honest fix for both is a capture: run the nRF Sniffer, export from
#   Wireshark, and assert the journey's packet list against it. That is
#   what _check_against_capture.js is for. Until a capture exists, the
#   journey's ordering is a MODEL and the card must say so -- per the
#   backlog's rule that a journey with no oracle for a claim says so.
#
# Run:  python3 -I oracle_ble_connect.py
# ---------------------------------------------------------------------------

from dataclasses import dataclass, field

# ── framing, every packet pays this ────────────────────────────────────
PREAMBLE_1M    = 1
ACCESS_ADDRESS = 4
LL_HEADER      = 2
CRC            = 3
FRAMING = PREAMBLE_1M + ACCESS_ADDRESS + LL_HEADER + CRC      # 10

# ── layer headers ──────────────────────────────────────────────────────
L2CAP_HEADER      = 4
ATT_OPCODE        = 1
LL_CTRL_OPCODE    = 1

# ── timing ─────────────────────────────────────────────────────────────
T_IFS_US           = 150      # spec, fixed
ADV_CHANNEL_GAP_US = 300      # MODEL: implementation dependent
TX_WINDOW_US       = 1250     # MODEL: windowOffset + 1.25 ms minimum
DEFAULT_INTERVAL_US = 30000   # the recipe's choice, not a spec value

# Roles the bytes are coloured by. Chosen because the question a setup
# journey answers is "what is this byte FOR", not "which layer added it".
ADDRESSING = "addressing"
TIMING     = "timing"
CHANNELS   = "channels"
FRAMING_R  = "framing"
PAYLOAD    = "payload"


@dataclass
class Field:
    label: str
    bytes: int
    role: str


@dataclass
class Packet:
    name: str
    sender: str            # "peripheral" | "central"
    opcode: int | None
    fields: list
    gap_before_us: float
    gap_kind: str          # "spec" | "model"
    note: str = ""
    collapsed: int = 0     # >0 means "and N more like this"

    @property
    def pdu_bytes(self) -> int:
        return sum(f.bytes for f in self.fields)

    @property
    def on_air_bytes(self) -> int:
        return self.pdu_bytes + FRAMING

    @property
    def airtime_us(self) -> float:
        return self.on_air_bytes * 8      # LE 1M


# ── the AdvData the temperature program actually broadcasts ────────────
# Each AD structure is length(1) + type(1) + value. Flags, one 16-bit
# service UUID, and the complete local name from CONFIG_BT_DEVICE_NAME.
DEVICE_NAME = "nRF Temp Demo"

def advdata_bytes() -> int:
    flags = 1 + 1 + 1
    uuid16 = 1 + 1 + 2
    name = 1 + 1 + len(DEVICE_NAME)
    return flags + uuid16 + name


def att(opcode: int, name: str, sender: str, inner: list,
        gap_us: float, gap_kind: str, note: str = "",
        collapsed: int = 0) -> Packet:
    """
    An ATT packet. ATT rides on L2CAP, so the link-layer payload is the
    4-byte L2CAP header plus the 1-byte ATT opcode plus its parameters.
    """
    fields = [
        Field("L2CAP header", L2CAP_HEADER, FRAMING_R),
        Field("ATT opcode", ATT_OPCODE, FRAMING_R),
    ] + inner
    return Packet(name, sender, opcode, fields, gap_us, gap_kind, note, collapsed)


def ll_ctrl(opcode: int, name: str, sender: str, inner: list,
            gap_us: float, gap_kind: str, note: str = "") -> Packet:
    """A link-layer control PDU: opcode plus parameters, no L2CAP."""
    fields = [Field("LL opcode", LL_CTRL_OPCODE, FRAMING_R)] + inner
    return Packet(name, sender, opcode, fields, gap_us, gap_kind, note)


# ── the six stages ─────────────────────────────────────────────────────

def stage_1_advertising() -> list:
    adv = lambda ch, gap, kind: Packet(
        f"ADV_IND (ch {ch})", "peripheral", None,
        [Field("AdvA", 6, ADDRESSING),
         Field("AdvData", advdata_bytes(), PAYLOAD)],
        gap, kind, note=f"channel {ch}")
    return [adv(37, 0, "spec"),
            adv(38, ADV_CHANNEL_GAP_US, "model"),
            adv(39, ADV_CHANNEL_GAP_US, "model")]


def stage_2_connect() -> list:
    adv = stage_1_advertising()[0]
    conn = Packet(
        "CONNECT_IND", "central", None,
        [Field("InitA", 6, ADDRESSING),
         Field("AdvA", 6, ADDRESSING),
         Field("Access address", 4, ADDRESSING),
         Field("CRC init", 3, FRAMING_R),
         Field("Window size", 1, TIMING),
         Field("Window offset", 2, TIMING),
         Field("Interval", 2, TIMING),
         Field("Latency", 2, TIMING),
         Field("Timeout", 2, TIMING),
         Field("Channel map", 5, CHANNELS),
         Field("Hop + SCA", 1, CHANNELS)],
        T_IFS_US, "spec",
        note="150 us after the advertisement it heard")
    return [adv, conn]


def stage_3_first_event() -> list:
    empty = lambda sender, gap, kind, note: Packet(
        "Empty PDU", sender, None, [], gap, kind, note=note)
    return [empty("central", TX_WINDOW_US, "model",
                  "the transmit window CONNECT_IND specified"),
            empty("peripheral", T_IFS_US, "spec",
                  "acknowledges via NESN")]


def stage_4_ll_negotiation() -> list:
    feat = lambda op, name, sender, gap, kind: ll_ctrl(
        op, name, sender, [Field("FeatureSet", 8, PAYLOAD)], gap, kind)
    length = lambda op, name, sender, gap, kind: ll_ctrl(
        op, name, sender,
        [Field("Max RX octets", 2, PAYLOAD),
         Field("Max RX time", 2, TIMING),
         Field("Max TX octets", 2, PAYLOAD),
         Field("Max TX time", 2, TIMING)], gap, kind)
    phy = lambda op, name, sender, gap, kind: ll_ctrl(
        op, name, sender,
        [Field("TX PHYs", 1, CHANNELS),
         Field("RX PHYs", 1, CHANNELS)], gap, kind)

    return [
        feat(0x08, "LL_FEATURE_REQ", "central", DEFAULT_INTERVAL_US, "model"),
        feat(0x0E, "LL_FEATURE_RSP", "peripheral", T_IFS_US, "spec"),
        length(0x14, "LL_LENGTH_REQ", "central", DEFAULT_INTERVAL_US, "model"),
        length(0x15, "LL_LENGTH_RSP", "peripheral", T_IFS_US, "spec"),
        phy(0x16, "LL_PHY_REQ", "central", DEFAULT_INTERVAL_US, "model"),
        phy(0x17, "LL_PHY_RSP", "peripheral", T_IFS_US, "spec"),
        ll_ctrl(0x18, "LL_PHY_UPDATE_IND", "central",
                [Field("PHY central to peripheral", 1, CHANNELS),
                 Field("PHY peripheral to central", 1, CHANNELS),
                 Field("Instant", 2, TIMING)],
                DEFAULT_INTERVAL_US, "model",
                note="central only -- the one ordering the spec does fix"),
    ]


def stage_5_mtu() -> list:
    return [
        att(0x02, "ATT_EXCHANGE_MTU_REQ", "central",
            [Field("Client RX MTU", 2, PAYLOAD)],
            DEFAULT_INTERVAL_US, "model",
            note="first packet whose payload is L2CAP, not control"),
        att(0x03, "ATT_EXCHANGE_MTU_RSP", "peripheral",
            [Field("Server RX MTU", 2, PAYLOAD)],
            T_IFS_US, "spec",
            note="agreed value is the smaller of the two"),
    ]


def stage_6_discovery() -> list:
    # One service, one characteristic, one descriptor -- the temperature
    # program's table exactly. Entry sizes are the spec's: a service entry
    # is two handles plus a 16-bit UUID; a characteristic entry is a
    # handle, properties, a value handle and a UUID; a descriptor entry is
    # a handle and a UUID.
    return [
        att(0x10, "ATT_READ_BY_GROUP_TYPE_REQ", "central",
            [Field("Start handle", 2, ADDRESSING),
             Field("End handle", 2, ADDRESSING),
             Field("UUID 0x2800", 2, PAYLOAD)],
            DEFAULT_INTERVAL_US, "model", note="list your primary services"),
        att(0x11, "ATT_READ_BY_GROUP_TYPE_RSP", "peripheral",
            [Field("Entry length", 1, FRAMING_R),
             Field("Start handle", 2, ADDRESSING),
             Field("End handle", 2, ADDRESSING),
             Field("Service UUID", 2, PAYLOAD)],
            T_IFS_US, "spec", note="one entry: 0x181A at handles 1-4"),

        att(0x08, "ATT_READ_BY_TYPE_REQ", "central",
            [Field("Start handle", 2, ADDRESSING),
             Field("End handle", 2, ADDRESSING),
             Field("UUID 0x2803", 2, PAYLOAD)],
            DEFAULT_INTERVAL_US, "model",
            note="same opcode number as LL_FEATURE_REQ, different namespace"),
        att(0x09, "ATT_READ_BY_TYPE_RSP", "peripheral",
            [Field("Entry length", 1, FRAMING_R),
             Field("Declaration handle", 2, ADDRESSING),
             Field("Properties", 1, PAYLOAD),
             Field("Value handle", 2, ADDRESSING),
             Field("Char UUID", 2, PAYLOAD)],
            T_IFS_US, "spec", note="0x2A6E, notify, value at handle 3"),

        # Round three, and the one the renderer collapses. The viewer has
        # now seen the request/response shape twice in full; a third and
        # fourth identical round teaches only that there are many of
        # them, which a "x N more" marker says faster.
        att(0x04, "ATT_FIND_INFORMATION_REQ", "central",
            [Field("Start handle", 2, ADDRESSING),
             Field("End handle", 2, ADDRESSING)],
            DEFAULT_INTERVAL_US, "model", collapsed=2,
            note="anything after the value?"),
        att(0x05, "ATT_FIND_INFORMATION_RSP", "peripheral",
            [Field("Format", 1, FRAMING_R),
             Field("Handle", 2, ADDRESSING),
             Field("Descriptor UUID", 2, PAYLOAD)],
            T_IFS_US, "spec", collapsed=2, note="the CCCD, handle 4"),

        # CAUGHT BY READING THE ORACLE'S OWN OUTPUT: the error response
        # had no request in front of it. A client does not receive an
        # ATT_ERROR_RSP out of nowhere -- it asks once more, for a range
        # past the end of the table, and THAT is what fails. Without this
        # packet the journey would show an unprompted error, which is
        # both wrong and the more confusing kind of wrong.
        att(0x04, "ATT_FIND_INFORMATION_REQ", "central",
            [Field("Start handle", 2, ADDRESSING),
             Field("End handle", 2, ADDRESSING)],
            DEFAULT_INTERVAL_US, "model",
            note="asking past the end of the table"),
        att(0x01, "ATT_ERROR_RSP", "peripheral",
            [Field("Failed opcode", 1, FRAMING_R),
             Field("Handle", 2, ADDRESSING),
             Field("Error 0x0A", 1, PAYLOAD)],
            T_IFS_US, "spec",
            note="Attribute Not Found -- how the client learns it is done"),

        att(0x12, "ATT_WRITE_REQ", "central",
            [Field("Handle 4", 2, ADDRESSING),
             Field("Value 0x0001", 2, PAYLOAD)],
            DEFAULT_INTERVAL_US, "model", note="subscribe, by writing the CCCD"),
        att(0x13, "ATT_WRITE_RSP", "peripheral", [],
            T_IFS_US, "spec", note="bare acknowledgement"),

        att(0x1B, "ATT_HANDLE_VALUE_NTF", "peripheral",
            [Field("Handle 3", 2, ADDRESSING),
             Field("Temperature", 2, PAYLOAD)],
            DEFAULT_INTERVAL_US, "model",
            note="the first value -- 0x0929, 23.45 degrees"),
    ]


STAGES = {
    1: ("Shouting into an empty room", stage_1_advertising),
    2: ("One packet makes a connection", stage_2_connect),
    3: ("Alive, and carrying nothing", stage_3_first_event),
    4: ("Agreeing what both can do", stage_4_ll_negotiation),
    5: ("Twenty-three bytes by default", stage_5_mtu),
    6: ("Reading the table, then subscribing", stage_6_discovery),
}


def main():
    print("=" * 72)
    print(" ORACLE: ble_connect")
    print("=" * 72)

    grand_pdu = grand_air = 0
    grand_time = 0.0
    counts = {}

    for n, (title, builder) in STAGES.items():
        pkts = builder()
        counts[n] = len(pkts)
        print(f"\n── stage {n}: {title} "
              f"({len(pkts)} packet{'s' if len(pkts) != 1 else ''})")
        print(f"   {'packet':<30} {'op':>4} {'PDU':>4} {'air':>4} "
              f"{'us':>6}  {'gap':>8}  sender")
        for p in pkts:
            op = f"0x{p.opcode:02X}" if p.opcode is not None else "--"
            gap = f"{p.gap_before_us:.0f}{'*' if p.gap_kind == 'model' else ''}"
            print(f"   {p.name:<30} {op:>4} {p.pdu_bytes:>4} "
                  f"{p.on_air_bytes:>4} {p.airtime_us:>6.0f}  {gap:>8}  {p.sender}")
            grand_pdu += p.pdu_bytes
            grand_air += p.on_air_bytes
            grand_time += p.gap_before_us + p.airtime_us

    print("\n   * gap is a MODEL value, not a spec constant")

    # ── the headline arithmetic ────────────────────────────────────────
    # Counted over the REAL FLOW, not over the stage draws. Stage 2
    # re-shows the ADV_IND so the CONNECT_IND has something to answer,
    # and counting that twice would inflate every headline on the card.
    # The per-stage totals above are draws; these are packets.
    real = (stage_1_advertising() + stage_2_connect()[1:]
            + stage_3_first_event() + stage_4_ll_negotiation()
            + stage_5_mtu() + stage_6_discovery())
    real_air  = sum(p.on_air_bytes for p in real)
    real_time = sum(p.gap_before_us + p.airtime_us for p in real)
    real_airtime = sum(p.airtime_us for p in real)

    print("\n" + "=" * 72)
    print(f" {len(real)} packets to deliver 2 bytes of temperature")
    print(f"   bytes on air                   {real_air}")
    print(f"   airtime only                   {real_airtime:.0f} us")
    print(f"   elapsed including gaps         {real_time / 1000:.1f} ms")
    print(f"   useful payload                 2 bytes")
    print(f"   ratio                          {real_air / 2:.0f}x")
    print(f"   (stage draws total {sum(counts.values())}, because stage 2")
    print(f"    re-shows the advertisement -- not counted above)")

    # ── per-stage packet counts, which the JS must match ──────────────
    print("\n Values the JS must reproduce exactly:")
    print(f"   packetsPerStage   {[counts[n] for n in sorted(counts)]}")
    print(f"   advDataBytes      {advdata_bytes()}")
    print(f"   advIndOnAir       {stage_1_advertising()[0].on_air_bytes}")
    print(f"   connectIndPdu     {stage_2_connect()[1].pdu_bytes}")
    print(f"   connectIndOnAir   {stage_2_connect()[1].on_air_bytes}")
    print(f"   emptyPduOnAir     {stage_3_first_event()[0].on_air_bytes}")
    print(f"   totalOnAir        {real_air}")
    print(f"   realPacketCount   {len(real)}")
    print(f"   tIfsUs            {T_IFS_US}")

    # ── roles, so the renderer's legend is complete ───────────────────
    roles = {}
    for _, builder in STAGES.values():
        for p in builder():
            for f in p.fields:
                roles[f.role] = roles.get(f.role, 0) + f.bytes
    print(f"\n bytes by role (the colour legend):")
    for r, b in sorted(roles.items(), key=lambda kv: -kv[1]):
        print(f"   {r:<12} {b:>4}")

    print("\n NOT VERIFIED BY THIS ORACLE: the ordering of stage 4, and")
    print(" whether any real stack sequences it this way. Capture and")
    print(" check with _check_against_capture.js.")
    print("=" * 72)


if __name__ == "__main__":
    main()
