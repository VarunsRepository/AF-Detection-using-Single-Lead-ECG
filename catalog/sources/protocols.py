# ---------------------------------------------------------------------------
# catalog/sources/protocols.py
#
# Embedded bus traffic as SIGNALS, not as diagrams.
#
# WHAT IS STORED, AND WHY IT IS NOT THE WAVEFORM
#
#   A frame is declared the way an engineer would say it out loud -- "send
#   0x4B at 9600, eight bits, no parity" -- and the edge list is COMPUTED
#   from that at import. Storing the edges instead would be storing a
#   derived artifact: unreadable in a diff, impossible to retune, and a
#   second place for the bit timing to be wrong.
#
#   This mirrors the pathway engine's rule that order is not stored but
#   worked out. Here the waveform is not stored but generated, and the
#   decoder then recovers the bytes from it with no knowledge of what was
#   intended.
#
# WHY THE ENCODER AND DECODER ARE IN DIFFERENT LANGUAGES
#
#   The encoder below is Python and runs on the server; the decoder is
#   JavaScript and runs in the browser. They share no code, so the card
#   is a genuine round trip: bytes -> edges -> bytes. If the decoder had
#   been written against the encoder's internals it would agree with
#   itself and prove nothing.
#
#   That is also what makes the second stage honest. Decoding at the
#   wrong baud rate, or the wrong SPI mode, produces whatever those
#   sampling instants actually land on. The garbage is computed, never
#   authored.
#
# TIME UNITS
#
#   Microseconds throughout, as floats. Every line is a list of
#   [t, level] transitions with the initial level at t = 0; a level holds
#   until the next entry. Sampling a line is "the last transition at or
#   before t", which is how a logic analyser reads one and is far more
#   compact than a sampled trace.
# ---------------------------------------------------------------------------

from Services.data_source_store import data_source_store


# ── edge-list helpers ────────────────────────────────────────────────────

class Line:
    """One digital signal. Records only transitions."""

    def __init__(self, label, initial=1):
        self.label = label
        self.edges = [[0.0, initial]]

    def set(self, t, level):
        # A redundant transition is not just wasteful: the decoders below
        # count edges on the clock lines, so an edge that does not change
        # the level would be counted as a clock pulse that never happened.
        if self.edges[-1][1] != level:
            self.edges.append([round(float(t), 4), int(level)])

    def hold_to(self, t):
        self.edges.append([round(float(t), 4), self.edges[-1][1]])

    def dump(self, sid):
        return {"id": sid, "label": self.label, "edges": self.edges}


def _bits_lsb_first(byte, n=8):
    return [(byte >> i) & 1 for i in range(n)]


def _bits_msb_first(value, n=8):
    return [(value >> i) & 1 for i in range(n - 1, -1, -1)]


# ── UART ─────────────────────────────────────────────────────────────────

def encode_uart(spec):
    """
    8-N-1 style asynchronous serial. One line, no clock -- which is the
    whole point of the protocol and the whole source of its fragility:
    the receiver recovers timing from the falling edge of the start bit
    and then free-runs on its own clock. Get that clock wrong and nothing
    complains, you just read different bytes.
    """
    baud = spec["baud"]
    bit = 1_000_000.0 / baud          # microseconds per bit
    parity = spec.get("parity")       # None | "even" | "odd"
    stop_bits = spec.get("stopBits", 1)

    tx = Line("TX", initial=1)
    t = 2 * bit                       # a little idle before the first frame

    for byte in spec["bytes"]:
        tx.set(t, 0)                  # start bit
        t += bit
        ones = 0
        for b in _bits_lsb_first(byte):
            tx.set(t, b)
            ones += b
            t += bit
        if parity:
            p = (ones % 2) if parity == "even" else 1 - (ones % 2)
            tx.set(t, p)
            t += bit
        tx.set(t, 1)                  # stop bit(s)
        t += bit * stop_bits
        t += bit                      # idle between frames

    t += 2 * bit
    tx.hold_to(t)
    return {"lines": [tx.dump("tx")], "tEnd": t,
            "params": {"baud": baud, "parity": parity, "stopBits": stop_bits}}


# ── SPI ──────────────────────────────────────────────────────────────────

def encode_spi(spec):
    """
    Four wires and a clock the master owns, so there is no timing to
    recover and nothing to drift -- which is why SPI is the one bus here
    that cannot be wrong about WHEN, only about WHAT.

      CPOL  the level the clock idles at
      CPHA  0 = sample on the leading edge, 1 = sample on the trailing

    Leading means the first transition away from idle. Data is placed so
    it is stable across its designated sampling edge and changes on the
    other one, which is what the modes actually specify.

    A NOTE ON MODE MISMATCH, since it is the obvious thing to break and
    is NOT what stage two breaks: getting CPHA wrong makes the receiver
    sample at the instant the data is changing. That is a setup and hold
    violation, and its outcome is genuinely indeterminate -- old value,
    new value, or metastable. There is no deterministic wrong byte to
    show, so showing one would be a lie. Bit order is broken instead:
    deterministic, just as common, and identical on the wire.
    """
    hz = spec.get("clockHz", 1_000_000)
    half = 1_000_000.0 / hz / 2.0     # half a clock period
    cpol = spec.get("cpol", 0)
    cpha = spec.get("cpha", 0)

    sclk = Line("SCLK", initial=cpol)
    mosi = Line("MOSI", initial=0)
    miso = Line("MISO", initial=0)
    cs = Line("CS", initial=1)

    t = 4 * half
    cs.set(t, 0)
    t += 2 * half                     # setup time after CS asserts

    out_bits, in_bits = [], []
    for b in spec["mosi"]:
        out_bits += _bits_msb_first(b)
    for b in spec.get("miso", []):
        in_bits += _bits_msb_first(b)
    in_bits += [0] * (len(out_bits) - len(in_bits))

    for i, bit in enumerate(out_bits):
        # Data changes at the period boundary and holds for the whole
        # period, so whichever edge the mode designates lands inside the
        # valid window rather than on its edge.
        mosi.set(t, bit)
        miso.set(t, in_bits[i])
        if cpha == 0:
            sclk.set(t + half / 2, 1 - cpol)        # leading -- sampled
            sclk.set(t + 3 * half / 2, cpol)        # trailing
        else:
            sclk.set(t, 1 - cpol)                   # leading
            sclk.set(t + half, cpol)                # trailing -- sampled
        t += 2 * half

    t += 2 * half
    cs.set(t, 1)
    t += 4 * half
    for ln in (sclk, mosi, miso, cs):
        ln.hold_to(t)

    return {"lines": [cs.dump("cs"), sclk.dump("sclk"),
                      mosi.dump("mosi"), miso.dump("miso")],
            "tEnd": t,
            "params": {"cpol": cpol, "cpha": cpha, "clockHz": hz,
                       "bitOrder": "msb"}}


# ── I2C ──────────────────────────────────────────────────────────────────

def encode_i2c(spec):
    """
    Two wires, open-drain, and the only protocol here where the RECEIVER
    talks back inside the frame: the ninth clock of every byte is left
    free for the addressed device to pull SDA low. Nobody pulls it, the
    line floats high, and that silence is the NACK.

    START and STOP are the two moments SDA is allowed to move while SCL
    is high. Every other transition happens in the low phase, which is
    what makes those two unambiguous.
    """
    hz = spec.get("clockHz", 100_000)
    half = 1_000_000.0 / hz / 2.0
    q = half / 2.0

    scl = Line("SCL", initial=1)
    sda = Line("SDA", initial=1)
    t = 2 * half

    sda.set(t, 0)                     # START: SDA falls while SCL is high
    t += half
    scl.set(t, 0)

    def clock_bit(level, at):
        # Data is placed in the middle of the low phase and read in the
        # middle of the high phase -- the setup and hold the spec asks
        # for, and what makes the mid-high sample point reliable.
        sda.set(at + q, level)
        scl.set(at + half, 1)
        scl.set(at + 2 * half, 0)
        return at + 2 * half

    addr_byte = (spec["address"] << 1) | (0 if spec.get("write", True) else 1)
    payload = [addr_byte] + list(spec.get("bytes", []))
    acks = spec.get("acks", [True] * len(payload))

    for idx, byte in enumerate(payload):
        for b in _bits_msb_first(byte):
            t = clock_bit(b, t)
        # ACK slot. The master releases SDA; a present device pulls it
        # low. 0 = ACK, 1 = NACK -- inverted from every other bit here,
        # which trips people up for ever.
        t = clock_bit(0 if acks[idx] else 1, t)
        if not acks[idx]:
            break

    scl.set(t + q, 1)
    sda.set(t + half, 1)              # STOP: SDA rises while SCL is high
    t += 2 * half
    scl.hold_to(t)
    sda.hold_to(t)

    return {"lines": [scl.dump("scl"), sda.dump("sda")], "tEnd": t,
            "params": {"clockHz": hz}}


# ── CAN ──────────────────────────────────────────────────────────────────

def encode_can(spec):
    """
    Arbitration, which is the one genuinely surprising idea on this list.

    The bus is wired-AND: dominant (0) always beats recessive (1). Every
    node watches the bus while it transmits, and a node that sends
    recessive but reads dominant knows someone with a lower identifier is
    talking, stops, and listens. No collision, no retransmission, no time
    lost -- the winner's frame is never even interrupted.

    Three lines are drawn: what each node INTENDED, and what the bus
    actually carried. The intent lines are not physically observable --
    a probe would only ever see the bus -- but they are the reason the
    card exists, because the divergence is the whole mechanism.

    Bit stuffing is deliberately not modelled; the identifiers below are
    chosen so no run of five identical bits occurs, so no stuff bit would
    have been inserted anyway.
    """
    hz = spec.get("bitrate", 500_000)
    bit = 1_000_000.0 / hz
    nodes = spec["nodes"]             # [{"label":..., "id":...}, ...]

    seqs = []
    for n in nodes:
        seqs.append([0] + _bits_msb_first(n["id"], 11))   # SOF + identifier

    lines = [Line(n["label"], initial=1) for n in nodes]
    bus = Line("BUS", initial=1)
    active = [True] * len(nodes)

    t = 2 * bit
    bit_log = []
    for i in range(len(seqs[0])):
        intents = [seqs[k][i] if active[k] else 1 for k in range(len(nodes))]
        level = 0 if any(v == 0 for v in intents) else 1   # wired-AND
        for k in range(len(nodes)):
            lines[k].set(t, intents[k])
        bus.set(t, level)

        lost = []
        for k in range(len(nodes)):
            if active[k] and intents[k] == 1 and level == 0:
                active[k] = False
                lost.append(k)
        bit_log.append({"index": i, "bus": level,
                        "intents": intents, "lost": lost})
        t += bit

    t += 2 * bit
    for ln in lines + [bus]:
        ln.hold_to(t)

    return {"lines": [ln.dump(f"n{i}") for i, ln in enumerate(lines)]
                     + [bus.dump("bus")],
            "tEnd": t,
            "params": {"bitrate": hz,
                       "nodes": [{"label": n["label"], "id": n["id"]}
                                 for n in nodes],
                       "bitLog": bit_log}}


_ENCODERS = {"uart": encode_uart, "spi": encode_spi,
             "i2c": encode_i2c, "can": encode_can}


def build(spec):
    """
    Declarative spec in, drawable + decodable frame out.

    TWO KINDS OF BREAKAGE, AND WHY THEY CANNOT SHARE A MECHANISM

      receiver  the wire is unchanged and the RECEIVER is misconfigured
                -- wrong baud, wrong bit order. Nothing is re-encoded;
                the decoder is simply handed different settings, and the
                picture stays identical, which IS the lesson.

      world     the wire itself is different -- no device answers, the
                identifiers moved. These need a second encoded frame,
                because the waveform genuinely changed.

    The first version faked the second kind inside the decoder, leaving
    the drawn trace showing an ACK while the readout reported a NACK.
    A card whose picture contradicts its own verdict is worse than no
    card, so a world perturbation now carries a real alternate frame.
    """
    wire = _ENCODERS[spec["protocol"]](spec)
    pert = dict(spec["perturbation"])
    if "altSpec" in spec:
        alt_spec = {**spec, **spec["altSpec"]}
        alt_spec.pop("altSpec", None)
        alt_wire = _ENCODERS[alt_spec["protocol"]](alt_spec)
        pert["mode"] = "world"
        pert["lines"] = alt_wire["lines"]
        pert["tEnd"] = alt_wire["tEnd"]
        pert["params"] = alt_wire["params"]
        pert["expect"] = spec.get("altExpect")
    else:
        pert["mode"] = "receiver"
    return {
        "protocol": spec["protocol"],
        "name": spec["name"],
        "blurb": spec.get("blurb", ""),
        "lines": wire["lines"],
        "tEnd": wire["tEnd"],
        "params": wire["params"],
        # What the decoder SHOULD recover. Shown only after the decode so
        # the card can mark it right or wrong; never fed to the decoder.
        "expect": spec.get("expect"),
        # How stage two breaks this frame. Each protocol names its own
        # failure, the way each pathway names its own regulated step --
        # one stage, twelve different lessons.
        "perturbation": pert,
        "vocabulary": spec.get("vocabulary", {}),
    }


# ── the frames ───────────────────────────────────────────────────────────
# Real device addresses and real command bytes where possible: 0x3C is an
# SSD1306 OLED and 0xAF is its display-on command, so anyone who has
# driven one recognises the traffic.

_SPECS = {
    "uart_byte": {
        "protocol": "uart", "name": "UART · one byte, 9600 8N1",
        "blurb": "No clock wire. The receiver guesses the timing and is usually right.",
        "bytes": [0x4B], "baud": 9600, "parity": None,
        "expect": {"bytes": [0x4B], "text": "K"},
        "perturbation": {"kind": "baud", "baud": 19200,
                         "note": "Receiver set to 19200, sender still at 9600"},
    },
    "uart_word": {
        "protocol": "uart", "name": "UART · 'Hi' with even parity",
        "blurb": "Two frames back to back, each one timed from its own start bit.",
        "bytes": [0x48, 0x69], "baud": 19200, "parity": "even",
        "expect": {"bytes": [0x48, 0x69], "text": "Hi"},
        "perturbation": {"kind": "parity", "parity": "odd",
                         "note": "Receiver expecting odd parity"},
    },
    "spi_mode0": {
        "protocol": "spi", "name": "SPI · mode 0, two bytes",
        "blurb": "Clock idles low, data sampled on the rising edge.",
        "mosi": [0x4B, 0x1C], "miso": [0x00, 0x5A],
        "cpol": 0, "cpha": 0, "clockHz": 1_000_000,
        "expect": {"bytes": [0x4B, 0x1C]},
        "perturbation": {"kind": "bitOrder", "bitOrder": "lsb",
                         "note": "Receiver shifting in LSB first"},
    },
    "spi_mode3": {
        "protocol": "spi", "name": "SPI · mode 3, same two bytes",
        "blurb": "Clock idles high. Same bytes, a visibly different picture.",
        "mosi": [0x4B, 0x1C], "miso": [0x00, 0x5A],
        "cpol": 1, "cpha": 1, "clockHz": 1_000_000,
        "expect": {"bytes": [0x4B, 0x1C]},
        "perturbation": {"kind": "bitOrder", "bitOrder": "lsb",
                         "note": "Receiver shifting in LSB first"},
    },
    "i2c_write": {
        "protocol": "i2c", "name": "I²C · write to an OLED at 0x3C",
        "blurb": "Address, acknowledge, command, acknowledge, stop.",
        "address": 0x3C, "write": True, "bytes": [0xAF],
        "acks": [True, True],
        "expect": {"address": 0x3C, "bytes": [0xAF]},
        "altSpec": {"acks": [False, False]},
        "altExpect": {"address": 0x3C, "bytes": [0xAF]},
        "perturbation": {"kind": "i2cNack",
                         "note": "Nothing at that address — the ninth clock stays high"},
    },
    "i2c_read": {
        "protocol": "i2c", "name": "I²C · read from a sensor at 0x68",
        "blurb": "The R/W bit is the eighth bit of the first byte, not a wire.",
        "address": 0x68, "write": False, "bytes": [0x1D],
        "acks": [True, True],
        "expect": {"address": 0x68, "bytes": [0x1D]},
        "altSpec": {"acks": [False, False]},
        "altExpect": {"address": 0x68, "bytes": [0x1D]},
        "perturbation": {"kind": "i2cNack",
                         "note": "Device busy — it declines to acknowledge"},
    },
    "can_arbitration": {
        "protocol": "can", "name": "CAN · two nodes, one wire, no collision",
        "blurb": "Both start talking. Only one notices it should stop.",
        "nodes": [{"label": "ECU A", "id": 0x123},
                  {"label": "ECU B", "id": 0x127}],
        "bitrate": 500_000,
        "expect": {"winnerNode": 0},
        "altSpec": {"nodes": [{"label": "ECU A", "id": 0x127},
                              {"label": "ECU B", "id": 0x123}]},
        "altExpect": {"winnerNode": 0},
        "perturbation": {"kind": "canSwap",
                         "note": "The two ECUs swap identifiers. Nothing else changes."},
        "vocabulary": {"edge": "bit", "edges": "bits"},
    },
}

PROTOCOL_FRAMES = {k: build(v) for k, v in _SPECS.items()}


# ── data source ──────────────────────────────────────────────────────────

def _protocol_provider(sample_id: str) -> dict:
    frame = PROTOCOL_FRAMES.get(sample_id)
    if frame is None:
        raise FileNotFoundError(sample_id)
    # No signal, only a configuration -- same shape as the ETS and
    # pathway providers. The arrays entry is a placeholder the adapter
    # requires; everything real rides in meta.
    #
    # `note` is hoisted to the top of meta rather than left nested at
    # frame.perturbation.note, because the overlay templating resolves
    # one level ({pathway.name}, {note}) and a two-level path would
    # silently render as the literal braces.
    return {"arrays": {"scenario": [1]},
            "meta": {"frame": frame,
                     "note": frame["perturbation"].get("note", "")}}


def _protocol_lister(limit: int, offset: int) -> dict:
    ids = list(PROTOCOL_FRAMES.keys())
    page = ids[offset:offset + limit]
    return {"samples": [{"record_id": i, "label": PROTOCOL_FRAMES[i]["name"]}
                        for i in page],
            "total": len(ids), "offset": offset}


data_source_store.register("protocol_frame",
    provider      = _protocol_provider,
    lister        = _protocol_lister,
    adapter       = "multi_to_arrays",
    primary_field = "scenario",
    fs_field      = None,
    label         = "Embedded bus frame",
    description   = "Logic-level traffic for UART, SPI, I2C and CAN",
    schema        = {"fields": ["meta.frame"],
                     "fs": None, "domain": "embedded.protocol"})
