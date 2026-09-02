// ---------------------------------------------------------------------------
// stage_engine.js
// The generic "pipe and filter" engine every stage plugs into. Each stage
// registers a PROCESSOR (pure computation -- takes the PREVIOUS stage's
// output as input, returns its own output) and a RENDERER (draws/animates
// that output). A new stage never touches this file, or any other stage's
// code -- it just calls registerStage(stageIdx, {processor, renderer}) from
// its own file. That's what makes stages genuinely plug-and-play: jumping
// straight to Stage 3 automatically runs Stages 0-2 first if needed, and
// once a real Stage 1 exists, Stage 2 will receive ITS output instead of
// Stage 0's directly, with zero changes to Stage 2's own code.
//
// Must load before any file that calls registerStage() or renderStageChart()
// -- i.e. before stage_renderers.js and stage_machine.js.
// ---------------------------------------------------------------------------

const STAGE_DEFINITIONS = {}; // stageIdx -> { processor, renderer }
const stageOutputCache = new Map(); // sampleId -> Map(stageIdx -> output)

function registerStage(stageIdx, definition) {
    // definition: { processor, renderer, dependsOn }
    // dependsOn: the STAGE INDEX this stage explicitly depends on for its
    // input (e.g. 0 to mean "I need Stage 0's output"). Omit it entirely
    // if this stage should start fresh from the raw fetch instead (this is
    // how Stage 0 itself works, and how any future alternate BRANCH --
    // e.g. an FFT-based stage that also starts from raw, rather than
    // building on the waveform stages -- would declare itself too).
    //
    // This is deliberately explicit, not inferred from stageIdx - 1. An
    // earlier version searched backward for "the nearest registered stage"
    // and blindly trusted its output -- which works only by coincidence in
    // a single linear chain, and breaks the moment two stages produce
    // genuinely different shapes (e.g. FFT bins vs. a {t,y,fs} waveform).
    // Declaring the dependency explicitly makes the pipeline's real shape
    // a visible, deliberate choice by whoever writes the stage, rather than
    // something the engine guesses at.
    STAGE_DEFINITIONS[stageIdx] = definition;
}

function getCachedStageOutput(sampleId, stageIdx) {
    const sampleCache = stageOutputCache.get(sampleId);
    return sampleCache ? sampleCache.get(stageIdx) : undefined;
}

function setCachedStageOutput(sampleId, stageIdx, output) {
    if (!stageOutputCache.has(sampleId)) stageOutputCache.set(sampleId, new Map());
    stageOutputCache.get(sampleId).set(stageIdx, output);
}

// Call when something changes a stage's OUTPUT (e.g. Invert flips Stage 0's
// polarity) -- every stage from fromStageIdx onward is now stale for that
// sample and must be recomputed next time it's needed. Purely cosmetic
// global changes (Speed, Color, Theme) do NOT need this -- they don't
// change the DATA, only how it's animated or colored, so cached processor
// output stays valid and only the renderer needs to run again.
function invalidateFromStage(sampleId, fromStageIdx) {
    const sampleCache = stageOutputCache.get(sampleId);
    if (!sampleCache) return;
    Array.from(sampleCache.keys()).forEach(idx => {
        if (idx >= fromStageIdx) sampleCache.delete(idx);
    });
}

// Resolves what a stage's processor should receive as input, by following
// its EXPLICIT dependsOn declaration (see registerStage above) -- not by
// guessing based on stageIdx - 1. A stage with no dependsOn starts fresh
// from the raw fetch; otherwise its declared dependency is run first (if
// not already cached) and its output is handed over directly.
async function resolveStageInput(stageIdx, sampleId) {
    const def = STAGE_DEFINITIONS[stageIdx];
    if (!def) return null;

    const dependsOn = def.dependsOn;
    if (dependsOn === undefined || dependsOn === null) {
        return await fetchSignal(sampleId); // no dependency declared -- this stage starts fresh from the raw signal
    }

    const cachedPrev = getCachedStageOutput(sampleId, dependsOn);
    if (cachedPrev !== undefined) return cachedPrev;
    return await runStageProcessor(dependsOn, sampleId);
}

// Runs (or reuses the cached result of) a stage's processor -- pure
// computation, no rendering. Safe to call repeatedly; only actually
// recomputes if nothing valid is cached (a fresh sample, or something
// called invalidateFromStage on it).
async function runStageProcessor(stageIdx, sampleId) {
    const cached = getCachedStageOutput(sampleId, stageIdx);
    if (cached !== undefined) return cached;

    const def = STAGE_DEFINITIONS[stageIdx];
    if (!def) return null; // no processor registered yet -- an unbuilt placeholder stage

    const input = await resolveStageInput(stageIdx, sampleId);
    if (input == null) return null; // upstream failed (e.g. a fetch error) -- nothing to process

    // Even with an explicit dependsOn, a genuinely wrong declaration is
    // still possible (e.g. a new stage mistakenly wired to a stage that
    // produces a different shape than it expects). Without this try/catch,
    // that shows up as either silent garbage (destructuring a missing key
    // just gives undefined) or a confusing crash deep inside the processor's
    // own math. Catching it HERE, at the one place every stage's processor
    // gets invoked, turns that into one clear, attributable error instead.
    let output;
    try {
        output = await def.processor(input, sampleId);
    } catch (err) {
        console.error(
            `Stage ${stageIdx}'s processor threw for sample ${sampleId} -- ` +
            `likely an input shape mismatch (check that dependsOn: ${def.dependsOn} ` +
            `actually produces what this stage's processor expects):`,
            err
        );
        return null;
    }

    if (output != null) setCachedStageOutput(sampleId, stageIdx, output);
    return output;
}

// The public entry point stage_machine.js calls. Resolves/caches the
// processor's output, then hands it to that stage's renderer. Every stage
// automatically gets input resolution from the previous stage, output
// caching, and a loading-state toggle on the container -- none of that
// needs to be rewritten per stage, which is the actual test of whether this
// is genuinely plug-and-play rather than just organized-looking.
async function renderStageChart(sampleId, stageIdx, container) {
    const def = STAGE_DEFINITIONS[stageIdx];
    if (!def) return; // no renderer registered for this stage yet -- placeholder, nothing to do

    container.classList.add("loading");
    const output = await runStageProcessor(stageIdx, sampleId);
    container.classList.remove("loading");

    if (output == null) return; // processor/upstream failed -- nothing to render; will retry next time this stage is entered

    def.renderer(container, sampleId, output);
}