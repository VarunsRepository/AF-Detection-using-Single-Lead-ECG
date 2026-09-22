/**
 * static/shorts/filters/fft_filter.js
 * Client-Side DSPE for FFT & Spectral Analysis Cards
 */

export class FFTFilterDSPE {
  constructor() {
    this.name = "FFTFilterDSPE";
  }

  /**
   * Helper: Pads or truncates buffer to nearest power of 2 for Radix-2 FFT
   */
  static nextPowerOfTwo(n) {
    return 1 << Math.ceil(Math.log2(n));
  }

  /**
   * DSPE Stage 1: Windowing / Apodization
   * Input: raw_signal (Array<number>), params: { window_type: 'hann'|'hamming'|'rectangular' }
   * Output: { windowed_signal, time_axis }
   */
  applyWindow(signal, fs, params = {}) {
    const windowType = params.window_type || "hann";
    const N = signal.length;
    const windowed = new Float64Array(N);
    const timeAxis = new Float64Array(N);

    for (let n = 0; n < N; n++) {
      timeAxis[n] = n / fs;
      let w = 1.0;
      if (windowType === "hann") {
        w = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * n) / (N - 1)));
      } else if (windowType === "hamming") {
        w = 0.54 - 0.46 * Math.cos((2.0 * Math.PI * n) / (N - 1));
      }
      windowed[n] = signal[n] * w;
    }

    return {
      windowed_signal: Array.from(windowed),
      raw_signal: signal,
      time_axis: Array.from(timeAxis),
      fs: fs
    };
  }

  /**
   * Core Radix-2 In-place Cooley-Tukey FFT
   * Transforms real and imaginary arrays in place.
   */
  static transformRadix2(real, imag) {
    const n = real.length;
    let j = 0;

    // Bit reversal permutation
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        let tempR = real[i]; real[i] = real[j]; real[j] = tempR;
        let tempI = imag[i]; imag[i] = imag[j]; imag[j] = tempI;
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    // Cooley-Tukey Butterfly loops
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const angle = (-2.0 * Math.PI) / len;
      const wStepR = Math.cos(angle);
      const wStepI = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let wR = 1.0;
        let wI = 0.0;
        for (let k = 0; k < halfLen; k++) {
          const uR = real[i + k];
          const uI = imag[i + k];
          const vR = real[i + k + halfLen] * wR - imag[i + k + halfLen] * wI;
          const vI = real[i + k + halfLen] * wI + imag[i + k + halfLen] * wR;

          real[i + k] = uR + vR;
          imag[i + k] = uI + vI;
          real[i + k + halfLen] = uR - vR;
          imag[i + k + halfLen] = uI - vI;

          const nextWR = wR * wStepR - wI * wStepI;
          wI = wR * wStepI + wI * wStepR;
          wR = nextWR;
        }
      }
    }
  }

  /**
   * DSPE Stage 2: Magnitude Spectrum Computation
   * Input: windowed_signal, fs, params: { log_scale: boolean }
   * Output: { freqs, magnitude, fft_output }
   */
  computeSpectrum(windowedSignal, fs, params = {}) {
    const rawLen = windowedSignal.length;
    const N = FFTFilterDSPE.nextPowerOfTwo(rawLen);

    const real = new Float64Array(N);
    const imag = new Float64Array(N);

    for (let i = 0; i < rawLen; i++) {
      real[i] = windowedSignal[i];
    }

    FFTFilterDSPE.transformRadix2(real, imag);

    const halfN = Math.floor(N / 2);
    const freqs = new Float64Array(halfN);
    const magnitude = new Float64Array(halfN);
    const df = fs / N;

    for (let i = 0; i < halfN; i++) {
      freqs[i] = i * df;
      // Single-sided amplitude spectrum normalization
      let mag = (2.0 / N) * Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      if (params.log_scale) {
        mag = 20 * Math.log10(Math.max(mag, 1e-6));
      }
      magnitude[i] = mag;
    }

    return {
      freqs: Array.from(freqs),
      magnitude: Array.from(magnitude),
      fft_output: {
        real: Array.from(real.slice(0, halfN)),
        imag: Array.from(imag.slice(0, halfN)),
        N: N,
        fs: fs
      }
    };
  }

  /**
   * DSPE Stage 3: Power Spectral Density (PSD)
   * Input: fft_output, fs
   * Output: { freqs, psd_curve, total_power, dominant_frequency }
   */
  computePSD(fftOutput, fs) {
    const { real, imag, N } = fftOutput;
    const halfN = real.length;
    const psd = new Float64Array(halfN);
    const freqs = new Float64Array(halfN);
    const df = fs / N;

    let totalPower = 0.0;
    let maxPower = -1.0;
    let dominantFreq = 0.0;

    for (let i = 0; i < halfN; i++) {
      freqs[i] = i * df;
      // Single-sided PSD: |X(k)|^2 / (Fs * N)
      let power = (real[i] * real[i] + imag[i] * imag[i]) / (fs * N);
      if (i > 0 && i < halfN - 1) {
        power *= 2.0; // Energy preservation for single-sided spectrum
      }
      psd[i] = power;
      totalPower += power * df;

      if (power > maxPower) {
        maxPower = power;
        dominantFreq = freqs[i];
      }
    }

    return {
      freqs: Array.from(freqs),
      psd_curve: Array.from(psd),
      total_power: totalPower,
      dominant_frequency: dominantFreq
    };
  }

  /**
   * DSPE Stage 4: Clinical Frequency Band Energy Integrator
   * Input: psd_curve, freqs, params: { bands: { [key]: [low, high] } }
   * Output: { band_powers, band_percentages }
   */
  integrateBands(psdCurve, freqs, params = {}) {
    const defaultBands = {
      baseline: [0.0, 0.5],
      pt_waves: [0.5, 4.0],
      af_f_waves: [4.0, 9.0],
      qrs: [10.0, 25.0],
      mains_noise: [48.0, 52.0]
    };

    const bands = params.bands || defaultBands;
    const bandPowers = {};
    const bandPercentages = {};
    let totalPower = 0.0;

    const df = freqs.length > 1 ? freqs[1] - freqs[0] : 1.0;

    // Numerical integration via trapezoidal approximation
    for (const [key, [fLow, fHigh]] of Object.entries(bands)) {
      let power = 0.0;
      for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] >= fLow && freqs[i] <= fHigh) {
          power += psdCurve[i] * df;
        }
      }
      bandPowers[key] = power;
      totalPower += power;
    }

    for (const key of Object.keys(bandPowers)) {
      bandPercentages[key] = totalPower > 0 ? (bandPowers[key] / totalPower) * 100 : 0;
    }

    return {
      band_powers: bandPowers,
      band_percentages: bandPercentages,
      af_f_waves: {
        f_low: bands.af_f_waves ? bands.af_f_waves[0] : 4.0,
        f_high: bands.af_f_waves ? bands.af_f_waves[1] : 9.0,
        power: bandPowers.af_f_waves || 0.0
      }
    };
  }

  /**
   * DSPE Stage 5: Peak Fibrillatory Frequency Search (AFib Marker)
   * Input: psd_curve, freqs, params: { search_range: [4.0, 9.0] }
   * Output: { peak_f_wave_freq, peak_f_wave_power }
   */
  detectDominantFibrillatoryPeak(psdCurve, freqs, params = {}) {
    const range = params.search_range || [4.0, 9.0];
    let peakPower = -1.0;
    let peakFreq = 0.0;

    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] >= range[0] && freqs[i] <= range[1]) {
        if (psdCurve[i] > peakPower) {
          peakPower = psdCurve[i];
          peakFreq = freqs[i];
        }
      }
    }

    return {
      peak_f_wave_freq: peakFreq,
      peak_f_wave_power: peakPower,
      is_af_candidate: peakFreq >= 4.0 && peakFreq <= 8.5 && peakPower > 0.05
    };
  }
}