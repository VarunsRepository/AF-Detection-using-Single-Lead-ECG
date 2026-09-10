// ---------------------------------------------------------------------------
// stage_engine.js
// The generic "pipe and filter" engine, now supporting MULTIPLE independent
// journeys at once -- each journey (a stable string name, e.g. "ecg",
// "dwt") owns its OWN set of registered stages and its OWN output cache,
// namespaced so two journeys can each register a "stage 0" without
// colliding.
//
// This replaces an earlier version where STAGE_DEFINITIONS was a single
// FLAT table keyed by bare stageIdx -- meaning a second journey's stage 0
// would have silently overwritten the ECG pipeline's. Every function below
// now takes journeyName as its first argument. A new stage never touches
// this file, or any other stage's code -- it just calls
// registerStage(journeyName, stageIdx, {processor, renderer}) from its own
// file. That's what makes stages genuinely plug-and-play, now across
// multiple journeys, not just within one.
//
// Must load before any file that calls registerStage() or renderStageChart()
// -- i.e. before any journey's stage-registration file and stage_machine.js.
// ---------------------------------------------------------------------------

const STAGE_DEFINITIONS = {}; // journeyName -> { stageIdx -> { processor, renderer, dependsOn, label } }
const stageOutputCache = new Map(); // journeyName -> Map(sampleId -> Map(stageIdx -> output))

function registerStage(journeyName, stageIdx, definition) {
    // definition: { processor, renderer, dependsOn, label, railControls }
    // dependsOn: the STAGE INDEX (WITHIN THIS SAME JOURNEY) this stage
    // explicitly depends on for its input. Omit it entirely if this stage
    // should start fresh from the raw fetch instead (this is how each
    // journey's own entry-point stage works).
    //
    // This is deliberately explicit, not inferred from stageIdx - 1 --
    // see the original single-journey design notes for why guessing based
    // on numeric adjacency is unsafe once stages can produce genuinely
    // different shapes.
    //
    // label: { main, small, blurb } -- descriptive metadata, co-located
    // HERE with each stage's own processor/renderer. Stage-bar labels and
    // onboarding both read from this, per journey.
    //
    // railControls: an array of rail-button data-role strings that only
    // make sense while THIS stage is active (e.g. ["algo"] for a peak-
    // detection stage). Omit entirely for a stage with no stage-specific
    // controls. See getStageRailControls/getAllStageScopedRailRoles above
    // for how this gets turned into actual show/hide behavior.
    if (!STAGE_DEFINITIONS[journeyName]) STAGE_DEFINITIONS[journeyName] = {};
    STAGE_DEFINITIONS[journeyName][stageIdx] = definition;
}

function getStageLabel(journeyName, stageIdx) {
    const journeyStages = STAGE_DEFINITIONS[journeyName];
    const def = journeyStages && journeyStages[stageIdx];
    return def && def.label; // { main, small, blurb } or undefined if this stage isn't registered yet
}

// railControls: an array of rail-button data-role strings this stage wants
// shown ONLY while it's active (e.g. ["prefilter"] for Stage 1, ["algo"]
// for Stage 2). Declared alongside processor/renderer/label in the SAME
// registerStage() call -- the whole point being that a stage's own
// definition is the ONE place that says which controls belong to it,
// rather than a hand-written CSS rule elsewhere that could silently drift
// out of sync (exactly what happened before this existed: the CSS
// visibility rules and the actual stage registrations were two separate
// sources of truth with nothing keeping them consistent).
function getStageRailControls(journeyName, stageIdx) {
    const journeyStages = STAGE_DEFINITIONS[journeyName];
    const def = journeyStages && journeyStages[stageIdx];
    return (def && def.railControls) || [];
}

// The union of every railControls entry across EVERY stage in a journey.
// This is what lets stage_machine.js tell "stage-scoped" controls (only
// meaningful for specific stages) apart from "global" ones (Speed, Invert,
// Theme -- visible everywhere, never mentioned in any railControls) --
// WITHOUT needing a separate marker on the buttons themselves. A control's
// global-vs-scoped status is derived entirely from whether any stage ever
// claims it, not declared twice.
function getAllStageScopedRailRoles(journeyName) {
    const journeyStages = STAGE_DEFINITIONS[journeyName];
    if (!journeyStages) return [];
    const allRoles = new Set();
    Object.values(journeyStages).forEach(def => {
        (def.railControls || []).forEach(role => allRoles.add(role));
    });
    return Array.from(allRoles);
}

function getRegisteredStageCount(journeyName) {
    const journeyStages = STAGE_DEFINITIONS[journeyName];
    return journeyStages ? Object.keys(journeyStages).length : 0;
}

function getJourneyCache(journeyName) {
    if (!stageOutputCache.has(journeyName)) stageOutputCache.set(journeyName, new Map());
    return stageOutputCache.get(journeyName);
}

function getCachedStageOutput(journeyName, sampleId, stageIdx) {
    const journeyCache = stageOutputCache.get(journeyName);
    if (!journeyCache) return undefined;
    const sampleCache = journeyCache.get(sampleId);
    return sampleCache ? sampleCache.get(stageIdx) : undefined;
}

function setCachedStageOutput(journeyName, sampleId, stageIdx, output) {
    const journeyCache = getJourneyCache(journeyName);
    if (!journeyCache.has(sampleId)) journeyCache.set(sampleId, new Map());
    journeyCache.get(sampleId).set(stageIdx, output);
}

// Call when something changes a stage's OUTPUT (e.g. Invert flips Stage 0's
// polarity) -- every stage from fromStageIdx onward, WITHIN THAT JOURNEY,
// is now stale for that sample. Purely cosmetic global changes (Speed,
// Theme) do NOT need this.
function invalidateFromStage(journeyName, sampleId, fromStageIdx) {
    const journeyCache = stageOutputCache.get(journeyName);
    if (!journeyCache) return;
    const sampleCache = journeyCache.get(sampleId);
    if (!sampleCache) return;
    Array.from(sampleCache.keys()).forEach(idx => {
        if (idx >= fromStageIdx) sampleCache.delete(idx);
    });
}

// Same idea, but for a GLOBAL change WITHIN one journey (e.g. switching
// which peak-detection algorithm is active) -- every sample cached under
// THAT journey gets walked, not samples belonging to a different journey.
function invalidateFromStageForAllSamples(journeyName, fromStageIdx) {
    const journeyCache = stageOutputCache.get(journeyName);
    if (!journeyCache) return;
    for (const sampleId of journeyCache.keys()) {
        invalidateFromStage(journeyName, sampleId, fromStageIdx);
    }
}

// Resolves what a stage's processor should receive as input, by following
// its EXPLICIT dependsOn declaration WITHIN THE SAME JOURNEY.
async function resolveStageInput(journeyName, stageIdx, sampleId) {
    const journeyStages = STAGE_DEFINITIONS[journeyName];
    const def = journeyStages && journeyStages[stageIdx];
    if (!def) return null;

    const dependsOn = def.dependsOn;
    if (dependsOn === undefined || dependsOn === null) {
        // No dependency declared -- this stage starts fresh from the raw
        // signal fetch. Shared across every journey today (both "ecg" and
        // "dwt" operate on the same underlying ECG recordings); a future
        // journey needing a genuinely different data source would need
        // this single line revisited, not the rest of the engine.
        return await fetchSignal(sampleId);
    }

    const cachedPrev = getCachedStageOutput(journeyName, sampleId, dependsOn);
    if (cachedPrev !== undefined) return cachedPrev;
    return await runStageProcessor(journeyName, dependsOn, sampleId);
}

// Runs (or reuses the cached result of) a stage's processor, WITHIN ONE
// JOURNEY. Safe to call repeatedly; only recomputes if nothing valid is
// cached for that journey+sample+stage combination.
async function runStageProcessor(journeyName, stageIdx, sampleId) {
    const cached = getCachedStageOutput(journeyName, sampleId, stageIdx);
    if (cached !== undefined) return cached;

    const journeyStages = STAGE_DEFINITIONS[journeyName];
    const def = journeyStages && journeyStages[stageIdx];
    if (!def) return null; // no processor registered for this journey+stage combination

    const input = await resolveStageInput(journeyName, stageIdx, sampleId);
    if (input == null) return null; // upstream failed -- nothing to process

    // Even with an explicit dependsOn, a wrong declaration is still
    // possible. Catching HERE turns a shape-mismatch crash into one
    // clear, attributable error naming the JOURNEY too, not just the
    // stage -- important now that the same stageIdx number can exist
    // simultaneously in multiple journeys.
    let output;
    try {
        output = await def.processor(input, sampleId);
    } catch (err) {
        console.error(
            `[${journeyName}] Stage ${stageIdx}'s processor threw for sample ${sampleId} -- ` +
            `likely an input shape mismatch (check that dependsOn: ${def.dependsOn} ` +
            `actually produces what this stage's processor expects):`,
            err
        );
        return null;
    }

    if (output != null) setCachedStageOutput(journeyName, sampleId, stageIdx, output);
    return output;
}

// The public entry point stage_machine.js calls, now naming WHICH journey
// it's navigating. Everything else about this function is unchanged from
// the single-journey version -- input resolution, caching, the loading
// toggle, and the generic explainer hook all still "just work," now
// correctly scoped per journey.
async function renderStageChart(journeyName, sampleId, stageIdx, container) {
    const journeyStages = STAGE_DEFINITIONS[journeyName];
    const def = journeyStages && journeyStages[stageIdx];
    if (!def) return; // no renderer registered for this journey+stage -- placeholder, nothing to do

    container.classList.add("loading");
    const output = await runStageProcessor(journeyName, stageIdx, sampleId);
    container.classList.remove("loading");

    if (output == null) return;

    def.renderer(container, sampleId, output);

    if (typeof attachAlgorithmExplainer === "function") {
        attachAlgorithmExplainer(container, sampleId, journeyName, stageIdx, output);
    }
}