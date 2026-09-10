// ---------------------------------------------------------------------------
// stage_interpreter.js
// Reads ONE stage's recipe JSON and builds it: fetches via dataSource,
// runs it through a real dspEngine, renders via a real renderingEngine,
// wires railControls through the dispatcher. This is the "read the whole
// recipe and build a working stage" step -- runs once per stage, unlike
// the dispatcher which runs once per button tap.
//
// Depends on dsp_registry.js (createDspEngine), rendering_registry.js
// (createRenderingEngine), dispatcher.js (dispatch), and
// shared_signal_utils.js (fetchSignal) -- all must load before this file.
// ---------------------------------------------------------------------------

async function interpretStage(stageJson, sampleId, chartContainer, railContainer) {
    // 1. dataSource -- proof only handles HTTP_REST via our existing
    // fetch endpoint; PREVIOUS_STAGE_PIPELINE/WEBSOCKET are real recipe
    // fields not needed for a single first stage, deliberately deferred.
    const raw = await fetchSignal(sampleId);
    if (!raw) return;
    const data = { t: raw.signal.map((_, i) => i / raw.fs), y: raw.signal, fs: raw.fs };

    // 2. Build the live engines from the recipe
    const dspEngine = createDspEngine(stageJson.dspEngine);
    const renderingEngine = createRenderingEngine(stageJson.renderingEngine);
    const context = { dspEngine, renderingEngine, journey: {} }; // journey target stubbed -- single-stage proof has no journey-level speed control yet

    // 3. Run DSP, then render
    function runAndRender() {
        const dspOutput = dspEngine.process(data);
        renderingEngine.render(chartContainer, dspOutput, sampleId, data.fs);
    }
    runAndRender();

    // 4. uiFillers -- plain text, no dispatcher needed
    const titleEl = document.querySelector("#stage-title");
    const captionEl = document.querySelector("#stage-caption");
    if (titleEl) titleEl.textContent = stageJson.uiFillers.title;
    if (captionEl) captionEl.textContent = stageJson.uiFillers.caption;

    // 5. railControls -- built from JSON, wired through the dispatcher
    railContainer.innerHTML = "";
    stageJson.railControls.forEach(control => {
        const btn = document.createElement("button");
        btn.textContent = control.ui.label;
        btn.className = "rail-btn";
        btn.addEventListener("click", () => {
            dispatch(control.action, context);
            runAndRender(); // re-run + re-render so the change is actually visible
        });
        railContainer.appendChild(btn);
    });
}