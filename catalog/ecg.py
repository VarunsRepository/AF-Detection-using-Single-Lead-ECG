# ---------------------------------------------------------------------------
# catalog/sources/ecg.py
#
# PhysioNet 2017 single-lead ECG. Signals come from WFDB files on disk;
# the class labels come from REFERENCE-v2.csv via the registry manager,
# cached here as a record_id -> label map.
# ---------------------------------------------------------------------------

from Services.data_source_store import data_source_store

# record_id -> label ("N" | "A" | "O" | "~"), built once on first use.
#
# The registry exposes labels only through its paginated listing, so the
# table is pulled once and cached. Built in PAGES rather than one giant
# call: a single limit=8528 request assumes the registry honours an
# arbitrary limit, and if it silently caps the page size the map ends up
# holding only the first slice -- every later record then reads as
# unclassified, with nothing to indicate why.
_ECG_LABELS: dict = {}
_ECG_LABEL_STATUS: dict = {"built": False}


def _build_ecg_labels():
    global _ECG_LABELS, _ECG_LABEL_STATUS
    from Blueprints.shorts_bp import registry

    labels, page, offset, pages = {}, 500, 0, 0
    total = registry.count_playable_records()
    missing_key = 0

    while offset < total and pages < 200:          # 200 pages = hard stop
        rows = registry.list_playable_records_with_labels(limit=page, offset=offset)
        if not rows:
            break                                   # registry ran out early
        for r in rows:
            rid = r.get("record_id")
            if rid is None:
                continue
            if "label" not in r:
                missing_key += 1
            labels[rid] = r.get("label")
        offset += len(rows)
        pages  += 1

    _ECG_LABELS = labels
    _ECG_LABEL_STATUS = {
        "built": True,
        "records_reported_by_registry": total,
        "records_mapped": len(labels),
        "rows_without_a_label_key": missing_key,
        "labels_seen": sorted({v for v in labels.values() if v is not None}),
        "null_labels": sum(1 for v in labels.values() if v is None),
        "sample": dict(list(labels.items())[:5]),
        "error": None,
    }


def _ecg_label(sample_id: str):
    if not _ECG_LABEL_STATUS.get("built"):
        try:
            _build_ecg_labels()
        except Exception as e:
            # A missing label must never break playback -- the card says
            # "unclassified" instead. But record WHY, or the two cases
            # (no label vs lookup failed) are indistinguishable.
            _ECG_LABEL_STATUS.update(
                {"built": True, "error": f"{type(e).__name__}: {e}",
                 "records_mapped": 0})
            print(f"[DATA] could not build ECG label map: {e}")
    return _ECG_LABELS.get(sample_id)


def _ecg_label_status() -> dict:
    """Served by /api/data/ecg_single/status."""
    if not _ECG_LABEL_STATUS.get("built"):
        _ecg_label("__probe__")
    return _ECG_LABEL_STATUS


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
    return {"signal": signal.tolist(), "fs": HARDCODED_FS,
            "meta": {"record_id": sample_id, "label": _ecg_label(sample_id)}}


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
    status        = _ecg_label_status,
    adapter       = "single_to_arrays",
    primary_field = "signal",
    fs_field      = "fs",
    label         = "Single-lead ECG",
    description   = "PhysioNet 2017 record, 300 Hz",
    schema        = {"fields": ["y", "fs", "t", "arrays.signal",
                                "meta.label", "meta.record_id"],
                     "fs": 300, "domain": "biomedical.ecg"})
