// ---------------------------------------------------------------------------
// filters/fft_spectral_filter.js
//
// Power spectrum of an ECG via Welch's method, reported as power in
// clinically meaningful frequency bands.
//
// WHY WELCH RATHER THAN ONE BIG FFT
//   A single FFT over 9,000 samples gives 4,500 bins, each enormously
//   noisy -- the variance of a periodogram does NOT fall as you add
//   samples, it stays roughly equal to the value being estimated. The
//   result is a spectrum so spiky the band structure is invisible.
//
//   Welch splits the signal into overlapping windows, takes the
//   periodogram of each, and averages them. Averaging K windows cuts
//   variance by ~K, at the cost of frequency resolution. For ECG that is
//   the right trade: the bands of interest are tens of Hz wide, so
//   resolution is cheap and stability is not.
//
// WHY A HANN WINDOW
//   An FFT assumes its input repeats forever. A signal cut arbitrarily
//   does not match at the seam, and that discontinuity smears energy
//   across every frequency -- spectral leakage, which would put fake
//   power in every band. Hann tapers each window to zero at both ends so
//   there is no seam.
//
// THE BANDS
//   These are ECG SIGNAL bands, not HRV bands. HRV analysis runs an FFT
//   on the R-R interval series and looks at VLF/LF/HF around 0.04-0.4Hz;
//   that is a different journey. This is the spectrum of the waveform
//   itself, where the bands correspond to physical sources:
//
//     baseline   < 0.5 Hz    respiration, electrode movement, drift
//     P/T waves  0.5-10 Hz   the slow repolarisation deflections
//     QRS        10-40 Hz    the fast depolarisation spike
//     muscle     40-100 Hz   EMG contamination from skeletal muscle
//     mains      49-51 Hz    powerline interference (50Hz regions)
//
//   Mains OVERLAPS the muscle band deliberately -- it is not a partition
//   but a set of questions about the same spectrum. A tall narrow mains
//   spike inside an otherwise ordinary muscle band is a specific,
//   fixable recording fault, and hiding it inside a wider band would
//   lose that.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped: filter files share
// one global scope and an unwrapped helper here would overwrite a
// same-named one elsewhere -- see pan_tompkins_python_port.js.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// In-place radix-2 Cooley-Tukey. Operates on separate real and imaginary
// arrays rather than interleaved complex pairs: the inner loop then reads
// contiguous memory, which matters because this is the hot path.
function fftInPlace(re, im) {
    const n = re.length;
    if (n <= 1) return;

    // Bit-reversal permutation. The recursive form of the FFT splits
    // even/odd indices at every level; doing it iteratively means first
    // reordering the input into the order those splits would produce.
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }

    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len;
        const wRe = Math.cos(ang), wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let curRe = 1, curIm = 0;
            for (let k = 0; k < len / 2; k++) {
                const uRe = re[i + k],         uIm = im[i + k];
                const vRe = re[i + k + len/2] * curRe - im[i + k + len/2] * curIm;
                const vIm = re[i + k + len/2] * curIm + im[i + k + len/2] * curRe;
                re[i + k] = uRe + vRe;  im[i + k] = uIm + vIm;
                re[i + k + len/2] = uRe - vRe;
                im[i + k + len/2] = uIm - vIm;
                const nextRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = nextRe;
            }
        }
    }
}

// Welch: average the periodograms of overlapping Hann-windowed segments.
// 50% overlap is the standard choice -- it recovers most of the data the
// window taper attenuates at segment edges, without the segments being so
// correlated that averaging stops reducing variance.
function welchPSD(signal, fs, segmentLength) {
    const n = signal.length;
    const seg = Math.min(segmentLength, 1 << Math.floor(Math.log2(n)));
    const step = Math.floor(seg / 2);

    // Hann window, plus its power for normalisation. Without dividing by
    // the window power the tapering would make every reported power
    // systematically low.
    const win = new Float64Array(seg);
    let winPower = 0;
    for (let i = 0; i < seg; i++) {
        win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (seg - 1)));
        winPower += win[i] * win[i];
    }

    const bins = seg / 2 + 1;
    const psd = new Float64Array(bins);
    const re  = new Float64Array(seg);
    const im  = new Float64Array(seg);

    let segments = 0;
    for (let start = 0; start + seg <= n; start += step) {
        // Mean-removal per segment. A DC offset puts a huge spike in bin
        // 0 that swamps everything, and ECG recordings routinely carry
        // one from electrode half-cell potential.
        let mean = 0;
        for (let i = 0; i < seg; i++) mean += signal[start + i];
        mean /= seg;

        for (let i = 0; i < seg; i++) {
            re[i] = (signal[start + i] - mean) * win[i];
            im[i] = 0;
        }
        fftInPlace(re, im);

        for (let k = 0; k < bins; k++) {
            // |X(k)|^2, doubled for the one-sided spectrum except at DC
            // and Nyquist, which have no mirror partner to fold in.
            const mag2 = re[k] * re[k] + im[k] * im[k];
            const fold = (k === 0 || k === bins - 1) ? 1 : 2;
            psd[k] += fold * mag2 / (fs * winPower);
        }
        segments++;
    }

    if (segments === 0) return null;
    for (let k = 0; k < bins; k++) psd[k] /= segments;

    const freqs = new Float64Array(bins);
    for (let k = 0; k < bins; k++) freqs[k] = k * fs / seg;

    return { psd, freqs, segments, segmentLength: seg,
             resolutionHz: fs / seg };
}

// Integrate the PSD across a band. Multiplying by bin width converts a
// power DENSITY (per Hz) into absolute power, which is what makes bands
// of different widths comparable.
function bandPower(psd, freqs, lo, hi) {
    const df = freqs[1] - freqs[0];
    let sum = 0;
    for (let k = 0; k < freqs.length; k++) {
        if (freqs[k] >= lo && freqs[k] < hi) sum += psd[k] * df;
    }
    return sum;
}

const DEFAULT_BANDS = [
    { id: "baseline", label: "Baseline",  lo: 0.0,  hi: 0.5,
      color: "#3b82f6", note: "respiration and electrode drift" },
    { id: "pt",       label: "P / T",     lo: 0.5,  hi: 10,
      color: "#1abc9c", note: "slow repolarisation deflections" },
    { id: "qrs",      label: "QRS",       lo: 10,   hi: 40,
      color: "#eb7b2b", note: "the fast depolarisation spike" },
    { id: "muscle",   label: "Muscle",    lo: 40,   hi: 100,
      color: "#9b59b6", note: "EMG contamination" },
    { id: "mains",    label: "Mains",     lo: 49,   hi: 51,
      color: "#e74c3c", note: "50Hz powerline interference" },
];


registerDspAlgorithm("fft_spectral", {
    process(data, parameters) {
        const y  = parameters?.invertSignal ? data.y.map(v => -v) : data.y;
        const fs = data.fs;

        if (!fs) {
            return { error: "fft_spectral needs a sample rate -- this is a "
                          + "time-series algorithm and the source provided fs=null." };
        }
        const segLen = parameters?.segmentLength ?? 1024;
        if (!y || y.length < segLen) {
            return { error: `fft_spectral needs at least ${segLen} samples, got ${y?.length ?? 0}.` };
        }

        const welch = welchPSD(y, fs, segLen);
        if (!welch) return { error: "Not enough signal for a single FFT segment." };

        const { psd, freqs, segments, resolutionHz } = welch;

        // Only report bands the sample rate can actually resolve. Nyquist
        // is fs/2 -- at 300Hz that is 150Hz, so every default band fits,
        // but a 100Hz recording cannot see mains at all and claiming a
        // mains power for it would be fabrication.
        const nyquist = fs / 2;
        const bands = (parameters?.bands ?? DEFAULT_BANDS)
            .filter(b => b.lo < nyquist)
            .map(b => ({ ...b, hi: Math.min(b.hi, nyquist) }));

        const powers = bands.map(b => ({
            ...b,
            power: bandPower(psd, freqs, b.lo, b.hi),
        }));

        // Percentages exclude overlapping bands from the denominator --
        // mains sits inside muscle, so counting both would total over
        // 100% and make every share misleading.
        const exclusive = powers.filter(b => b.id !== "mains");
        const totalPower = exclusive.reduce((s, b) => s + b.power, 0) || 1;
        powers.forEach(b => { b.percent = (b.power / totalPower) * 100; });

        // Dominant frequency: where the most power actually sits. For a
        // clean ECG this lands in the QRS band; a mains-contaminated
        // recording can put it at 50Hz, which is diagnostic in itself.
        let peakIdx = 1;   // skip DC
        for (let k = 2; k < psd.length; k++) if (psd[k] > psd[peakIdx]) peakIdx = k;

        return {
            interimOutputs: [
                { label: "Windowed",  tech: `Hann, ${segments} segments`,
                  data: new Float32Array(y.slice(0, welch.segmentLength)) },
                { label: "Spectrum",  tech: `${resolutionHz.toFixed(2)} Hz resolution`,
                  data: new Float32Array(psd) },
            ],
            finalOutput: {
                psd:          Array.from(psd),
                freqs:        Array.from(freqs),
                bands:        powers,
                totalPower,
                peakFrequency: freqs[peakIdx],
                peakPower:     psd[peakIdx],
                segments,
                resolutionHz,
                nyquist,
                fs,
            },
        };
    },
});

// Exposed for the node-side numerical test.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { fftInPlace, welchPSD, bandPower, DEFAULT_BANDS };
}

})();
