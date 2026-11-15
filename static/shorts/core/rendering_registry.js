// ---------------------------------------------------------------------------
// rendering_registry.js  --  THIN execution layer, ~35 lines
//
// Same pattern as dsp_registry.js. Previously held all renderer
// implementations hardcoded. Now: empty dict + registerRenderingAlgorithm().
// Each renderer file (renderers/chart_v1.js, etc.) self-registers when
// loaded. The server (rendering_store.py) resolves which renderer files a
// journey needs and passes only those URLs to the template.
//
// Load order: this file MUST load before any renderer file.
// ---------------------------------------------------------------------------

const RENDER_ALGORITHMS = {};

function registerRenderingAlgorithm(id, impl) {
    if (RENDER_ALGORITHMS[id]) {
        console.warn(`Rendering registry: "${id}" already registered -- skipping duplicate.`);
        return;
    }
    RENDER_ALGORITHMS[id] = impl;
}

function createRenderingEngine(config) {
    let activeId = config.availableRenderers.find(r => r.isDefault).id;
    let renderConfig = { ...config.config };

    return {
        render(container, dspOutput, sampleId, fs, durationMs) {
            const renderer = RENDER_ALGORITHMS[activeId];
            if (!renderer) {
                console.error(`Rendering registry: no renderer registered for "${activeId}". Was its file loaded?`);
                return;
            }
            renderer.render(container, dspOutput, renderConfig, sampleId, fs, durationMs);
        },
        getParameter(key) { return renderConfig[key]; },
        setParameter(payload) {
            if (payload.operation === "toggle") {
                renderConfig[payload.key] = !renderConfig[payload.key];
            } else if (payload.operation === "cycle") {
                // Mirrors dsp_registry's cycle: step through a list.
                // Needed for view preferences that are one of several
                // states rather than on/off -- which line of a pathway
                // step gets the emphasis, for instance.
                const opts = payload.options ?? [];
                if (opts.length) {
                    const i = opts.indexOf(renderConfig[payload.key]);
                    renderConfig[payload.key] = opts[(i + 1) % opts.length];
                }
            } else {
                renderConfig[payload.key] = payload.value;
            }
        },
        getParameter(key) { return renderConfig[key]; },
        getActiveRenderer() { return activeId; },
        switchRenderer() {
            const ids = config.availableRenderers.map(r => r.id);
            activeId = ids[(ids.indexOf(activeId) + 1) % ids.length];
        },
        // The RECIPE's globalThemes palette, not the visual theme -- two
        // different things that unhelpfully share a name (see
        // getActiveTheme in journey_interpreter vs getActiveVisualTheme in
        // rail_controls).
        //
        // peakMarkerColor NO LONGER SET HERE. It used to copy the recipe's
        // accent into the renderer config, which is why the peak dot was
        // the same orange on every theme: a per-journey colour overriding
        // what should be a global look. The marker now comes from
        // --peak-marker-color, and every renderer falls back to its config
        // value if no theme publishes one -- so a recipe that still
        // declares peakMarkerColor keeps working, it just stops winning.
        //
        // signalColor is left in place: nothing this repo currently reads
        // uses it, and removing a config key blind is how a renderer
        // discovers a dependency at runtime.
        applyTheme(theme) {
            renderConfig.signalColor = theme?.palette?.primary;
        },
    };
}
