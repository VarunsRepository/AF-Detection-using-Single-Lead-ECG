// ---------------------------------------------------------------------------
// renderers/null_renderer.js
// Testing stub -- accepts ANY DSP output shape, renders finalOutput as
// formatted JSON so you can inspect what the DSP actually produced.
//
// input_contract: {} (accepts anything -- no required fields)
//
// Use when:
//   real_dsp  + null_renderer → inspect DSP output correctness.
//                               See exactly what pan_tompkins/db4/etc
//                               produces before building a real renderer.
//   null_dsp  + null_renderer → test feed engine mechanics only.
//                               No domain logic at all -- just verifies
//                               pagination, lazy loading, scroll snapping,
//                               tap zones, progress bar, pause/resume,
//                               speed controls, theme cycling all work.
//
// Self-registers into RENDER_ALGORITHMS (rendering_registry.js must load first).
// ---------------------------------------------------------------------------

registerRenderingAlgorithm("null_renderer", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        if (container._fullLayout) Plotly.purge(container);

        // Summarise the output shape without dumping the full signal arrays
        // (which could be 2500 floats -- unreadable). Show length + sample
        // values instead so the card is actually legible.
        function summarise(value) {
            if (Array.isArray(value)) {
                if (value.length === 0) return "[] (empty)";
                const preview = value.slice(0, 3).map(v =>
                    typeof v === "number" ? v.toFixed(4) : JSON.stringify(v)
                );
                return `[${preview.join(", ")}${value.length > 3 ? `, ... (${value.length} total)` : ""}]`;
            }
            if (typeof value === "object" && value !== null) {
                // e.g. decomposition levels in DWT output
                return `{object with keys: ${Object.keys(value).join(", ")}}`;
            }
            return String(value);
        }

        const summary = {};
        for (const [key, val] of Object.entries(dspOutput.finalOutput)) {
            summary[key] = summarise(val);
        }

        container.innerHTML = `
            <div style="
                padding: 20px;
                font-family: 'IBM Plex Mono', monospace;
                font-size: 0.8rem;
                color: #9aa1ab;
                box-sizing: border-box;
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                overflow-y: auto;
            ">
                <div style="color: #e8f4f8; margin-bottom: 12px; font-size: 0.9rem;">
                    NULL RENDERER — DSP output for <strong>${sampleId}</strong>
                </div>
                <div style="color: #747d8c; margin-bottom: 16px;">
                    fs: ${fs}Hz &nbsp;|&nbsp; duration: ${durationMs}ms
                </div>
                <div style="color: #aaa; margin-bottom: 8px;">finalOutput fields:</div>
                ${Object.entries(summary).map(([key, val]) => `
                    <div style="margin-bottom: 8px;">
                        <span style="color: #2dd4bf;">${key}</span>
                        <span style="color: #747d8c;"> → </span>
                        <span style="color: #e8f4f8;">${val}</span>
                    </div>
                `).join("")}
                ${dspOutput.interimOutputs.length > 0 ? `
                    <div style="color: #aaa; margin-top: 16px; margin-bottom: 8px;">
                        interimOutputs: ${dspOutput.interimOutputs.length} step(s)
                    </div>
                    ${dspOutput.interimOutputs.map((step, i) => `
                        <div style="margin-bottom: 4px; color: #747d8c;">
                            [${i}] ${step.label || "?"} 
                            <span style="color: #555;">(${step.tech || ""})</span>
                            <span style="color: #333;"> ${summarise(step.data)}</span>
                        </div>
                    `).join("")}
                ` : `
                    <div style="color: #555; margin-top: 16px;">interimOutputs: [] (empty)</div>
                `}
            </div>
        `;
    },
});