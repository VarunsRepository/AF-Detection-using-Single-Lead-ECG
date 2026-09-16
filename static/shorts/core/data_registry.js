// ---------------------------------------------------------------------------
// core/data_registry.js
//
// Client-side data source registry. Mirrors Data_Source_Store.py.
//
// DATA_SOURCES is populated at page load from the template -- the server
// resolves which sources are needed for this batch and inlines their
// configs as JSON. Each config tells this module which endpoint to fetch
// from and which JS adapter to use.
//
// STANDARD ENVELOPE -- what every DSP algorithm can rely on:
//   {
//     fs:       number | null,   // sample rate (null if not time-series)
//     duration: number | null,   // seconds (null if no fs)
//     arrays:   {                // ALL arrays from the API response
//       "signal": Float32Array,  // named by the API field names
//       "lead_II": Float32Array, // or whatever the source provides
//       ...
//     },
//     y:        Float32Array,    // primary array -- backward compat with all DSPs
//     t:        Float32Array,    // time vector (null if no fs)
//     raw:      {},              // original API payload, unchanged
//     meta:     {},              // any metadata from the API
//   }
//
// All existing DSP algorithms read data.y and data.fs -- they work
// unchanged. New multi-array DSPs read data.arrays["lead_II"] etc.
//
// Depends on: adapter files must load before this is called.
//   adapters/single_to_arrays.js
//   adapters/multi_to_arrays.js
// ---------------------------------------------------------------------------

// Populated by registerDataSource() calls from adapter files + template
const DATA_SOURCES = {};

// Cache keyed by "sampleId::sourceId" -- same sample, different source =
// different cache entry. Replacing the old fetchedSignalCache in
// shared_signal_utils.js which was keyed only by sampleId.
const dataEnvelopeCache = new Map();

// Adapter registry -- populated by adapter files self-registering
const DATA_ADAPTERS = {};

function registerDataSource(sourceId, config) {
    DATA_SOURCES[sourceId] = config;
}

function registerDataAdapter(adapterId, impl) {
    // impl must have: normalise(payload, config) → standard envelope
    DATA_ADAPTERS[adapterId] = impl;
}

async function fetchAndNormalise(sampleId, sourceId) {
    const cacheKey = `${sampleId}::${sourceId}`;
    if (dataEnvelopeCache.has(cacheKey)) {
        return dataEnvelopeCache.get(cacheKey);
    }

    const config = DATA_SOURCES[sourceId];
    if (!config) {
        console.error(`[DATA REGISTRY] sourceId "${sourceId}" not registered.`,
            `Registered sources: ${Object.keys(DATA_SOURCES).join(", ")}`);
        return null;
    }

    const adapter = DATA_ADAPTERS[config.adapter];
    if (!adapter) {
        console.error(`[DATA REGISTRY] adapter "${config.adapter}" not registered.`,
            `Registered adapters: ${Object.keys(DATA_ADAPTERS).join(", ")}`);
        return null;
    }

    try {
        const url = config.endpointTemplate.replace("{id}", sampleId);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Server returned ${res.status} for ${url}`);
        const payload = await res.json();

        const envelope = adapter.normalise(payload, config);

        dataEnvelopeCache.set(cacheKey, envelope);
        return envelope;

    } catch (err) {
        console.error(`[DATA REGISTRY] Failed to fetch "${sampleId}" from source "${sourceId}":`, err);
        return null;
    }
}

// Convenience: get samples list endpoint for a given sourceId
// Used by journey_scroll_feed.js for pagination
function getSamplesEndpoint(sourceId) {
    const config = DATA_SOURCES[sourceId];
    if (!config) return null;
    // Strip /{id}/... from template to get collection endpoint
    // /shorts/api/sample/{id}/raw → /shorts/api/samples
    const base = config.endpointTemplate.split("/{id}")[0];
    return base + "s";
}

// Look up an already-fetched envelope without triggering a fetch.
// Returns null if this sample hasn't been loaded yet.
//
// sourceId is optional: the dev HUD knows which sample is on screen but
// not which source it came from, so omitting it matches the first cache
// entry for that sampleId. Callers that know the source should pass it.
function getCachedEnvelope(sampleId, sourceId = null) {
    if (sourceId) {
        return dataEnvelopeCache.get(`${sampleId}::${sourceId}`) ?? null;
    }
    for (const [key, envelope] of dataEnvelopeCache) {
        if (key.startsWith(`${sampleId}::`)) return envelope;
    }
    return null;
}
