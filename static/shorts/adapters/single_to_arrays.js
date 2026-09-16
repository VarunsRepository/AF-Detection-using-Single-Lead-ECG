// ---------------------------------------------------------------------------
// adapters/single_to_arrays.js
//
// Adapter for APIs that return a single array + sample rate.
// e.g. {signal: [...], fs: 300}
//      {mono: [...], sampleRate: 44100}
//      {data: [...], fs: 250}
//
// Self-registers into DATA_ADAPTERS (data_registry.js must load first).
// ---------------------------------------------------------------------------

registerDataAdapter("single_to_arrays", {
    normalise(payload, config) {
        // Find the primary array -- try config.primaryField first,
        // then common fallback names
        const primaryField = config.primaryField || "signal";
        const fsField      = config.fsField      || "fs";

        const rawArray = payload[primaryField]
                      ?? payload.signal
                      ?? payload.data
                      ?? payload.samples
                      ?? [];

        const fs = fsField
            ? (payload[fsField] ?? payload.fs ?? payload.sampleRate ?? null)
            : null;

        const y = new Float32Array(rawArray);
        const t = fs ? new Float32Array(y.length).map((_, i) => i / fs) : null;

        return {
            // Standard envelope fields
            fs,
            duration: fs ? y.length / fs : null,
            arrays:   { [primaryField]: y },   // named by the field it came from
            y,                                  // backward compat -- all DSPs read this
            t,
            raw:  payload,
            meta: payload.meta ?? {},
        };
    }
});
