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
            } else {
                renderConfig[payload.key] = payload.value;
            }
        },
        getActiveRenderer() { return activeId; },
        switchRenderer() {
            const ids = config.availableRenderers.map(r => r.id);
            activeId = ids[(ids.indexOf(activeId) + 1) % ids.length];
        },
        applyTheme(theme) {
            renderConfig.signalColor = theme.palette.primary;
            renderConfig.peakMarkerColor = theme.palette.accent;
        },
    };
}
