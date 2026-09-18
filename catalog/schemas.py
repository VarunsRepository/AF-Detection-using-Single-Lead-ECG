# ---------------------------------------------------------------------------
# catalog/schemas.py
#
# What each algorithm needs and emits, and what each renderer reads.
# Checked once at startup by journey_bp.validate_all_journeys().
#
# Anything undeclared is SKIPPED rather than failed, so this can grow one
# component at a time -- but an undeclared component is also an
# unvalidated one, so the gaps are real.
#
# Data source schemas live on their own register() call in sources.py,
# not here, because Data_Source_Store owns them.
# ---------------------------------------------------------------------------

from Services.Schema_Registry import schema_registry

schema_registry.declare("pan_tompkins",
    requires = {"fields": ["y", "fs"], "fs_required": True,
                "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.filteredSignal",
                           "finalOutput.peakIndices", "finalOutput.rrIntervalsMs"],
                "domain": "biomedical.ecg"})

# Identical requires to pan_tompkins -- it is the same algorithm. The
# provides list is LONGER because the port emits wavePoints and threshold
# as well. That is safe: schema checking asks whether a consumer's
# required fields are present, so extra fields never break a pairing.
schema_registry.declare("pan_tompkins_py",
    requires = {"fields": ["y", "fs"], "fs_required": True,
                "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.filteredSignal",
                           "finalOutput.peakIndices", "finalOutput.rrIntervalsMs",
                           "finalOutput.wavePoints", "finalOutput.threshold"],
                "domain": "biomedical.ecg"})

schema_registry.declare("hamilton_tompkins",
    requires = {"fields": ["y", "fs"], "fs_required": True,
                "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.filteredSignal",
                           "finalOutput.peakIndices", "finalOutput.rrIntervalsMs"],
                "domain": "biomedical.ecg"})

# Consumes a peak-detection stage's output rather than raw signal --
# which is why it requires filteredSignal/peakIndices, not y/fs.
# wavePoints is NOT required: pan_tompkins emits only R, the Python port
# emits all five, and this stage degrades to R-only markers rather than
# failing when they are absent.
schema_registry.declare("stacked_beats",
    requires = {"fields": ["finalOutput.filteredSignal", "finalOutput.peakIndices"],
                "fs_required": False, "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.beats",
                           "finalOutput.meanBeat", "finalOutput.stats",
                           "finalOutput.rrIntervalsMs",
                           "finalOutput.filteredSignal", "finalOutput.peakIndices"],
                "domain": "biomedical.ecg"})

schema_registry.declare("stacked_beats_view",
    requires = {"fields": ["finalOutput.beats", "finalOutput.meanBeat"]})

schema_registry.declare("db4_wavelet",
    requires = {"fields": ["y", "fs"], "fs_required": True},
    provides = {"fields": ["interimOutputs", "finalOutput.decomposition"]})

schema_registry.declare("chart_v1_canvas",
    requires = {"fields": ["finalOutput.filteredSignal", "finalOutput.peakIndices"]})
schema_registry.declare("chart_v1_webgl",
    requires = {"fields": ["finalOutput.filteredSignal", "finalOutput.peakIndices"]})
schema_registry.declare("chart_v1",
    requires = {"fields": ["finalOutput.filteredSignal", "finalOutput.peakIndices"]})

# AES. Note fs_required is False and the domain is crypto.aes -- together
# these are what make wiring ECG data here, or AES data into Pan-Tompkins,
# a startup error rather than a blank card.
schema_registry.declare("aes128_encrypt",
    requires = {"fields": ["arrays.plaintext", "arrays.key"],
                "fs_required": False, "domains": ["crypto.aes"]},
    provides = {"fields": ["interimOutputs",
                           "finalOutput.ciphertext",
                           "finalOutput.ciphertextHex",
                           "finalOutput.roundKeys"],
                "fs": None, "domain": "crypto.aes"})

# The grid reads interimOutputs, not finalOutput -- it is the first
# renderer here whose axis is STEPS rather than seconds.
schema_registry.declare("aes_state_grid",
    requires = {"fields": ["interimOutputs"]})

# ---------------------------------------------------------------------------
# DSP algorithm registry -- server side.
# Maps algorithm IDs to the static JS file the browser needs to load.
# Only registered algorithms can be used in recipes. The resolve() call
# per request returns ONLY the files a specific journey actually needs.
# ---------------------------------------------------------------------------
