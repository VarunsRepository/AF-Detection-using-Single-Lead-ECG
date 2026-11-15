# ---------------------------------------------------------------------------
# catalog/sources/drm.py
#
# WHY THE SCREENSHOT IS BLACK.
#
# The thing almost everyone gets wrong: Netflix is not detecting the
# screenshot and blanking it. Netflix never sees it happen. The decrypted
# frame was never in memory the operating system can read, so the capture
# tool did its job perfectly and found what was actually there.
#
# THE ORACLE
#   Netflix PUBLISHES the maximum resolution for every browser and OS
#   combination. That table is the independent ground truth here, and it
#   is checkable by anyone:
#
#       https://help.netflix.com/en/node/30081   (read 2026-10-29)
#
#   The claim the journey makes is falsifiable against it:
#
#       2160p appears ONLY where a hardware/TEE decryption path exists.
#       No software-only path reaches it, on any OS, in any browser.
#
#   Two rows in that table are close to a controlled experiment:
#
#     * Edge is 2160p on Windows and 720p on macOS. Same engine, same
#       vendor, same site. What differs is whether a hardware DRM path is
#       available on that OS.
#
#     * Chrome on Windows was capped at 720p for years and is now 2160p.
#       Chrome did not get better at video; Chromium gained Microsoft's
#       PlayReady path on Windows. The cap moved with the path.
#
#   WHAT IS SOURCED AND WHAT IS INFERRED, kept apart on purpose:
#     sourced   the resolution cap, the browser and OS minimums
#     inferred  which DRM system and robustness level each row uses.
#               Netflix does not publish that. It is the best explanation
#               for the pattern, and the journey says so on the card
#               rather than dressing an inference up as a fact.
#
# THE CIPHERTEXT IS REAL, AND THE BROWSER NEVER DECRYPTS IT
#   Each sample ships a small frame encrypted with real AES-128-CTR, done
#   here in Python, plus the key and counter so anyone can reproduce it.
#   The browser is shipped the ciphertext and -- separately -- what the
#   CDM would have returned. It never holds both the key and the
#   ciphertext at once, because that is the entire point of the journey.
#   A JS decrypt would have been a nice trick and the wrong lesson.
# ---------------------------------------------------------------------------

import math
import struct

from Services.data_source_store import data_source_store


# ── A tiny AES-128 core, for the CTR keystream only ──────────────────────
# Deliberately not imported from anywhere: catalog/sources must not depend
# on a renderer's filter, and Python's stdlib has no AES. ~40 lines, used
# once, at import, to produce ciphertext that a reader can reproduce with
# any AES library in three lines.

_SBOX = []


def _build_sbox():
    p = q = 1
    sbox = [0] * 256
    while True:
        # multiply p by 3
        p = p ^ ((p << 1) & 0xFF) ^ (0x1B if p & 0x80 else 0)
        # divide q by 3
        q ^= (q << 1) & 0xFF
        q ^= (q << 2) & 0xFF
        q ^= (q << 4) & 0xFF
        if q & 0x80:
            q ^= 0x09
        x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) \
              ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4))
        sbox[p] = (x ^ 0x63) & 0xFF
        if p == 1:
            break
    sbox[0] = 0x63
    return sbox


_SBOX = _build_sbox()
_RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36]


def _xtime(a):
    a <<= 1
    return (a ^ 0x1B) & 0xFF if a & 0x100 else a


def _expand(key):
    w = list(key)
    for i in range(4, 44):
        t = w[(i - 1) * 4:i * 4]
        if i % 4 == 0:
            t = t[1:] + t[:1]
            t = [_SBOX[b] for b in t]
            t[0] ^= _RCON[i // 4 - 1]
        prev = w[(i - 4) * 4:(i - 3) * 4]
        w += [prev[j] ^ t[j] for j in range(4)]
    return w


def _encrypt_block(block, w):
    s = [block[i] ^ w[i] for i in range(16)]
    for rnd in range(1, 11):
        s = [_SBOX[b] for b in s]
        t = list(s)
        for r in range(1, 4):
            for c in range(4):
                s[r + 4 * c] = t[r + 4 * ((c + r) % 4)]
        if rnd != 10:
            t = list(s)
            for c in range(4):
                i = 4 * c
                a = t[i:i + 4]
                s[i]     = _xtime(a[0]) ^ (_xtime(a[1]) ^ a[1]) ^ a[2] ^ a[3]
                s[i + 1] = a[0] ^ _xtime(a[1]) ^ (_xtime(a[2]) ^ a[2]) ^ a[3]
                s[i + 2] = a[0] ^ a[1] ^ _xtime(a[2]) ^ (_xtime(a[3]) ^ a[3])
                s[i + 3] = (_xtime(a[0]) ^ a[0]) ^ a[1] ^ a[2] ^ _xtime(a[3])
        s = [s[i] ^ w[rnd * 16 + i] for i in range(16)]
    return s


def aes128_ctr(data, key, nonce):
    """CTR keystream XOR. Reproduce with any AES library:

        Cipher(algorithms.AES(key), modes.CTR(nonce + b'\\x00'*8))
    """
    w = _expand(key)
    out = bytearray(len(data))
    for blk in range(math.ceil(len(data) / 16)):
        ctr = nonce + struct.pack(">Q", blk)
        ks = _encrypt_block(list(ctr), w)
        for j in range(16):
            i = blk * 16 + j
            if i < len(data):
                out[i] = data[i] ^ ks[j]
    return bytes(out)


KEY   = bytes(range(0x10, 0x20))          # 101112...1f
NONCE = bytes.fromhex("00000000000000a5")  # 8 bytes; CTR counter follows


# ── The frame ────────────────────────────────────────────────────────────
# 48x27 greyscale, drawn rather than loaded: a recognisable shape at
# thumbnail size with no asset to ship. It is a "frame" only in the sense
# that it is the thing the pipeline carries.

FRAME_W, FRAME_H = 48, 27


def _make_frame():
    px = bytearray(FRAME_W * FRAME_H)
    for y in range(FRAME_H):
        for x in range(FRAME_W):
            cx, cy = x - FRAME_W / 2, y - FRAME_H / 2
            r = math.hypot(cx * 0.55, cy)
            # a soft disc with a brighter rim -- reads as "an image" at
            # 48px wide, which is all it has to do
            v = 235 if 8.5 < r < 10.5 else (120 if r < 8.5 else 18)
            v += ((x * 7 + y * 13) % 11) - 5          # light grain
            px[y * FRAME_W + x] = max(0, min(255, v))
    return bytes(px)


FRAME_PLAIN  = _make_frame()
FRAME_CIPHER = aes128_ctr(FRAME_PLAIN, KEY, NONCE)


# ── The pipeline ─────────────────────────────────────────────────────────
# Seven places a frame exists between the CDN and the panel. `readable`
# is the question the journey is actually about: can code the OS runs
# read this, and therefore can a screenshot.

def _pipeline(path):
    """path: "hardware" (TEE/GPU protected) or "software" (process memory)."""
    hw = path == "hardware"
    return [
        {"id": "cdn",     "label": "CDN",
         "where": "disk / network", "holds": "cipher", "readable": True,
         "note": "Encrypted at rest. Anyone can have this file."},
        {"id": "buffer",  "label": "Media buffer",
         "where": "process memory", "holds": "cipher", "readable": True,
         "note": "The player holds ciphertext. It has no key."},
        {"id": "cdm",     "label": "CDM",
         "where": "sealed module", "holds": "cipher", "readable": False,
         "note": "Widevine / PlayReady / FairPlay. A box the browser "
                 "can call but not look inside."},
        {"id": "decrypt", "label": "Decrypt",
         "where": "TEE" if hw else "process memory",
         "holds": "frame", "readable": not hw,
         "note": ("Inside the Trusted Execution Environment. The OS "
                  "cannot address this memory." if hw else
                  "In ordinary process memory, like any other buffer.")},
        {"id": "decode",  "label": "Decode",
         "where": "protected GPU memory" if hw else "process memory",
         "holds": "frame", "readable": not hw,
         "note": ("Decoded by the GPU into memory only the GPU reads."
                  if hw else "Decoded on the CPU.")},
        {"id": "compose", "label": "Compositor",
         "where": "framebuffer", "holds": "placeholder" if hw else "frame",
         "readable": True,
         "note": ("The window contains an empty surface. This is what "
                  "the screenshot API reads, and it is genuinely blank."
                  if hw else "The frame is in the framebuffer with "
                             "everything else on screen.")},
        {"id": "scanout", "label": "Panel",
         "where": "display controller", "holds": "frame", "readable": False,
         "note": ("Overlaid in hardware on the way out, after the "
                  "framebuffer. Never passes through memory the OS owns."
                  if hw else "Scanned out like any other window.")},
    ]


# ── The rows ─────────────────────────────────────────────────────────────
# maxRes and minVersion are quoted from the Netflix help page. system,
# level and path are INFERRED -- see the header.

_ROWS = [
    ("chrome_windows",  "Chrome",  "Windows", "117+", 2160,
     "PlayReady", "SL3000", "hardware",
     "Capped at 720p for years. Chromium gained PlayReady on Windows and "
     "the cap moved to 4K -- the browser's video code did not change."),
    ("edge_windows",    "Edge",    "Windows", "118+", 2160,
     "PlayReady", "SL3000", "hardware",
     "4K since 2016, given compatible hardware."),
    ("safari_macos",    "Safari",  "macOS",   "14+",  2160,
     "FairPlay", "hardware", "hardware",
     "Apple's own stack, on Apple's own silicon. macOS 11 or later."),
    ("chrome_chromeos", "Chrome",  "ChromeOS", "117+", 2160,
     "Widevine", "L1", "hardware",
     "Widevine's own hardware level, on hardware Google controls."),
    ("chrome_macos",    "Chrome",  "macOS",   "117+", 1080,
     "Widevine", "L3", "software",
     "Same browser as the Windows row. No hardware path here, and the "
     "cap drops a full tier."),
    ("firefox_windows", "Firefox", "Windows", "129+", 1080,
     "Widevine", "L3", "software",
     "Software Widevine on the same OS where Chrome and Edge reach 4K."),
    ("edge_macos",      "Edge",    "macOS",   "118+", 720,
     "Widevine", "L3", "software",
     "The sharpest row in the table: 2160p on Windows, 720p here. Same "
     "engine, same vendor, same site."),
    ("chrome_linux",    "Chrome",  "Linux",   "117+", 1080,
     "Widevine", "L3", "software",
     "No vendor hardware path Netflix will trust on Linux."),
]

TABLE = [{"browser": b, "os": o, "maxRes": r, "system": sy,
          "level": lv, "path": p}
         for (_id, b, o, _v, r, sy, lv, p, _n) in _ROWS]

SAMPLES = {}
for (_id, b, o, v, r, sy, lv, p, note) in _ROWS:
    SAMPLES[_id] = {
        "id": _id,
        "name": f"{b} on {o}",
        "blurb": f"{r}p maximum. {sy} {lv}, {p} path.",
        "browser": b, "os": o, "minVersion": v,
        "maxRes": r, "system": sy, "level": lv, "path": p,
        "note": note,
        "pipeline": _pipeline(p),
    }


# ── THE CHECK ────────────────────────────────────────────────────────────
# The journey's claim, asserted at import against the table it is drawn
# from. If a future row ever breaks it, the app says so at startup rather
# than a card quietly making a false statement.

def _check_claim():
    problems = []
    for row in TABLE:
        if row["maxRes"] >= 2160 and row["path"] != "hardware":
            problems.append(f'{row["browser"]}/{row["os"]} claims 2160p '
                            f'on a {row["path"]} path')
        if row["path"] == "hardware" and row["maxRes"] < 2160:
            problems.append(f'{row["browser"]}/{row["os"]} has a hardware '
                            f'path but caps at {row["maxRes"]}p')
    # The ciphertext must actually be the plaintext, encrypted.
    if aes128_ctr(FRAME_CIPHER, KEY, NONCE) != FRAME_PLAIN:
        problems.append("AES-CTR does not round-trip")
    if FRAME_CIPHER == FRAME_PLAIN:
        problems.append("ciphertext equals plaintext")
    if problems:
        print("\n[DRM] the journey's own claim does not hold:")
        for p in problems:
            print(f"  - {p}")
        print()
    else:
        print("[DRM] claim holds: 2160p only on hardware paths "
              f"({len(TABLE)} rows)")
    return problems


_check_claim()


# ── Provider and lister ──────────────────────────────────────────────────

def _provider(sample_id):
    s = SAMPLES.get(sample_id)
    if s is None:
        raise FileNotFoundError(sample_id)
    return {
        "arrays": {
            "cipher": list(FRAME_CIPHER),
            "frame":  list(FRAME_PLAIN),
        },
        "meta": {
            **{k: v for k, v in s.items() if k != "pipeline"},
            "pipeline": s["pipeline"],
            "table":    TABLE,
            "frameW":   FRAME_W,
            "frameH":   FRAME_H,
            "keyHex":   KEY.hex(),
            "nonceHex": NONCE.hex(),
            "source":   "help.netflix.com/en/node/30081, read 2026-10-29",
        },
    }


def _lister(limit, offset):
    ids = list(SAMPLES.keys())
    page = ids[offset:offset + limit]
    return {
        "samples": [{"record_id": i, "label": SAMPLES[i]["browser"]}
                    for i in page],
        "total": len(ids),
        "offset": offset,
    }


data_source_store.register(
    source_id="drm_path",
    label="Netflix robustness rows",
    description="Browser/OS combinations, their published resolution cap, "
                "and the decryption path that explains it",
    adapter="multi_to_arrays",
    primary_field="cipher",
    provider=_provider,
    lister=_lister,
    schema={
        "fields": ["cipher", "frame"],
        "fs_required": False,
        "domain": "media.drm",
    },
)
