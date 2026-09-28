// ---------------------------------------------------------------------------
// dsp_registry.js  --  THIN execution layer, ~30 lines
//
// Previously: held a hardcoded DSP_ALGORITHMS dict with all algorithm
// implementations baked in, loaded unconditionally regardless of which
// algorithms a journey actually needs.
//
// Now: just an empty dict + a registration function. Each filter file
// self-registers via registerDspAlgorithm() when loaded. The server
// (dsp_store.py) decides which filter files get sent to the browser per
// journey -- so a DWT journey never loads pan_tompkins_filter.js, and an
// ECG journey never loads db4_filter.js.
//
// Load order: this file MUST load before any filter file, since filter
// files call registerDspAlgorithm() on load.
// ---------------------------------------------------------------------------

const DSP_ALGORITHMS = {};

function registerDspAlgorithm(id, impl) {
    if (DSP_ALGORITHMS[id]) {
        console.warn(`DSP registry: "${id}" already registered -- skipping duplicate.`);
        return;
    }
    DSP_ALGORITHMS[id] = impl;
}

function createDspEngine(config) {
    let activeId = config.availableAlgorithms.find(a => a.isDefault).id;
    let parameters = { ...config.parameters };

    return {
        process(data) {
            const algo = DSP_ALGORITHMS[activeId];
            if (!algo) {
                console.error(`DSP registry: no algorithm registered for "${activeId}". Was its filter file loaded?`);
                return null;
            }
            return algo.process(data, parameters);
        },
        getParameter(key) { return parameters[key]; },
        setParameter(payload) {
            if (payload.operation === "toggle") {
                parameters[payload.key] = !parameters[payload.key];
            } else if (payload.operation === "cycle") {
                // Step through a fixed list. "toggle" only covers two
                // states and only booleans; a route (aerobic, anaerobic,
                // fermentation) is neither. Unknown current values start
                // at the first option rather than failing, so a recipe
                // whose default is not in the list still behaves.
                const opts = payload.options ?? [];
                if (opts.length) {
                    const i = opts.indexOf(parameters[payload.key]);
                    parameters[payload.key] = opts[(i + 1) % opts.length];
                }
            } else {
                parameters[payload.key] = payload.value;
            }
        },
        getParameter(key) { return parameters[key]; },
        getActiveAlgorithm() { return activeId; },
        switchAlgorithm() {
            const ids = config.availableAlgorithms.map(a => a.id);
            activeId = ids[(ids.indexOf(activeId) + 1) % ids.length];
        },
    };
}
