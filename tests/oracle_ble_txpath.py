# ---------------------------------------------------------------------------
# oracle_ble_txpath.py
#
# Independent ground truth for the `ble_txpath` journey.
#
# Per the backlog's third filter, a journey needs an oracle: a separate
# derivation that would catch the animation being wrong. This file is
# that derivation. It shares no code with ble_encapsulation_filter.js or
# ble_tx_timeline_filter.js -- it computes everything from Bluetooth Core
# specification field widths and first principles, and the JS must agree.
#
# WHAT IS SPEC AND WHAT IS A MODEL
#
#   SPEC, exact, not negotiable:
#     ATT notification header      1 byte opcode + 2 byte handle
#     L2CAP basic header           2 byte length + 2 byte channel id
#     Link layer header            2 bytes
#     Message Integrity Check      4 bytes
#     CRC                          3 bytes
#     Access address               4 bytes
#     Preamble                     1 byte at LE 1M, 2 bytes at LE 2M
#     Default ATT MTU              23 bytes
#     Default LL payload maximum   27 bytes
#     T_IFS                        150 us
#     Symbol rate                  1 Msym/s (1M) or 2 Msym/s (2M)
#     Channel selection algo #1    f(n+1) = (f(n) + hop) mod 37
#
#   MODEL, implementation-specific, stated on the card as such:
#     HFXO startup time            ~400 us  (crystal dependent)
#     Radio ramp-up                 ~40 us  (nRF52840 default mode)
#     Transmit buffer count        3        (Zephyr default-ish)
#     Packets drained per event    4        (depends on event length)
#
# Run:  python3 -I oracle_ble_txpath.py
# ---------------------------------------------------------------------------

from dataclasses import dataclass

# ── spec constants ─────────────────────────────────────────────────────
ATT_NOTIFY_HEADER = 3        # opcode(1) + handle(2)
L2CAP_HEADER      = 4        # length(2) + cid(2)
LL_HEADER         = 2
MIC               = 4
CRC               = 3
ACCESS_ADDRESS    = 4
PREAMBLE_1M       = 1
PREAMBLE_2M       = 2

DEFAULT_ATT_MTU       = 23
DEFAULT_LL_PAYLOAD    = 27
T_IFS_US              = 150.0
DATA_CHANNELS         = 37

# ── model constants (not spec) ─────────────────────────────────────────
HFXO_STARTUP_US   = 400.0
RADIO_RAMP_US     = 40.0


# ── layer 1: how big does the packet get ───────────────────────────────

@dataclass
class Layers:
    payload: int
    att: int
    l2cap: int
    ll: int
    encrypted: int
    on_air: int


def encapsulate(payload_bytes: int, encrypted: bool = True, phy: str = "1M") -> Layers:
    """Grow a payload through every layer. Pure addition of spec field widths."""
    att       = payload_bytes + ATT_NOTIFY_HEADER
    l2cap     = att + L2CAP_HEADER
    ll        = l2cap + LL_HEADER
    enc       = ll + (MIC if encrypted else 0)
    preamble  = PREAMBLE_1M if phy == "1M" else PREAMBLE_2M
    on_air    = enc + preamble + ACCESS_ADDRESS + CRC
    return Layers(payload_bytes, att, l2cap, ll, enc, on_air)


def airtime_us(on_air_bytes: int, phy: str = "1M") -> float:
    """Exact. Bits on air divided by the symbol rate. GFSK is 1 bit/symbol."""
    mbps = 1.0 if phy == "1M" else 2.0
    return (on_air_bytes * 8) / mbps


def att_value_limit(mtu: int) -> int:
    """Largest notification value that fits one ATT PDU at this MTU."""
    return mtu - ATT_NOTIFY_HEADER


def fragments_needed(l2cap_bytes: int, ll_payload_max: int = DEFAULT_LL_PAYLOAD) -> int:
    """How many link-layer packets one L2CAP packet becomes."""
    return -(-l2cap_bytes // ll_payload_max)   # ceiling division


# ── layer 2: the connection event timeline ─────────────────────────────

def window_widening_us(interval_ms: float, central_sca_ppm: float,
                       peripheral_sca_ppm: float) -> float:
    """
    The peripheral must open its receive window early and close it late,
    because both clocks drift. Total drift over one interval, in us.
    This is why the LFCLK source is a power decision.
    """
    total_ppm = central_sca_ppm + peripheral_sca_ppm
    return interval_ms * 1000.0 * (total_ppm / 1e6)


def empty_ll_pdu_bytes(phy: str = "1M") -> int:
    """
    An EMPTY link-layer PDU, which is what the peer replies with when it
    has nothing to send. It carries no L2CAP and no ATT content at all --
    just the link-layer framing.

    CAUGHT BY THIS ORACLE DISAGREEING WITH THE JS: the first version of
    this file reused encapsulate(0), which wraps ATT and L2CAP headers
    round it and gives 17 bytes. That is wrong -- an empty PDU has
    nothing above the link layer to wrap. The 7-byte error inflated the
    receive window by 56 us and the per-event total with it. The
    animation was right and the reference was wrong, which is the less
    comfortable way for the check to pay off.
    """
    preamble = PREAMBLE_1M if phy == "1M" else PREAMBLE_2M
    return preamble + ACCESS_ADDRESS + LL_HEADER + CRC   # 10 at LE 1M


def event_awake_us(on_air_bytes: int, phy: str, interval_ms: float,
                   central_sca_ppm: float = 50.0,
                   peripheral_sca_ppm: float = 50.0) -> dict:
    """
    One connection event: our TX plus the peer's reply.

    Called "awake" rather than "radio on" on purpose -- the HFXO startup
    at the front is the crystal stabilising with the radio still off. It
    draws current, so it belongs in an energy budget, but calling it
    radio time would overstate the radio's share.
    """
    empty_pkt = empty_ll_pdu_bytes(phy)
    parts = {
        "hfxo_startup": HFXO_STARTUP_US,
        "tx_ramp":      RADIO_RAMP_US,
        "tx":           airtime_us(on_air_bytes, phy),
        "t_ifs":        T_IFS_US,
        "rx_ramp":      RADIO_RAMP_US,
        "rx_window":    airtime_us(empty_pkt, phy)
                        + 2 * window_widening_us(interval_ms, central_sca_ppm,
                                                 peripheral_sca_ppm),
    }
    parts["total"] = sum(parts.values())
    return parts


# ── layer 3: the hop sequence ──────────────────────────────────────────

def hop_sequence(hop_increment: int, n_events: int, start: int = 0) -> list:
    """Channel selection algorithm #1, full channel map. Exact per spec."""
    out, ch = [], start
    for _ in range(n_events):
        out.append(ch)
        ch = (ch + hop_increment) % DATA_CHANNELS
    return out


def visits_all_channels(hop_increment: int) -> bool:
    """37 is prime, so any non-zero increment generates the whole cycle."""
    return len(set(hop_sequence(hop_increment, DATA_CHANNELS))) == DATA_CHANNELS


# ── layer 4: when does the transmit queue overflow ─────────────────────

def queue_saturation(interval_ms: float, packets_per_event: int) -> float:
    """Maximum sustainable notifications per second. Exact arithmetic."""
    return packets_per_event / (interval_ms / 1000.0)


def queue_fill_time_s(notify_hz: float, interval_ms: float,
                      packets_per_event: int, buffers: int) -> float | None:
    """How long until -ENOMEM, or None if the rate is sustainable."""
    drain_hz = queue_saturation(interval_ms, packets_per_event)
    if notify_hz <= drain_hz:
        return None
    return buffers / (notify_hz - drain_hz)


# ── report ─────────────────────────────────────────────────────────────

def main():
    print("=" * 68)
    print(" ORACLE: ble_txpath")
    print("=" * 68)

    # --- the single RR interval, the journey's running example ---------
    print("\n[1] ONE RR INTERVAL -- 2 bytes, encrypted, LE 1M")
    L = encapsulate(2, encrypted=True, phy="1M")
    rows = [
        ("your value",   L.payload,   ""),
        ("+ ATT",        L.att,       f"+{ATT_NOTIFY_HEADER} opcode 0x1B, handle"),
        ("+ L2CAP",      L.l2cap,     f"+{L2CAP_HEADER} length, CID 0x0004"),
        ("+ link layer", L.ll,        f"+{LL_HEADER} LLID, SN, NESN, MD, len"),
        ("+ MIC",        L.encrypted, f"+{MIC} AES-CCM integrity check"),
        ("on air",       L.on_air,    f"+{PREAMBLE_1M + ACCESS_ADDRESS + CRC} preamble, AA, CRC"),
    ]
    for name, size, note in rows:
        print(f"    {name:<14} {size:>4} bytes   {note}")

    at = airtime_us(L.on_air, "1M")
    print(f"\n    airtime            {at:.0f} us at 1 Mbps")
    print(f"    overhead ratio     {L.on_air / L.payload:.1f}x")
    print(f"    payload fraction   {100 * L.payload / L.on_air:.1f}%")

    # --- the MTU / LL-payload coincidence -----------------------------
    print("\n[2] WHY THE DEFAULTS ARE THE NUMBERS THEY ARE")
    v = att_value_limit(DEFAULT_ATT_MTU)
    l2 = v + ATT_NOTIFY_HEADER + L2CAP_HEADER
    print(f"    default ATT MTU {DEFAULT_ATT_MTU} -> {v} bytes of value")
    print(f"    {v} + {ATT_NOTIFY_HEADER} + {L2CAP_HEADER} = {l2} bytes of L2CAP")
    print(f"    default LL payload max = {DEFAULT_LL_PAYLOAD}")
    print(f"    fragments needed = {fragments_needed(l2)}")
    assert l2 == DEFAULT_LL_PAYLOAD, "the two defaults should coincide exactly"
    print("    -> they coincide EXACTLY. The default MTU exists so that one")
    print("       ATT PDU fits one unfragmented link-layer packet.")

    # --- batching -----------------------------------------------------
    print("\n[3] BATCHING -- ten RR intervals instead of one")
    single_total = 10 * L.on_air
    B = encapsulate(20, encrypted=True, phy="1M")
    print(f"    10 separate notifications  {single_total:>4} bytes on air"
          f"   ({10 * at:.0f} us)")
    print(f"    1 batched notification     {B.on_air:>4} bytes on air"
          f"   ({airtime_us(B.on_air):.0f} us)")
    print(f"    saving                     {single_total / B.on_air:.2f}x")
    print(f"    batched overhead ratio     {B.on_air / B.payload:.2f}x"
          f"  (was {L.on_air / L.payload:.1f}x)")
    print(f"    fragments                  {fragments_needed(B.l2cap)}"
          f"   (20 bytes is exactly the default MTU limit)")

    # --- 2M PHY -------------------------------------------------------
    print("\n[4] LE 2M -- same bytes, half the airtime")
    L2M = encapsulate(2, encrypted=True, phy="2M")
    print(f"    on air {L2M.on_air} bytes (preamble is {PREAMBLE_2M}), "
          f"airtime {airtime_us(L2M.on_air, '2M'):.0f} us")
    print(f"    vs {at:.0f} us at 1M -> {at / airtime_us(L2M.on_air, '2M'):.2f}x less airtime")

    # --- the wait -----------------------------------------------------
    print("\n[5] THE WAIT -- where the elapsed time actually goes")
    for interval in (15.0, 30.0, 1000.0):
        ev = event_awake_us(L.on_air, "1M", interval)
        mean_wait_us = interval * 1000.0 / 2.0
        total_us = mean_wait_us + ev["total"]
        print(f"\n    interval {interval:>7.1f} ms")
        print(f"      mean queue wait   {mean_wait_us:>9.0f} us")
        print(f"      awake             {ev['total']:>9.0f} us"
              f"   (duty {100 * ev['total'] / (interval * 1000):.2f}%)")
        print(f"      of which TX       {ev['tx']:>9.0f} us")
        print(f"      TX as % of total  {100 * ev['tx'] / total_us:>9.2f}%")

    print("\n    breakdown of one connection event at 30 ms:")
    for k, vv in event_awake_us(L.on_air, "1M", 30.0).items():
        if k != "total":
            print(f"      {k:<14} {vv:>8.1f} us")

    print("\n    window widening, 30 ms interval:")
    for ppm, label in ((50, "LFXO crystal, +-50ppm"), (500, "LFRC internal, +-500ppm")):
        w = window_widening_us(30.0, 50.0, ppm)
        print(f"      {label:<26} {w:>7.1f} us each side")
    print("    window widening, 1000 ms interval:")
    for ppm, label in ((50, "LFXO crystal, +-50ppm"), (500, "LFRC internal, +-500ppm")):
        w = window_widening_us(1000.0, 50.0, ppm)
        print(f"      {label:<26} {w:>7.1f} us each side")

    # --- hopping ------------------------------------------------------
    print("\n[6] CHANNEL SELECTION ALGORITHM #1")
    for hop in (5, 7, 11, 16):
        seq = hop_sequence(hop, 8)
        ok = visits_all_channels(hop)
        print(f"    hop={hop:<3} first 8: {seq}  all 37 visited: {ok}")
    bad = [h for h in range(1, 37) if not visits_all_channels(h)]
    print(f"    increments 1..36 failing to cover all channels: {bad or 'none'}")
    print("    -> 37 is prime, so coverage is guaranteed. The 5..16 range in")
    print("       the spec is about interference decorrelation, not coverage.")

    # --- the queue ----------------------------------------------------
    print("\n[7] TRANSMIT QUEUE SATURATION")
    for interval in (15.0, 30.0, 100.0):
        sat = queue_saturation(interval, 4)
        print(f"    interval {interval:>6.1f} ms, 4 packets/event"
              f" -> max {sat:>7.1f} notifications/s")

    print("\n    at 30 ms interval, 4 per event (max 133.3/s), 3 buffers:")
    for rate in (1.0, 100.0, 200.0, 500.0):
        t = queue_fill_time_s(rate, 30.0, 4, 3)
        verdict = "sustainable" if t is None else f"-ENOMEM after {t * 1000:.0f} ms"
        print(f"      notify at {rate:>6.1f}/s -> {verdict}")

    print("\n    one RR interval per beat at 60 bpm = 1 notification/s.")
    print("    Raw ECG at 500 Hz, 2 bytes/sample, batched 10 per packet")
    print("    = 50 notifications/s -- still sustainable, but 50x the")
    print("    radio time of sending RR intervals only.")

    print("\n" + "=" * 68)
    print(" Values the JS must reproduce exactly:")
    print(f"   layerBytes        {[L.payload, L.att, L.l2cap, L.ll, L.encrypted, L.on_air]}")
    print(f"   airtimeUs         {at:.1f}")
    print(f"   overheadRatio     {L.on_air / L.payload:.4f}")
    print(f"   batchedOnAir      {B.on_air}")
    print(f"   batchSavingRatio  {single_total / B.on_air:.4f}")
    print(f"   hop7first8        {hop_sequence(7, 8)}")
    print(f"   satHz_30ms_4pe    {queue_saturation(30.0, 4):.4f}")
    print("=" * 68)


if __name__ == "__main__":
    main()
