// ---------------------------------------------------------------------------
// static/shorts/filters/drm_filter.js
//
// Walks a frame from the CDN to the panel and asks, at each step: could a
// screenshot have read this?
//
// THERE IS NO DECRYPTION IN HERE, and that is the lesson rather than an
// omission. The source ships ciphertext AND, separately, the frame the
// CDM would have returned. The browser never holds both the key and the
// ciphertext at once -- which is exactly the property the whole DRM
// stack exists to maintain. A JS decrypt would have been a nice trick
// and precisely the wrong thing to teach.
//
// The ciphertext IS real: AES-128-CTR, done in Python at import, with the
// key and counter on the card so anyone can reproduce it. What the page
// cannot do is turn one into the other.
//
// TWO PARAMETERS, both driven by rail buttons:
//   grabAt     which stage the screenshot probe fires at (-1 = none)
//   forcePath  re-run this same row as if it had the other path, so the
//              contrast is visible on one card instead of across two
// ---------------------------------------------------------------------------

(function () {
"use strict";

// What a capture tool gets, given what is in that memory and whether the
// OS can address it. Three outcomes, and only one of them is the famous
// one.
function grabResult(stage) {
    if (!stage.readable) return "blocked";          // nothing to read
    if (stage.holds === "cipher") return "noise";   // readable, useless
    if (stage.holds === "placeholder") return "black";
    return "frame";                                 // readable and plain
}

const GRAB_NOTE = {
    noise:   "The capture succeeded. It is ciphertext, and without the "
           + "key it is 1,296 bytes of noise.",
    blocked: "There is nothing here the OS can address. The capture API "
           + "is not refused -- it has no memory to read.",
    black:   "The capture succeeded and returned exactly what was in the "
           + "framebuffer: an empty surface. Nobody blocked anything.",
    frame:   "The frame is in ordinary memory alongside every other "
           + "window. The capture returns it, because it is there.",
};

// Rebuild the pipeline for the other path. The source already encodes
// what each step holds and whether it is readable, so switching paths is
// not a second table -- it is the same seven steps with three of them
// answering differently.
function repath(pipeline, toHardware) {
    return pipeline.map(s => {
        if (s.id === "decrypt" || s.id === "decode") {
            return { ...s,
                     where: toHardware
                            ? (s.id === "decrypt" ? "TEE" : "protected GPU memory")
                            : "process memory",
                     readable: !toHardware };
        }
        if (s.id === "compose") {
            return { ...s,
                     holds: toHardware ? "placeholder" : "frame" };
        }
        if (s.id === "scanout") {
            return { ...s, readable: false };
        }
        return { ...s };
    });
}

registerDspAlgorithm("drm_path", {
    process(envelope, parameters) {
        const meta = envelope.meta || {};
        const pipeline0 = meta.pipeline;

        // Defensive, and loud. A card that renders an empty pipeline
        // looks like a styling bug and is a data bug.
        if (!Array.isArray(pipeline0) || pipeline0.length === 0) {
            return { error: "drm_path: the sample carries no pipeline" };
        }

        const forcePath = parameters?.forcePath ?? null;   // null|"hardware"|"software"
        const shown     = forcePath || meta.path;
        const isForced  = Boolean(forcePath) && forcePath !== meta.path;

        const pipeline = isForced
            ? repath(pipeline0, shown === "hardware")
            : pipeline0.map(s => ({ ...s }));

        // -1 means the probe has not been fired yet. Clamped rather than
        // wrapped: walking off the end should stop at the panel, not
        // silently reappear at the CDN.
        let grabAt = parameters?.grabAt;
        if (typeof grabAt !== "number") grabAt = -1;
        grabAt = Math.max(-1, Math.min(pipeline.length - 1, grabAt));

        const interim = [];
        pipeline.forEach((s, i) => {
            s.index  = i;
            s.result = grabResult(s);
            s.probed = i === grabAt;
            interim.push({
                name: s.label,
                description: s.note,
                depth: 1,
                parent: "pipeline",
                meta: { where: s.where, readable: s.readable,
                        result: s.result },
            });
        });

        const probe = grabAt >= 0 ? pipeline[grabAt] : null;
        const grab  = probe ? {
            index:   grabAt,
            stageId: probe.id,
            label:   probe.label,
            result:  probe.result,
            note:    GRAB_NOTE[probe.result],
        } : null;

        // The row this sample IS, and the table it sits in. The renderer
        // highlights one row of the other -- same object, so they cannot
        // disagree about what this combination's cap is.
        const row = {
            browser: meta.browser, os: meta.os, maxRes: meta.maxRes,
            system: meta.system, level: meta.level, path: meta.path,
            minVersion: meta.minVersion, note: meta.note,
        };

        return {
            interimOutputs: interim,
            finalOutput: {
                row,
                pipeline,
                grab,
                pathShown: shown,
                isForced,
                table:    meta.table || [],
                frameW:   meta.frameW || 48,
                frameH:   meta.frameH || 27,
                frame:    envelope.arrays?.frame  || null,
                cipher:   envelope.arrays?.cipher || null,
                keyHex:   meta.keyHex   || "",
                nonceHex: meta.nonceHex || "",
                source:   meta.source   || "",
                // Stated for the card, not computed: the journey's claim,
                // in the form that would falsify it.
                claim: "2160p appears only where a hardware path exists",
            },
        };
    },

    // Rail controls the engine builds from the DSPE's own declaration --
    // same mechanism the protocols journey uses, so a card only ever
    // shows the buttons its stage can actually act on.
    choices() {
        return [
            { key: "grabAt", label: "Grab",
              display: { "-1": "Grab", "0": "Grab @CDN", "1": "Grab @buffer",
                         "2": "Grab @CDM", "3": "Grab @decrypt",
                         "4": "Grab @decode", "5": "Grab @compositor",
                         "6": "Grab @panel" },
              options: [-1, 0, 1, 2, 3, 4, 5, 6] },
            { key: "forcePath", label: "Path",
              display: { "null": "As shipped", "hardware": "Force hardware",
                         "software": "Force software" },
              options: [null, "hardware", "software"] },
        ];
    },
});

})();
