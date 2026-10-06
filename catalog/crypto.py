# ---------------------------------------------------------------------------
# catalog/sources/crypto.py
#
# Cipher inputs. A "sample" here is not a recording -- it is a plaintext
# and a key, authored by hand rather than measured.
#
# ADDING A CIPHER: define its sample dict and call make_block_source().
# Every block cipher needs the same three things (hex -> bytes, a provider,
# a lister) and they differ only in field widths, so the helper below
# carries them and each new cipher costs a handful of lines rather than a
# copy of the whole pattern.
# ---------------------------------------------------------------------------

import json
import os

from Services.data_source_store import data_source_store

# Cipher sample blocks live in data_cache as JSON so they can be edited
# without a redeploy. The file is WRITTEN FROM THE DEFAULTS BELOW on
# first run rather than being required to exist -- the REFERENCE-v2.csv
# episode is the argument: an app that needs a file someone remembered to
# upload fails on a fresh install, and fails quietly.
CIPHER_DIR = os.path.join("data_cache", "CipherStore")


def load_blocks(name: str, defaults: dict) -> dict:
    """
    Read data_cache/CipherStore/<name>.json, seeding it from `defaults`
    if absent. A malformed or unreadable file falls back to the defaults
    and says so -- a cipher journey with no samples is a blank feed.
    """
    os.makedirs(CIPHER_DIR, exist_ok=True)
    path = os.path.join(CIPHER_DIR, f"{name}.json")

    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(defaults, fh, indent=2)
        print(f"[CIPHER] seeded {path} with {len(defaults)} blocks")
        return dict(defaults)

    try:
        with open(path, "r", encoding="utf-8") as fh:
            loaded = json.load(fh)
        if not isinstance(loaded, dict) or not loaded:
            raise ValueError("file is empty or not an object")
        return loaded
    except Exception as e:
        print(f"[CIPHER] {path} unreadable ({e}) -- using built-in defaults")
        return dict(defaults)


def pin_reference_vector(blocks: dict, sample_id: str, expected: dict) -> None:
    """
    Some blocks are VERIFICATION VECTORS, not ordinary samples --
    aes_fips197 is the FIPS-197 Appendix B worked example, and the whole
    point of showing it is that its intermediates are the published ones.
    Editing it in JSON would silently make the journey teach wrong values
    while every test still passed, because the tests carry their own copy.
    So the code value wins and the edit is reported.
    """
    actual = blocks.get(sample_id)
    if actual and any(actual.get(k) != v for k, v in expected.items()):
        print(f"[CIPHER] {sample_id} differs from the published reference "
              f"vector and has been restored. Edited: "
              f"{ {k: actual.get(k) for k in expected if actual.get(k) != expected[k]} }")
    blocks[sample_id] = {**actual, **expected} if actual else dict(expected)





def hex_to_bytes(h: str) -> list:
    return [int(h[i:i + 2], 16) for i in range(0, len(h), 2)]


def make_block_source(source_id, samples, fields, *, domain,
                      label="", description="", primary_field=None):
    """
    Register a cipher input source.

    samples   {sample_id: {<field>: "<hex>", ..., "note": "..."}}
    fields    the hex-valued keys to expose as byte arrays, in order
    domain    e.g. "crypto.aes" -- what keeps AES data out of an SPN DSPE

    fs_field is always None: a cipher block has no sample rate, and that
    None is precisely what stops a time-series algorithm being wired to it.
    """
    def provider(sample_id: str) -> dict:
        s = samples.get(sample_id)
        if s is None:
            raise FileNotFoundError(sample_id)
        out = {"arrays": {f: hex_to_bytes(s[f]) for f in fields},
               "meta": {"note": s.get("note", "")}}
        for f in fields:
            out["meta"][f + "Hex"] = s[f]
        return out

    def lister(limit: int, offset: int) -> dict:
        ids = list(samples.keys())
        page = ids[offset:offset + limit]
        return {"samples": [{"record_id": i, "label": samples[i].get("note", "")}
                            for i in page],
                "total": len(ids), "offset": offset}

    data_source_store.register(
        source_id,
        provider      = provider,
        lister        = lister,
        adapter       = "multi_to_arrays",
        primary_field = primary_field or fields[0],
        fs_field      = None,
        label         = label,
        description   = description,
        schema        = {"fields": [f"arrays.{f}" for f in fields]
                                   + [f"meta.{f}Hex" for f in fields],
                         "fs": None, "domain": domain})




# ---------------------------------------------------------------------------
# AES sample blocks
#
# Each "sample" is a plaintext/key pair, not a recording. Hex is converted
# to byte arrays server-side so the client needs no hex-parsing adapter --
# multi_to_arrays already handles named arrays of numbers, whatever they
# contain.
#
# Sample 1 is the FIPS-197 Appendix B worked example. Keeping it first
# means the very first card a viewer sees is the one whose every
# intermediate state is published and independently checkable.
# ---------------------------------------------------------------------------

# ── AES-128 ─────────────────────────────────────────────────────────────
# aes_fips197 is FIRST deliberately: it is the FIPS-197 Appendix B worked
# example, so the opening card is the one whose every intermediate state
# is published and independently checkable.
#
# aes_avalanche differs from it by ONE BIT -- swiping between the two
# shows the whole block diverging.
_AES_DEFAULTS = {
    "aes_fips197": {
        "plaintext": "3243f6a8885a308d313198a2e0370734",
        "key":       "2b7e151628aed2a6abf7158809cf4f3c",
        "note":      "FIPS-197 Appendix B worked example",
    },
    "aes_zeros": {
        "plaintext": "00000000000000000000000000000000",
        "key":       "00000000000000000000000000000000",
        "note":      "All zeros -- shows the S-box and Rcon alone driving diffusion",
    },
    "aes_ones": {
        "plaintext": "ffffffffffffffffffffffffffffffff",
        "key":       "000102030405060708090a0b0c0d0e0f",
        "note":      "All ones against a counting key",
    },
    "aes_ascii": {
        "plaintext": "54776f204f6e65204e696e652054776f",   # "Two One Nine Two"
        "key":       "5468617473206d79204b756e67204675",   # "Thats my Kung Fu"
        "note":      "ASCII text block -- FIPS-197 Appendix C style",
    },
    "aes_avalanche": {
        "plaintext": "3243f6a8885a308d313198a2e0370735",   # last bit flipped
        "key":       "2b7e151628aed2a6abf7158809cf4f3c",
        "note":      "One bit different from aes_fips197 -- the avalanche effect",
    },
}

AES_SAMPLES = load_blocks("aes_blocks", _AES_DEFAULTS)

# The FIPS-197 Appendix B pair, restored if edited -- see above.
pin_reference_vector(AES_SAMPLES, "aes_fips197", {
    "plaintext": "3243f6a8885a308d313198a2e0370734",
    "key":       "2b7e151628aed2a6abf7158809cf4f3c",
})

make_block_source("aes_block", AES_SAMPLES, ["plaintext", "key"],
    domain      = "crypto.aes",
    label       = "AES-128 block",
    description = "A 16-byte plaintext and 16-byte key")


# ── 16-bit SPN (Heys' cipher) ───────────────────────────────────────────
# spn_avalanche_a/b also differ by exactly one input bit.
_SPN_DEFAULTS = {
    "spn_classic":     {"plaintext": "26B7", "key": "3A94D63F",
                        "note": "A typical block and key"},
    "spn_zeros":       {"plaintext": "0000", "key": "3A94D63F",
                        "note": "All-zero plaintext -- the key alone drives it"},
    "spn_avalanche_a": {"plaintext": "26B7", "key": "3A94D63F",
                        "note": "Avalanche pair, first block"},
    "spn_avalanche_b": {"plaintext": "26B6", "key": "3A94D63F",
                        "note": "Avalanche pair -- ONE bit different"},
    "spn_ones":        {"plaintext": "FFFF", "key": "0123456789ABCDEF"[:8],
                        "note": "All ones against a counting key"},
}

SPN_SAMPLES = load_blocks("spn_blocks", _SPN_DEFAULTS)

make_block_source("spn_block", SPN_SAMPLES, ["plaintext", "key"],
    domain      = "crypto.spn",
    label       = "16-bit SPN block",
    description = "A 16-bit plaintext and 32 bits of key material")


# ── SHA-1 messages ──────────────────────────────────────────────────────
# Messages, not blocks: a hash takes any length, and the samples are
# chosen to show that. "abc" is the FIPS-180 worked example; the pair
# differing by one letter shows the avalanche.
_SHA1_DEFAULTS = {
    "sha1_abc":       {"message": "616263",
                       "note": "\"abc\" -- the FIPS-180 worked example"},
    "sha1_empty":     {"message": "",
                       "note": "The empty message -- padding alone still fills a block"},
    "sha1_fox":       {"message": "54686520717569636b2062726f776e20666f78206a756d7073"
                                  "206f76657220746865206c617a7920646f67",
                       "note": "\"The quick brown fox jumps over the lazy dog\""},
    "sha1_fox_dot":   {"message": "54686520717569636b2062726f776e20666f78206a756d7073"
                                  "206f76657220746865206c617a7920646f672e",
                       "note": "The same sentence plus one full stop -- watch the digest"},
    "sha1_two_block": {"message": "61626364626364656364656664656667656667686667686967"
                                  "68696a68696a6b696a6b6c6a6b6c6d6b6c6d6e6c6d6e6f6d6e"
                                  "6f706e6f7071",
                       "note": "Long enough to need TWO blocks"},
}

SHA1_SAMPLES = load_blocks("sha1_messages", _SHA1_DEFAULTS)

make_block_source("sha1_message", SHA1_SAMPLES, ["message"],
    domain      = "crypto.sha1",
    label       = "SHA-1 message",
    description = "Any number of bytes -- the digest is always 160 bits")
