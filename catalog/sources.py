# ---------------------------------------------------------------------------
# catalog/sources.py
#
# Where data comes from. Each source is one register() call; the generic
# /api/data/<source_id>/<sample_id> route in journey_bp serves every
# provider-backed one, so adding a source needs no new route.
#
# A provider is a plain fn(sample_id) -> dict. What it reads is its own
# business -- WFDB files, a JSON file, a computation.
# ---------------------------------------------------------------------------

from Services.data_source_store import data_source_store

def _ecg_provider(sample_id: str) -> dict:
    """
    One PhysioNet record as JSON. This is the whole of what used to be a
    hand-written Flask route; the generic /api/data route calls it.

    Imported inside the function, not at module top, to avoid a circular
    import -- shorts_bp does not import journey_bp, but keeping this local
    means the order the two are registered in app.py cannot matter.
    """
    from Blueprints.shorts_bp import registry, HARDCODED_FS
    signal = registry.get_individual_record_wfdb(sample_id)
    return {"signal": signal.tolist(), "fs": HARDCODED_FS}


def _ecg_lister(limit: int, offset: int) -> dict:
    from Blueprints.shorts_bp import registry
    return {
        "samples": registry.list_playable_records_with_labels(
                       limit=limit, offset=offset),
        "total":  registry.count_playable_records(),
        "offset": offset,
    }


data_source_store.register("ecg_single",
    provider      = _ecg_provider,
    lister        = _ecg_lister,
    adapter       = "single_to_arrays",
    primary_field = "signal",
    fs_field      = "fs",
    label         = "Single-lead ECG",
    description   = "PhysioNet 2017 record, 300 Hz",
    schema        = {"fields": ["y", "fs", "t", "arrays.signal"],
                     "fs": 300, "domain": "biomedical.ecg"})


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

AES_SAMPLES = {
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


def _hex_to_bytes(h: str) -> list:
    return [int(h[i:i+2], 16) for i in range(0, len(h), 2)]


def _aes_provider(sample_id: str) -> dict:
    sample = AES_SAMPLES.get(sample_id)
    if sample is None:
        raise FileNotFoundError(sample_id)
    return {
        "arrays": {
            "plaintext": _hex_to_bytes(sample["plaintext"]),
            "key":       _hex_to_bytes(sample["key"]),
        },
        # fs is deliberately absent -- AES has no time axis, and declaring
        # fs: None is what stops a time-series DSPE being wired to it.
        "meta": {
            "plaintextHex": sample["plaintext"],
            "keyHex":       sample["key"],
            "note":         sample["note"],
        },
    }


def _aes_lister(limit: int, offset: int) -> dict:
    ids  = list(AES_SAMPLES.keys())
    page = ids[offset:offset + limit]
    return {
        "samples": [{"record_id": sid, "label": AES_SAMPLES[sid]["note"]}
                    for sid in page],
        "total":  len(ids),
        "offset": offset,
    }


data_source_store.register("aes_block",
    provider      = _aes_provider,
    lister        = _aes_lister,
    adapter       = "multi_to_arrays",
    primary_field = "plaintext",
    fs_field      = None,
    label         = "AES-128 block",
    description   = "A 16-byte plaintext and 16-byte key",
    schema        = {"fields": ["arrays.plaintext", "arrays.key",
                                "meta.plaintextHex", "meta.keyHex"],
                     "fs": None, "domain": "crypto.aes"})


# ---------------------------------------------------------------------------
# Schema declarations -- what each algorithm needs and emits, and what each
# renderer reads. Checked once at startup by validate_all_journeys().
# Anything undeclared is skipped rather than failed.
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# 16-bit SPN blocks
#
# spn_avalanche_a/b differ by exactly ONE input bit. Swiping between
# those two cards shows the avalanche effect directly rather than
# asserting it -- which is the whole argument for why four rounds are
# needed.
# ---------------------------------------------------------------------------

SPN_SAMPLES = {
    "spn_classic":     {"pt": "26B7", "key": "3A94D63F",
                        "note": "A typical block and key"},
    "spn_zeros":       {"pt": "0000", "key": "3A94D63F",
                        "note": "All-zero plaintext -- the key alone drives it"},
    "spn_avalanche_a": {"pt": "26B7", "key": "3A94D63F",
                        "note": "Avalanche pair, first block"},
    "spn_avalanche_b": {"pt": "26B6", "key": "3A94D63F",
                        "note": "Avalanche pair -- ONE bit different"},
    "spn_ones":        {"pt": "FFFF", "key": "0123456789ABCDEF"[:8],
                        "note": "All ones against a counting key"},
}


def _spn_provider(sample_id: str) -> dict:
    s = SPN_SAMPLES.get(sample_id)
    if s is None:
        raise FileNotFoundError(sample_id)
    return {
        "arrays": {
            "plaintext": [int(s["pt"][i:i+2], 16) for i in (0, 2)],
            "key":       [int(s["key"][i:i+2], 16) for i in (0, 2, 4, 6)],
        },
        "meta": {"plaintextHex": s["pt"], "keyHex": s["key"], "note": s["note"]},
    }


def _spn_lister(limit: int, offset: int) -> dict:
    ids = list(SPN_SAMPLES.keys())
    page = ids[offset:offset + limit]
    return {"samples": [{"record_id": i, "label": SPN_SAMPLES[i]["note"]}
                        for i in page],
            "total": len(ids), "offset": offset}


data_source_store.register("spn_block",
    provider      = _spn_provider,
    lister        = _spn_lister,
    adapter       = "multi_to_arrays",
    primary_field = "plaintext",
    fs_field      = None,
    label         = "16-bit SPN block",
    description   = "A 16-bit plaintext and 32 bits of key material",
    schema        = {"fields": ["arrays.plaintext", "arrays.key",
                                "meta.plaintextHex", "meta.keyHex"],
                     "fs": None, "domain": "crypto.spn"})
