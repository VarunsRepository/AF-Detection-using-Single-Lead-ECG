// ---------------------------------------------------------------------------
// filters/stacked_beats_filter.js
//
// Slices an ECG into R-centred windows so every beat can be drawn on one
// set of axes. Ported from sliceStackedBeatsFrontend() and
// calculateCardiacAnalytics() in the original ECG analysis page.
//
// WHY R-CENTRING IS THE WHOLE IDEA
//   A normal ECG sweep shows beats one after another in time, so
//   comparing beat 3 with beat 40 means remembering what beat 3 looked
//   like. Re-zeroing the time axis at each R-apex puts every beat on top
//   of every other one: morphology that is consistent shows as a tight
//   bundle, and anything irregular sticks out of it immediately.
//
//   That is a genuinely different question from "what does this signal
//   look like" -- it is "do these beats agree with each other" -- which
//   is why it earns its own stage rather than being a renderer option.
//
// WINDOW
//   0.20s before R and 0.40s after, from the original. Asymmetric
//   because a beat is: P-Q-R takes ~200ms, then S-T trails ~400ms. A
//   symmetric window would clip the T-wave, which is where a lot of the
//   interesting morphology lives.
//
// INPUT
//   Consumes the PREVIOUS stage's Pan-Tompkins output, not raw signal:
//     finalOutput.filteredSignal
//     finalOutput.peakIndices          R peaks
//     finalOutput.wavePoints           optional {P,Q,R,S,T} -- only the
//                                      Python port emits these
//
//   wavePoints is optional on purpose. pan_tompkins emits only R;
//   pan_tompkins_py emits all five. The stage works with either, showing
//   P/Q/S/T markers when they are available and R alone when they are
//   not -- so switching detector mid-stage degrades rather than breaks.
//
// Self-registers into DSP_ALGORITHMS (dsp_registry.js must load first).
// Wrapped in an IIFE: filter files share ONE global scope, and an
// unwrapped helper here would silently overwrite a same-named helper in
// another filter -- see the note in pan_tompkins_python_port.js.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// Ported verbatim in behaviour from sliceStackedBeatsFrontend().
// beatsToStack > 1 extends the window to span that many R-R intervals,
// which is how the original showed consecutive-beat pairs.
function sliceBeatsAroundR(signal, waveIndices, beatsToStack, fs, params = {}) {
    const rPeaks = waveIndices.R || [];
    const out    = [];

    // ── WINDOW ──────────────────────────────────────────────────────────
    // 350ms before R by default, not the original 200ms.
    //
    // WHY THE CHANGE: the P-wave sits roughly 120-200ms before the QRS,
    // so a 200ms window put it right at the edge -- technically visible
    // but with no baseline before it to compare against. And the pre-R
    // segment is exactly where atrial fibrillation shows itself: f-waves
    // REPLACE the P-wave, so "is there a clean P here or a chaotic
    // baseline" is half the diagnosis. Irregular R-R intervals are the
    // other half, and the two together are what distinguishes AFib from
    // other irregular rhythms.
    //
    // 350ms gives ~150ms of baseline before the P-wave would begin, which
    // is enough to see whether that baseline is flat or fibrillating.
    //
    // Cost: a wider window means more beats dropped at the record start,
    // and at very high heart rates (>170bpm, R-R under 350ms) windows
    // begin overlapping the previous beat. Acceptable -- overlap at those
    // rates is informative rather than misleading, since the previous T
    // genuinely does run into the next P.
    const secondsBefore = params.secondsBefore ?? 0.35;
    const secondsAfter  = params.secondsAfter  ?? 0.40;

    const samplesBefore = Math.floor(secondsBefore * fs);
    const samplesAfter  = Math.floor(secondsAfter  * fs);

    for (let idx = 0; idx < rPeaks.length - (beatsToStack - 1); idx++) {
        const rCurrent   = rPeaks[idx];
        const rTargetEnd = rPeaks[idx + (beatsToStack - 1)];

        const startSample = rCurrent   - samplesBefore;
        const endSample   = rTargetEnd + samplesAfter;

        // Beats at the very start or end of the record have no room for a
        // full window. Skipping is right -- a truncated beat drawn over
        // complete ones would read as a morphology anomaly that is really
        // just a boundary artefact.
        if (startSample < 0 || endSample >= signal.length) continue;

        const amplitudes = Array.from(signal.slice(startSample, endSample));

        // Time re-zeroed at THIS beat's R-apex: negative before, positive
        // after. This is the line that does the actual alignment.
        const timesMs = amplitudes.map((_, s) =>
            Number((((startSample + s - rCurrent) / fs) * 1000).toFixed(1)));

        const features = { P: [], Q: [], R: [], S: [], T: [] };
        ["P", "Q", "R", "S", "T"].forEach(wave => {
            (waveIndices[wave] || []).forEach(sampleIdx => {
                if (sampleIdx >= startSample && sampleIdx <= endSample) {
                    features[wave].push({
                        x: Number((((sampleIdx - rCurrent) / fs) * 1000).toFixed(1)),
                        y: signal[sampleIdx],
                    });
                }
            });
        });

        out.push({
            beatNumber:  idx + 1,
            timeMs:      timesMs,
            amplitudeMv: amplitudes,
            features,
        });
    }
    return out;
}

// Ported from calculateCardiacAnalytics(). The 300-2000ms filter drops
// physiologically impossible intervals -- anything outside 30-200bpm is
// a detection artefact, and leaving them in wrecks RMSSD, which squares
// its differences.
function beatAnalytics(rrIntervalsMs) {
    const rr = Array.from(rrIntervalsMs).filter(x => x >= 300 && x <= 2000);
    if (rr.length === 0) return null;

    const mean = rr.reduce((s, v) => s + v, 0) / rr.length;

    // Mode over 10ms bins. Raw RR values are near-unique, so an unbinned
    // mode would be meaningless.
    const bins = {};
    rr.forEach(v => { const b = Math.round(v / 10) * 10; bins[b] = (bins[b] || 0) + 1; });
    const mode = Number(Object.keys(bins).reduce((a, b) => bins[a] > bins[b] ? a : b));

    let sumSq = 0, n = 0, nn50 = 0;
    for (let i = 0; i < rr.length - 1; i++) {
        const d = rr[i + 1] - rr[i];
        if (Math.abs(d) > 50) nn50++;
        sumSq += d * d;
        n++;
    }

    return {
        mean,
        mode,
        rmssd: n > 0 ? Math.sqrt(sumSq / n) : 0,
        pnn50: n > 0 ? (nn50 / n) * 100 : 0,
        total: rr.length,
    };
}


// Ported from calculateVolatilityIndex(). Treats successive R-R
// intervals the way a financial volatility index treats successive
// prices: take the log-return between each pair, then the standard
// deviation of those returns.
//
// WHY LOG-RETURNS RATHER THAN RAW DIFFERENCES: log(next/current) is
// scale-invariant. A 50ms jump matters far more at 400ms than at 1200ms,
// and a raw difference cannot tell those apart. RMSSD, which squares raw
// differences, is dominated by whichever intervals happen to be longest.
//
// The Bollinger bounds are mean * exp(±sigma) -- the band R-R intervals
// should fall inside if the rhythm is stable. Intervals outside it are
// the volatile beats, and in the plot that band becomes a shaded box.
function volatilityIndex(rrIntervalsMs) {
    const rr = Array.from(rrIntervalsMs).filter(v => v > 0);
    if (rr.length <= 1) return null;

    const logReturns = [];
    for (let i = 0; i < rr.length - 1; i++) {
        if (rr[i] > 0 && rr[i + 1] > 0) {
            logReturns.push(Math.log(rr[i + 1] / rr[i]));
        }
    }
    if (logReturns.length === 0) return null;

    const meanLog = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
    const varLog  = logReturns.reduce((s, v) => s + (v - meanLog) ** 2, 0)
                    / logReturns.length;
    const cviRaw  = Math.sqrt(varLog);

    const meanRR = rr.reduce((s, v) => s + v, 0) / rr.length;

    return {
        cviRaw,
        // Scaled to a percentage. The 10% threshold is from the original
        // implementation -- a heuristic, not a clinical cut-off.
        volatilityPercentage: Number((cviRaw * 100).toFixed(2)),
        isVolatile: (cviRaw * 100) > 10.0,
        lowerBound: meanRR * Math.exp(-cviRaw),
        upperBound: meanRR * Math.exp(cviRaw),
        meanRR,
        totalBeats: rr.length,
    };
}


registerDspAlgorithm("stacked_beats", {
    process(data, parameters) {
        // Two input routes. PREVIOUS_STAGE_PIPELINE hands this stage a
        // single exported field, so the peak data may arrive either as a
        // full dspOutput or as the bare arrays.
        const prev     = data.finalOutput ?? data;
        const signal   = prev.filteredSignal ?? data.y;
        const rPeaks   = prev.peakIndices;
        const fs       = data.fs ?? parameters?.fs ?? 300;

        if (!signal || !rPeaks) {
            return { error: "stacked_beats needs filteredSignal and peakIndices "
                          + "from a peak-detection stage." };
        }
        if (rPeaks.length < 2) {
            return { error: `stacked_beats needs at least 2 R-peaks, got ${rPeaks.length}.` };
        }

        // wavePoints only exists if the upstream detector emitted it.
        // Falling back to R-only keeps this working with either detector.
        const waveIndices = prev.wavePoints
            ? { ...prev.wavePoints, R: prev.wavePoints.R ?? Array.from(rPeaks) }
            : { P: [], Q: [], R: Array.from(rPeaks), S: [], T: [] };

        const beatsToStack = parameters?.beatsToStack ?? 1;
        const beats = sliceBeatsAroundR(signal, waveIndices, beatsToStack, fs,
                                        parameters ?? {});

        if (beats.length === 0) {
            return { error: "No complete beats found -- every R-peak was too "
                          + "close to the start or end of the record." };
        }

        // RR intervals recomputed here rather than taken from upstream:
        // this stage may have dropped boundary beats, and the analytics
        // should describe the beats actually being SHOWN.
        const rrIntervalsMs = [];
        for (let i = 1; i < rPeaks.length; i++) {
            rrIntervalsMs.push(((rPeaks[i] - rPeaks[i - 1]) / fs) * 1000);
        }

        const stats = beatAnalytics(rrIntervalsMs);
        const vix   = volatilityIndex(rrIntervalsMs);

        // Mean beat -- the average of every aligned beat, sample by
        // sample. Only meaningful BECAUSE they are R-aligned; averaging
        // unaligned beats would smear everything into a flat line.
        const len = Math.min(...beats.map(b => b.amplitudeMv.length));
        const meanBeat = new Float32Array(len);
        for (let s = 0; s < len; s++) {
            let sum = 0;
            for (const b of beats) sum += b.amplitudeMv[s];
            meanBeat[s] = sum / beats.length;
        }

        return {
            interimOutputs: [
                { label: "Beats found",   tech: `${beats.length} complete windows`,
                  data: new Float32Array(rrIntervalsMs) },
                { label: "Aligned at R",  tech: "time re-zeroed at each R-apex",
                  data: meanBeat },
            ],
            finalOutput: {
                beats,
                meanBeat:      Array.from(meanBeat),
                meanBeatTimeMs: beats[0].timeMs.slice(0, len),
                rrIntervalsMs,
                stats,
                vix,
                beatCount:     beats.length,
                fs,
                // Passed through so a downstream stage can chain from here
                filteredSignal: signal,
                peakIndices:    rPeaks,
            },
        };
    },
});

})();