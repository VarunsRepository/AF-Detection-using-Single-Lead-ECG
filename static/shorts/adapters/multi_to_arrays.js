// ---------------------------------------------------------------------------
// adapters/multi_to_arrays.js
//
// Adapter for APIs that return multiple named arrays.
// e.g. {channels: {lead_I: [...], lead_II: [...], ...}, fs: 300}
//      {speeds: {earth: [...], mars: [...], ...}, fs: null}
//      {arrays: {x: [...], y_pos: [...], z: [...]}, sampleRate: 100}
//
// The primary array (config.primaryField) becomes data.y for backward
// compatibility with all existing DSP algorithms. Multi-array DSPs
// read data.arrays["lead_II"] etc.
//
// Self-registers into DATA_ADAPTERS (data_registry.js must load first).
// ---------------------------------------------------------------------------

registerDataAdapter("multi_to_arrays", {
    normalise(payload, config) {
        const primaryField  = config.primaryField  || "signal";
        const fsField       = config.fsField       || "fs";

        // Find the arrays container -- try common field names
        const rawArrays = payload.channels
                       ?? payload.arrays
                       ?? payload.signals
                       ?? payload.speeds
                       ?? payload.data
                       ?? {};

        const fs = fsField
            ? (payload[fsField] ?? payload.fs ?? payload.sampleRate ?? null)
            : null;

        // Convert all arrays to Float32Array
        const arrays = {};
        for (const [key, val] of Object.entries(rawArrays)) {
            if (Array.isArray(val) || ArrayBuffer.isView(val)) {
                arrays[key] = new Float32Array(val);
            }
        }

        // Primary array -- what data.y points to
        // Falls back to first available array if primaryField not found
        const primaryKey = arrays[primaryField]
            ? primaryField
            : Object.keys(arrays)[0];

        const y = arrays[primaryKey] ?? new Float32Array(0);
        const t = fs ? new Float32Array(y.length).map((_, i) => i / fs) : null;

        return {
            fs,
            duration: fs ? y.length / fs : null,
            arrays,                 // all named arrays
            y,                      // primary array -- backward compat
            t,
            raw:  payload,
            meta: payload.meta ?? {},
            // Expose available array names for DSPs and REs that want to
            // let users switch between channels
            labels: Object.keys(arrays),
        };
    }
});
