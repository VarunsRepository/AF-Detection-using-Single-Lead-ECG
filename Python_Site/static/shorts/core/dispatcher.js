// ---------------------------------------------------------------------------
// dispatcher.js
// Given a rail button's {target, method, payload} and the live engines for
// THIS stage, calls the right method on the right target. Six known verbs,
// three known targets (dspEngine, renderingEngine, journey) -- nothing else.
// Adding a new button never needs new JS, as long as it uses one of these
// six verbs against one of these three targets.
// ---------------------------------------------------------------------------

function dispatch(action, context) {
    // context = { dspEngine, renderingEngine, journey } -- the live objects for this stage
    const targetObj = context[action.target];
    if (!targetObj) {
        console.error(`Dispatcher: unknown target "${action.target}"`);
        return;
    }
    if (typeof targetObj[action.method] !== "function") {
        console.error(`Dispatcher: "${action.target}" has no method "${action.method}"`);
        return;
    }
    return targetObj[action.method](action.payload);
}
