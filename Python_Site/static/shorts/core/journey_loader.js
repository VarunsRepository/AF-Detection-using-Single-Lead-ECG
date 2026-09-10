// ---------------------------------------------------------------------------
// journey_loader.js
// Interprets a server-sent RECIPE -- a plain list of {block, dependsOn}
// entries naming which pre-built stage blocks to use, and in what order --
// and turns it into real registerStage() calls. This is the actual PowerShell-
// pipe-style composition mechanism: the recipe is DATA (just strings and
// numbers, safe to generate/store/compare many variants of), the blocks it
// references are CODE (real, reviewed, trusted JS, never executed from a
// string). Comparing a new candidate journey structure means writing a new
// recipe, not a new JS file, as long as it only recombines EXISTING blocks.
//
// A candidate journey that needs a genuinely NEW kind of stage (e.g. an
// ST-elevation detector nothing else has) still needs that block's real
// processor/renderer written once, via registerStageBlock() -- this
// doesn't eliminate writing DSP code, it eliminates re-writing the
// WIRING every time an existing block gets reused in a new combination.
//
// Depends on stage_engine.js (registerStage) and stage_block_library.js
// (getStageBlock) -- both must be loaded before this file.
// ---------------------------------------------------------------------------

function loadJourneyFromRecipe(journeyName, recipe) {
    if (!recipe || !Array.isArray(recipe.stages)) {
        console.error(`Journey "${journeyName}" has no valid recipe to load.`);
        return;
    }

    recipe.stages.forEach((stageSpec, stageIdx) => {
        const block = getStageBlock(stageSpec.block);
        if (!block) {
            // Loud, specific, and named -- exactly the same "fail clearly,
            // not silently" principle used elsewhere (e.g. the engine's
            // processor error handling). A recipe referencing a block that
            // was never registered is a real configuration mistake worth
            // surfacing immediately, not discovering later as a blank stage.
            console.error(
                `Journey "${journeyName}"'s recipe references unknown stage block ` +
                `"${stageSpec.block}" at stage ${stageIdx} -- check that this block ` +
                `was registered via registerStageBlock() before this recipe was loaded.`
            );
            return;
        }

        registerStage(journeyName, stageIdx, {
            processor: block.processor,
            renderer: block.renderer,
            label: block.label,
            railControls: block.railControls,
            dependsOn: stageSpec.dependsOn,
        });
    });
}
