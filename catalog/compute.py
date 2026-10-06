# ---------------------------------------------------------------------------
# catalog/sources/compute.py
#
# Inputs for computation journeys -- SIMD today, others later. A "sample"
# here is a pair of small integer vectors, authored to make a point:
# ordinary values, values that overflow, values that are already aligned.
# ---------------------------------------------------------------------------

from Services.data_source_store import data_source_store

SIMD_SAMPLES = {
    "simd_basic":    {"a": [10, 20, 30, 40], "b": [1, 2, 3, 4],
                      "note": "The textbook case -- four independent sums"},
    "simd_overflow": {"a": [2147483647, 100, -5, 0], "b": [1, 50, -10, 7],
                      "note": "Lane 0 overflows i32 and WRAPS, as the hardware does"},
    "simd_negative": {"a": [-8, -16, -32, -64], "b": [8, 16, 32, 64],
                      "note": "Negatives cancelling to zero in every lane"},
    "simd_uneven":   {"a": [1, 1000, 7, 65535], "b": [999, 24, 993, 1],
                      "note": "Wildly different magnitudes -- lanes do not interact"},
}


def _simd_provider(sample_id: str) -> dict:
    s = SIMD_SAMPLES.get(sample_id)
    if s is None:
        raise FileNotFoundError(sample_id)
    return {"arrays": {"a": s["a"], "b": s["b"]},
            "meta": {"note": s["note"], "lanes": len(s["a"])}}


def _simd_lister(limit: int, offset: int) -> dict:
    ids = list(SIMD_SAMPLES.keys())
    page = ids[offset:offset + limit]
    return {"samples": [{"record_id": i, "label": SIMD_SAMPLES[i]["note"]}
                        for i in page],
            "total": len(ids), "offset": offset}


data_source_store.register("simd_vectors",
    provider      = _simd_provider,
    lister        = _simd_lister,
    adapter       = "multi_to_arrays",
    primary_field = "a",
    fs_field      = None,
    label         = "SIMD vector pair",
    description   = "Two 4-lane i32 vectors",
    schema        = {"fields": ["arrays.a", "arrays.b", "meta.lanes"],
                     "fs": None, "domain": "compute.simd"})
