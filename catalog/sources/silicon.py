# ---------------------------------------------------------------------------
# catalog/sources/silicon.py
#
# Chips, as records: year, transistor count, node label, die area, and how
# many dies were in the package.
#
# WHY DIE COUNT IS A COLUMN AND NOT A FOOTNOTE
#   "Transistor count" stops being a single number around 2019. An Epyc
#   Rome package holds nine dies; an M1 Ultra holds two. Quoting their
#   totals beside a single-die Pentium is comparing a package to a chip.
#   Both numbers are true and they answer different questions, so the
#   column exists and stage 3 of the journey is about it. A dataset that
#   hid this would make the most interesting part of the curve a lie.
#
# WHY node_nm IS CALLED A LABEL
#   Through the micron era the node name was a measured dimension. After
#   roughly 22nm it is a generation name and nothing on the die measures
#   it. The field is kept because the DIVERGENCE between what the label
#   implies and what the die achieves is the point of stage 2 -- but it
#   must never be read as a length.
#
# PROVENANCE
#   src="vendor"   the manufacturer published it
#   src="est"      die-shot analysis or press estimate; treat as +/-10%
#
#   Transistor counts are mostly vendor figures and are stable. DIE AREAS
#   are much softer -- many are measured off die photographs -- and every
#   density number in stage 2 is a count divided by one of them. Verify
#   before publishing anything that turns on a specific density value.
# ---------------------------------------------------------------------------

from Services.data_source_store import data_source_store


def _c(name, year, tr, node, area, family, dies=1, src="vendor"):
    return {"name": name, "year": year, "transistors": tr, "nodeNm": node,
            "dieMm2": area, "family": family, "dies": dies, "src": src}


# ── The x86 line ────────────────────────────────────────────────────────
# One vendor lineage from the first microprocessor to a recent desktop
# part. Using a single family for the headline fit avoids the usual
# cheat of picking whichever chip that year was largest.
_X86 = [
    _c("Intel 4004",      1971,         2_300, 10_000,  12, "x86", src="est"),
    _c("Intel 8008",      1972,         3_500, 10_000,  14, "x86", src="est"),
    _c("Intel 8080",      1974,         4_500,  6_000,  20, "x86", src="est"),
    _c("Intel 8086",      1978,        29_000,  3_000,  33, "x86"),
    _c("Intel 80286",     1982,       134_000,  1_500,  49, "x86"),
    _c("Intel 80386DX",   1985,       275_000,  1_500, 104, "x86"),
    _c("Intel 80486DX",   1989,     1_180_000,  1_000, 173, "x86"),
    _c("Pentium",         1993,     3_100_000,    800, 294, "x86"),
    _c("Pentium Pro",     1995,     5_500_000,    500, 307, "x86"),
    _c("Pentium II",      1997,     7_500_000,    350, 203, "x86"),
    _c("Pentium III",     1999,     9_500_000,    250, 128, "x86"),
    _c("Pentium 4",       2000,    42_000_000,    180, 217, "x86"),
    _c("Itanium 2",       2003,   220_000_000,    130, 374, "x86"),
    _c("Core 2 Duo",      2006,   291_000_000,     65, 143, "x86"),
    _c("Core i7 (45nm)",  2008,   731_000_000,     45, 263, "x86"),
    _c("Sandy Bridge 4C", 2011, 1_160_000_000,     32, 216, "x86", src="est"),
    _c("Ivy Bridge 4C",   2012, 1_400_000_000,     22, 160, "x86", src="est"),
    _c("Skylake 4C",      2015, 1_750_000_000,     14, 122, "x86", src="est"),
]

# ── Apple silicon ───────────────────────────────────────────────────────
# A second lineage on a different foundry, useful because it runs through
# exactly the years when the node label stopped meaning anything.
_APPLE = [
    _c("Apple A7",   2013,   1_000_000_000, 28, 102.0, "apple", src="est"),
    _c("Apple A11",  2017,   4_300_000_000, 10,  87.7, "apple"),
    _c("Apple A12",  2018,   6_900_000_000,  7,  83.3, "apple"),
    _c("Apple A13",  2019,   8_500_000_000,  7,  98.5, "apple"),
    _c("Apple A14",  2020,  11_800_000_000,  5,  88.0, "apple"),
    _c("Apple M1",   2020,  16_000_000_000,  5, 119.0, "apple", src="est"),
    _c("Apple M1 Max", 2021, 57_000_000_000, 5, 432.0, "apple", src="est"),
    _c("Apple M2",   2022,  20_000_000_000,  5, 155.0, "apple", src="est"),
]

# ── Large parallel dies ─────────────────────────────────────────────────
# GPUs are where the biggest single dies live, and they make the point
# that the curve's ceiling is set by what a reticle can print.
_GPU = [
    _c("NVIDIA G80",   2006,    681_000_000, 90, 484, "gpu"),
    _c("NVIDIA GT200", 2008,  1_400_000_000, 65, 576, "gpu"),
    _c("NVIDIA GF100", 2010,  3_000_000_000, 40, 529, "gpu"),
    _c("NVIDIA GK110", 2013,  7_100_000_000, 28, 561, "gpu"),
    _c("NVIDIA GP100", 2016, 15_300_000_000, 16, 610, "gpu"),
    _c("NVIDIA GV100", 2017, 21_100_000_000, 12, 815, "gpu"),
    _c("NVIDIA GA100", 2020, 54_200_000_000,  7, 826, "gpu"),
    _c("NVIDIA H100",  2022, 80_000_000_000,  5, 814, "gpu"),
]

# ── Multi-die packages ──────────────────────────────────────────────────
# These are the records stage 3 exists for. dies > 1, and the transistor
# figure is a PACKAGE total. Die area is the summed silicon, which is why
# their density stays ordinary while their count looks extraordinary.
_MULTI = [
    _c("AMD Epyc Rome",   2019,  39_540_000_000, 7, 1008, "multi", dies=9, src="est"),
    _c("Apple M1 Ultra",  2022, 114_000_000_000, 5,  864, "multi", dies=2, src="est"),
]


SAMPLES = {
    "moore_x86":   {"chips": _X86,
                    "note": "The x86 line, 4004 to Skylake -- one lineage, 44 years"},
    "moore_apple": {"chips": _APPLE,
                    "note": "Apple silicon, through the years the node label broke"},
    "moore_gpu":   {"chips": _GPU,
                    "note": "The biggest single dies anyone prints"},
    "moore_all":   {"chips": _X86 + _APPLE + _GPU + _MULTI,
                    "note": "Everything, including multi-die packages"},
}


def _provider(sample_id: str) -> dict:
    s = SAMPLES.get(sample_id)
    if s is None:
        raise FileNotFoundError(sample_id)
    chips = sorted(s["chips"], key=lambda c: (c["year"], c["transistors"]))
    return {
        "arrays": {
            "year":        [c["year"] for c in chips],
            "transistors": [c["transistors"] for c in chips],
            "nodeNm":      [c["nodeNm"] for c in chips],
            "dieMm2":      [c["dieMm2"] for c in chips],
            "dies":        [c["dies"] for c in chips],
        },
        # Names and provenance are not numeric series, so they travel in
        # meta. The renderer needs names to label points and needs `src`
        # to mark estimated values differently from published ones.
        "meta": {
            "names":    [c["name"] for c in chips],
            "families": [c["family"] for c in chips],
            "src":      [c["src"] for c in chips],
            "note":     s["note"],
            "count":    len(chips),
        },
    }


def _lister(limit: int, offset: int) -> dict:
    ids = list(SAMPLES.keys())
    page = ids[offset:offset + limit]
    return {"samples": [{"record_id": i, "label": SAMPLES[i]["note"]} for i in page],
            "total": len(ids), "offset": offset}


data_source_store.register("silicon_scaling",
    provider      = _provider,
    lister        = _lister,
    adapter       = "multi_to_arrays",
    primary_field = "transistors",
    fs_field      = None,
    label         = "Chip scaling records",
    description   = "Year, transistor count, node label, die area and die count",
    schema        = {"fields": ["arrays.year", "arrays.transistors",
                                "arrays.nodeNm", "arrays.dieMm2",
                                "arrays.dies", "meta.names"],
                     "fs": None, "domain": "compute.silicon"})
