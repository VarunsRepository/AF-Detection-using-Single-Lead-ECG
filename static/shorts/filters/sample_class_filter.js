// ---------------------------------------------------------------------------
// filters/sample_class_filter.js
//
// Reports the record's REFERENCE CLASS -- the label a cardiologist
// assigned in the PhysioNet 2017 dataset -- next to the measurements the
// earlier stages produced.
//
// WHAT THIS IS AND IS NOT
//   This is NOT a classifier. It computes nothing about which class the
//   record belongs to; it looks up the answer key. The measurements
//   beside it (heart rate, RMSSD, irregularity) come from the peak
//   detection stage, and putting the two together lets a viewer check
//   their own reading against the reference.
//
//   That distinction matters enough to be visible in the UI, not just
//   in a comment -- a card that showed "AFib" without saying where that
//   came from would look like a diagnosis the app had made.
//
// WHY A FINAL STAGE
//   The earlier stages ask "what is in this signal". This one closes the
//   loop: you watched the beats, saw the spread of the R-R intervals,
//   and now find out what the record is actually called. Answer last is
//   the whole reason it works -- shown first, it would tell you what to
//   see before you looked.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped -- filter files share
// one global scope.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// PhysioNet/CinC Challenge 2017 reference classes.
const CLASSES = {
    N: { name: "Normal sinus rhythm",
         blurb: "Regular rhythm from the sinus node -- even R-R intervals and a clean P-wave before each beat.",
         colour: "#5cc24a" },
    A: { name: "Atrial fibrillation",
         blurb: "Irregularly irregular R-R intervals, and f-waves replacing the P-wave as the atria fibrillate instead of contracting.",
         colour: "#e74c3c" },
    O: { name: "Other rhythm",
         blurb: "Not sinus and not AF -- this class collects everything else, so its records vary enormously.",
         colour: "#eb7b2b" },
    "~": { name: "Too noisy to classify",
         blurb: "The recording quality is too poor to call. Worth seeing: not every trace yields an answer.",
         colour: "#78828e" },
};

registerDspAlgorithm("sample_class", {
    process(data, parameters) {
        // Label rides in meta, not in the signal. Pipeline stages inherit
        // it from the last HTTP fetch (see journey_interpreter).
        const meta  = data.meta ?? {};
        const raw   = meta.label;
        const known = Object.prototype.hasOwnProperty.call(CLASSES, raw);

        const prev = data.finalOutput ?? {};
        const rr   = Array.from(prev.rrIntervalsMs ?? [])
                          .filter(v => v >= 300 && v <= 2000);

        let meanRr = null, bpm = null, rmssd = null, irregular = null;
        if (rr.length > 1) {
            meanRr = rr.reduce((s, v) => s + v, 0) / rr.length;
            bpm    = 60000 / meanRr;

            let sumSq = 0;
            for (let i = 0; i < rr.length - 1; i++) {
                sumSq += (rr[i + 1] - rr[i]) ** 2;
            }
            rmssd = Math.sqrt(sumSq / (rr.length - 1));

            // RMSSD as a share of mean R-R. Scale-free, so a 50ms
            // variation reads differently at 400ms than at 1200ms --
            // which is the point. Descriptive only; the CLASS comes from
            // the reference label, never from this number.
            irregular = (rmssd / meanRr) * 100;
        }

        return {
            interimOutputs: [
                { label: "Reference class",
                  tech: known ? CLASSES[raw].name : "not in the answer key",
                  data: new Float32Array(rr) },
            ],
            finalOutput: {
                classId:    known ? raw : null,
                className:  known ? CLASSES[raw].name  : "Unclassified",
                classBlurb: known ? CLASSES[raw].blurb
                                  : "No reference label is available for this record.",
                classColour: known ? CLASSES[raw].colour : "#78828e",
                recordId:   meta.record_id ?? null,
                beats:      rr.length + 1,
                bpm, meanRr, rmssd, irregular,
                // Stated so the renderer can say so on screen. The app
                // must never look like it diagnosed anything.
                source: "PhysioNet/CinC 2017 reference annotation",
            },
        };
    },
});

})();
