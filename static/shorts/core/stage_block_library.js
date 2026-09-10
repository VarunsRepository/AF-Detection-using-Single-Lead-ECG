// ---------------------------------------------------------------------------
// stage_block_library.js
// A library of NAMED, reusable stage blocks -- each one bundles a
// processor + renderer + label (+ optional railControls), completely
// independent of which journey ends up using it, or in what position.
//
// This is what makes rapidly comparing many candidate journey STRUCTURES
// possible: a new candidate journey that reuses "baseline_correction" and
// "peak_detection" but tries a genuinely different final stage needs
// ZERO new processor/renderer code for the two it's reusing -- just a
// server-side recipe (see journeys_catalog.py) naming which blocks to use
// and in what order. The actual DSP/rendering logic here never becomes
// data -- only the COMPOSITION does. Same "store the recipe, not the
// code" principle already used for cascading DSP filters, applied one
// level up, for the same reason: executing arbitrary server-sent code
// would be a real security risk; referencing pre-reviewed, trusted named
// blocks by string ID is not.
// ---------------------------------------------------------------------------

const STAGE_BLOCKS = {}; // blockName -> { processor, renderer, label, railControls }

function registerStageBlock(blockName, definition) {
    STAGE_BLOCKS[blockName] = definition;
}

function getStageBlock(blockName) {
    return STAGE_BLOCKS[blockName];
}
