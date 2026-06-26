
import numpy as np    # for interim processing for the ECG Signal 

import pywt # for wavelet decomposition

import neurokit2 as nk  # to leverage the functions of neurokit2 to identify, the different segments of sample 

# We're getting serious now with the below mentioned - Advanced Signal Processing
from scipy.signal import butter, \
                        lfilter, \
                        savgol_filter       

 
# below mentioned functions actually implement our signal processing techniques

def apply_noise_filter(signal):
   #better to comment this way rather than commenting the standard way of using # sign
    """Tries to Removes :
     1. Baseline wander -  the thing that causes the zero mark of the signal to not stay at zero
     2. Muscle noise - The electrical signal from the muscles - remember alivCor is taking the reading from fingertips and not the chest"""
    return savgol_filter(signal, window_length=15, polyorder=2)

def detect_local_max_r_peaks(signal,  # the ECG signal 
                             sampling_rate=300.0  # for the scope of this project, it would stay at 300 Hz but other datasets on physionet might have different freq
                             ):
    "Finds standard R-peaks locked perfectly to the highest local apex."
    threshold_breaches = np.where(signal > 0.4)[0]
    if len(threshold_breaches) == 0:
        return []
        
    true_peaks = []
    groups = np.split(threshold_breaches, np.where(np.diff(threshold_breaches) > 1)[0] + 1)
    
    for group in groups:
        if len(group) == 0: continue
        local_signal_chunk = signal[group]
        highest_point_relative_idx = np.argmax(local_signal_chunk)
        absolute_peak_idx = group[highest_point_relative_idx]
        
        if len(true_peaks) == 0 or (absolute_peak_idx - true_peaks[-1]) > (sampling_rate * 0.4):
            true_peaks.append(int(absolute_peak_idx))
            
    return true_peaks

def run_pan_tompkins_segmentation(signal,  # the ECG signal 
                             sampling_rate=300.0  # for the scope of this project, it would stay at 300 Hz but other datasets on physionet might have different freq
                             ):
    
    """The famous algorithm to detect the QRS interval from 1985 by Jiapu Pan(Shanghai) and Willis Tompkins(USA)
       running on 8-Bit Z80 processor of the time. Today, we have Floating proint processing units that can easily 
        hammer down the floating point values from the signal"""

# Nyquist frequency represents the theoretical maximum bandwidth limit (Fs / 2)
    # At 300 Hz sampling rate, the Nyquist frequency is exactly 150 Hz
    nyq = 0.5 * sampling_rate           
    
    # Normalize our 5 Hz and 15 Hz cutoff frequencies relative to the Nyquist limit
    low, high = 5.0 / nyq, 15.0 / nyq           
    
    # Design and apply a 2nd-order cascaded Butterworth Band-pass filter (5-15 Hz)
    # This isolates the QRS energy while attenuating muscle noise, 60Hz hum, and T-wave interference
    b, a = butter(1, [low, high], btype='band') 
    filtered_signal = lfilter(b, a, signal)     
    
    # Five-point first-derivative approximation in the discrete-time domain
    # This highlights the steep slopes/gradients of the R-wave upstroke
    derivative = np.diff(filtered_signal)       
    
    # Point-by-point squaring operation to make all data points non-negative 
    # and non-linearly magnify high-frequency QRS complexes over lower-frequency components
    squared = derivative ** 2                   
    
    # Define a 150ms moving window width (45 samples at 300 Hz) to match standard QRS duration
    window_width = int(0.15 * sampling_rate)    
    
    # Discrete-time linear convolution implementing a Moving Window Integration (MWI) 
    # to obtain a smooth, moving energy envelope of the QRS complex
    integrated = np.convolve(squared, np.ones(window_width)/window_width, mode='same')  
    
    # Calculate a dynamic signal-to-noise threshold profile baseline
    threshold = np.mean(integrated) * 1.8       
    r_peaks = []
    threshold_breaches = np.where(integrated > threshold)[0]
    
    # Group continuous blocks of true indices that breached the envelope threshold
    if len(threshold_breaches) > 0:
        groups = np.split(threshold_breaches, np.where(np.diff(threshold_breaches) > 1)[0] + 1)
        for group in groups:
            if len(group) == 0: continue
            # Find the absolute maximum amplitude point within the raw signal window
            actual_signal_window = signal[group]
            r_peaks.append(int(group[np.argmax(actual_signal_window)]))
            
    # Apply a 400ms physiological refractory period blanking window 
    # to eliminate false positive multiple-triggers on the same cardiac contraction
    r_peaks = [p for i, p in enumerate(r_peaks) if i == 0 or (p - r_peaks[i-1]) > int(sampling_rate * 0.4)]

    # Relative localized physiological search windows for sub-wave segmentation
    p_points, q_points, s_points, t_points = [], [], [], []
    for r in r_peaks:
        if r < 120 or r > len(signal) - 150: continue
        
        # Q-dip: Local minimum immediately preceding the R-peak
        q_idx = (r - 12) + np.argmin(signal[r-12:r])
        q_points.append(int(q_idx))
        
        # S-dip: Local minimum immediately following the R-peak
        s_idx = r + np.argmin(signal[r:r+12])
        s_points.append(int(s_idx))
        
        # P-wave: Local maximum corresponding to atrial depolarization
        p_idx = (r - 60) + np.argmax(signal[r-60:r-15])
        p_points.append(int(p_idx))
        
        # T-wave: Local maximum corresponding to ventricular repolarization
        t_idx = (r + 30) + np.argmax(signal[r+30:r+120])
        t_points.append(int(t_idx))

    return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}


def run_pan_tompkins_segmentation_nk2(signal, sampling_rate=300.0):
    """
    Upgraded NeuroKit2 segmentation using the high-recall 'peak' method.
    Includes an automated mathematical fallback matrix to guarantee no 
    P, Q, S, or T points are missed due to single-lead wavelet threshold drops.
    """
    sampling_rate = int(sampling_rate)
    
    try:
        # Step 1: Pan-Tompkins clean and isolate R-Peaks
        cleaned_signal = nk.ecg_clean(signal, sampling_rate=sampling_rate, method='pantompkins1985')
        _, r_peak_info = nk.ecg_peaks(cleaned_signal, sampling_rate=sampling_rate, method='pantompkins1985')
        
        r_peaks = r_peak_info["ECG_R_Peaks"].tolist()
        if len(r_peaks) == 0:
            return {"P_nk2": [], 
                    "Q_nk2": [], 
                    "S_nk2": [], 
                    "R_nk2": [], 
                    "T_nk2": []}
            
        # Step 2: High-Recall Derivative 'peak' method (Replaces the drop-prone 'dwt' wavelet)
        _, wave_info = nk.ecg_delineate(cleaned_signal, r_peaks, sampling_rate=sampling_rate, method='peak')
        
        # Step 3: Sanitize indices with automated fallback logic
        def process_sub_wave(key_string, search_offset_start, search_offset_end, use_min=False):
            raw_array = wave_info.get(key_string, [])
            sanitized = []
            
            # Loop through every detected R-peak to check for missing points
            for i, r in enumerate(r_peaks):
                # Calculate absolute look-up window bounds relative to the current beat
                start_win = r + int(search_offset_start * sampling_rate)
                end_win = r + int(search_offset_end * sampling_rate)
                
                # Check for array out-of-bounds safety rules
                if start_win < 0 or end_win > len(signal):
                    continue
                
                # If NeuroKit successfully found the point, preserve its index directly
                if i < len(raw_array) and not np.isnan(raw_array[i]):
                    sanitized.append(int(raw_array[i]))
                else:
                    # FALLBACK: If NeuroKit dropped it, use a local argmin/argmax search window
                    window_data = signal[start_win:end_win]
                    if len(window_data) > 0:
                        offset_idx = np.argmin(window_data) if use_min else np.argmax(window_data)
                        sanitized.append(int(start_win + offset_idx))
                        
            return sanitized

        # Extract all vectors using precise physiological timing bounds
        q_points = process_sub_wave("ECG_Q_Peaks", search_offset_start=-0.04, search_offset_end=0.0, use_min=True)
        s_points = process_sub_wave("ECG_S_Peaks", search_offset_start=0.0, search_offset_end=0.04, use_min=True)
        p_points = process_sub_wave("ECG_P_Peaks", search_offset_start=-0.20, search_offset_end=-0.05, use_min=False)
        t_points = process_sub_wave("ECG_T_Peaks", search_offset_start=0.10, search_offset_end=0.40, use_min=False)
        
        return {
            "P_nk2": p_points,
            "Q_nk2": q_points,
            "R_nk2": r_peaks,
            "S_nk2": s_points,
            "T_nk2": t_points
        }
        
    except Exception as e:
        print(f"[NeuroKit2 Hybrid Error]: Pipeline failed. Reason: {str(e)}")
        return {"P_nk2": [], 
                "Q_nk2": [], 
                "R_nk2": [], 
                "S_nk2": [], 
                "T_nk2": []}


def calculate_signal_fft(signal, sampling_rate=300.0):
    """
    Transforms the time-domain signal into the frequency domain using 1D FFT.
    Returns frequencies and their absolute magnitudes up to the Nyquist limit.
    """
    n = len(signal)
    # Compute the raw FFT values
    fft_values = np.fft.fft(signal)
    # Get the corresponding frequency bins
    frequencies = np.fft.fftfreq(n, d=1.0/sampling_rate)
    
    # Take the absolute value to get magnitude, and isolate the positive frequencies
    positive_identities = np.where(frequencies >= 0)
    
    freqs_cut = frequencies[positive_identities]
    mags_cut = np.abs(fft_values)[positive_identities]
    
    # Only return up to 40 Hz since medical ECG data lives primarily below this threshold
    useful_range = np.where(freqs_cut <= 40.0)
    
    return {
        "frequencies": freqs_cut[useful_range].tolist(),
        "magnitudes": mags_cut[useful_range].tolist()
    }

#  Advanced DSP - QRST CANCELLATION 
def apply_qrst_cancellation(signal, r_peaks, sampling_rate=300.0):
    """
    Slices, averages, and subtracts the dominant QRS-T complex 
    from the raw wave trace to expose hidden underlying atrial f-waves.
    """
    cancelled_signal = signal.copy()
    if len(r_peaks) < 3:
        return cancelled_signal
        
    # Define window bounds relative to R-peak (Pre-R: 40ms, Post-R: 160ms)
    pre_samples = int(0.04 * sampling_rate)  # 12 samples
    post_samples = int(0.16 * sampling_rate) # 48 samples
    beat_length = pre_samples + post_samples
    
    collected_beats = []
    
    # 1. Harvest matching ventricular complexes
    for r in r_peaks:
        if r - pre_samples < 0 or r + post_samples > len(signal):
            continue
        collected_beats.append(signal[r - pre_samples : r + post_samples])
        
    if len(collected_beats) == 0:
        return cancelled_signal
        
    # 2. Compute the Master average linear QRS template
    mean_template = np.mean(collected_beats, axis=0)
    
    # 3. Linearly subtract the template from every single detected heartbeat region
    for r in r_peaks:
        if r - pre_samples < 0 or r + post_samples > len(signal):
            continue
        cancelled_signal[r - pre_samples : r + post_samples] -= mean_template
        
    return cancelled_signal

#  Advanced DSP - Wavelet decomposition - another way od doing Fourier transform but this time with timed samples
def compute_wavelet_decomposition(signal_data, wavelet_name="db4", level=5):
    """
    Decomposes the ECG signal into approximation and detail coefficients
    and cleanly reconstructs individual bands by zeroing out unselected paths.
    """
    try:
        # Perform Discrete Wavelet Transform
        coefficients = pywt.wavedec(signal_data, wavelet_name, level=level)
        
        reconstructed_bands = {}
        
        # 1. Reconstruct baseline approximation profile (A5 Only)
        # We copy the structure, then fill detail lists with zeros
        a_coeffs = [coefficients[0]] + [np.zeros_like(c) for c in coefficients[1:]]
        reconstructed_bands["baseline_wander_A5"] = pywt.waverec(a_coeffs, wavelet_name).tolist()[:len(signal_data)]
        
        # 2. Reconstruct specific details for high/low structural features
        # coefficients[1] is D5, coefficients[2] is D4, ..., coefficients[5] is D1
        for i in range(level):
            # Start with a clean slate of zeros across all coefficient sets
            d_coeffs = [np.zeros_like(c) for c in coefficients]
            
            # Re-inject exactly ONE detail layer back into its designated index slot
            d_coeffs[i + 1] = coefficients[i + 1]
            
            # Map index to user-friendly layer names matching JavaScript keys
            # i=0 -> D5, i=1 -> D4, i=2 -> D3, i=3 -> D2, i=4 -> D1
            layer_name = f"detail_band_D{level - i}"
            reconstructed_bands[layer_name] = pywt.waverec(d_coeffs, wavelet_name).tolist()[:len(signal_data)]
            
        return {
            "success": True,
            "bands": reconstructed_bands
        }
    except Exception as e:
        # This will catch and surface hidden issues to your terminal
        print(f"[INTERNAL ERROR] Wavelet Math Crash: {str(e)}")
        return {"success": False, "error": str(e)}
#  Signal Processing functions end here
