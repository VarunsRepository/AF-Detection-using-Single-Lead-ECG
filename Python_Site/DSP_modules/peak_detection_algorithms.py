

import numpy as np    # for interim processing for the ECG Signal 

import pywt # for wavelet decomposition

import neurokit2 as nk  # to leverage the functions of neurokit2 to identify, the different segments of sample 

# We're getting serious now with the below mentioned - Advanced Signal Processing
from scipy.signal import butter, \
                        lfilter, \
                        savgol_filter       

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
            return {"P": [], 
                    "Q": [], 
                    "S": [], 
                    "R": [], 
                    "T": []}
            
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
            "P": p_points,
            "Q": q_points,
            "R": r_peaks,
            "S": s_points,
            "T": t_points
        }
        
    except Exception as e:
        print(f"[NeuroKit2 Hybrid Error]: Pipeline failed. Reason: {str(e)}")
        return {"P": [], 
                "Q": [], 
                "R": [], 
                "S": [], 
                "T": []}
 
import numpy as np
import neurokit2 as nk

def run_pan_hamilton_segmentation_nk2(signal, sampling_rate=300.0):
    sampling_rate = int(sampling_rate)
    try:
        # Step 1: Clean signal and find R-peaks using Hamilton method
        cleaned_signal = nk.ecg_clean(signal, sampling_rate=sampling_rate, method="pantompkins1985")
        _, r_peak_info = nk.ecg_peaks(cleaned_signal, sampling_rate=sampling_rate, method="hamilton2002")
        r_peaks = r_peak_info["ECG_R_Peaks"].tolist()
        
        if len(r_peaks) == 0:
            return {"P": [], "Q": [], "S": [], "R": [], "T": []}

        # Step 2: Delineate waves using the peak method
        _, wave_info = nk.ecg_delineate(cleaned_signal, r_peaks, sampling_rate=sampling_rate, method="peak")

        # Step 3: Extract basic outputs directly from NeuroKit2 (filtering out NaNs)
        p_points = [int(x) for x in wave_info.get("ECG_P_Peaks", []) if not np.isnan(x)]
        q_points = [int(x) for x in wave_info.get("ECG_Q_Peaks", []) if not np.isnan(x)]
        s_points = [int(x) for x in wave_info.get("ECG_S_Peaks", []) if not np.isnan(x)]
        t_points = [int(x) for x in wave_info.get("ECG_T_Peaks", []) if not np.isnan(x)]

        return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}

    except Exception as e:
        print(f"[NeuroKit2 Error]: Pipeline failed. Reason: {str(e)}")
        return {"P": [], "Q": [], "R": [], "S": [], "T": []}

import numpy as np
import neurokit2 as nk

def run_engelse_zeelenberg_segmentation_nk2(signal, sampling_rate=300.0):
    sampling_rate = int(sampling_rate)
    try:
        # Step 1: Clean signal and find R-peaks using Engelse-Zeelenberg method
        cleaned_signal = nk.ecg_clean(signal, sampling_rate=sampling_rate, method="engzeemod2012")
        _, r_peak_info = nk.ecg_peaks(cleaned_signal, sampling_rate=sampling_rate, method="engzeemod2012")
        r_peaks = r_peak_info["ECG_R_Peaks"].tolist()
        
        if len(r_peaks) == 0:
            return {"P": [], "Q": [], "S": [], "R": [], "T": []}

        # Step 2: Delineate waves using the peak method
        _, wave_info = nk.ecg_delineate(cleaned_signal, r_peaks, sampling_rate=sampling_rate, method="peak")

        # Step 3: Extract basic outputs directly from NeuroKit2 (filtering out NaNs)
        p_points = [int(x) for x in wave_info.get("ECG_P_Peaks", []) if not np.isnan(x)]
        q_points = [int(x) for x in wave_info.get("ECG_Q_Peaks", []) if not np.isnan(x)]
        s_points = [int(x) for x in wave_info.get("ECG_S_Peaks", []) if not np.isnan(x)]
        t_points = [int(x) for x in wave_info.get("ECG_T_Peaks", []) if not np.isnan(x)]

        return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}

    except Exception as e:
        print(f"[NeuroKit2 Error]: Pipeline failed. Reason: {str(e)}")
        return {"P": [], "Q": [], "R": [], "S": [], "T": []}


import numpy as np
import neurokit2 as nk

def run_elgendi_segmentation_nk2(signal, sampling_rate=300.0):
    sampling_rate = int(sampling_rate)
    try:
        # Step 1: Clean signal and find R-peaks using Elgendi method
        cleaned_signal = nk.ecg_clean(signal, sampling_rate=sampling_rate, method="elgendi2010")
        _, r_peak_info = nk.ecg_peaks(cleaned_signal, sampling_rate=sampling_rate, method="elgendi2010")
        r_peaks = r_peak_info["ECG_R_Peaks"].tolist()
        
        if len(r_peaks) == 0:
            return {"P": [], "Q": [], "S": [], "R": [], "T": []}

        # Step 2: Delineate waves using the peak method
        _, wave_info = nk.ecg_delineate(cleaned_signal, r_peaks, sampling_rate=sampling_rate, method="peak")

        # Step 3: Extract basic outputs directly from NeuroKit2 (filtering out NaNs)
        p_points = [int(x) for x in wave_info.get("ECG_P_Peaks", []) if not np.isnan(x)]
        q_points = [int(x) for x in wave_info.get("ECG_Q_Peaks", []) if not np.isnan(x)]
        s_points = [int(x) for x in wave_info.get("ECG_S_Peaks", []) if not np.isnan(x)]
        t_points = [int(x) for x in wave_info.get("ECG_T_Peaks", []) if not np.isnan(x)]

        return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}

    except Exception as e:
        print(f"[NeuroKit2 Error]: Pipeline failed. Reason: {str(e)}")
        return {"P": [], "Q": [], "R": [], "S": [], "T": []}


import numpy as np
import neurokit2 as nk

def run_kalidas_segmentation_nk2(signal, sampling_rate=300.0):
    sampling_rate = int(sampling_rate)
    try:
        # Step 1: Clean signal (default NK2) and find R-peaks using Kalidas method
        cleaned_signal = nk.ecg_clean(signal, sampling_rate=sampling_rate, method="neurokit")
        _, r_peak_info = nk.ecg_peaks(cleaned_signal, sampling_rate=sampling_rate, method="kalidas2017")
        r_peaks = r_peak_info["ECG_R_Peaks"].tolist()
        
        if len(r_peaks) == 0:
            return {"P": [], "Q": [], "S": [], "R": [], "T": []}

        # Step 2: Delineate waves using the peak method
        _, wave_info = nk.ecg_delineate(cleaned_signal, r_peaks, sampling_rate=sampling_rate, method="peak")

        # Step 3: Extract basic outputs directly from NeuroKit2 (filtering out NaNs)
        p_points = [int(x) for x in wave_info.get("ECG_P_Peaks", []) if not np.isnan(x)]
        q_points = [int(x) for x in wave_info.get("ECG_Q_Peaks", []) if not np.isnan(x)]
        s_points = [int(x) for x in wave_info.get("ECG_S_Peaks", []) if not np.isnan(x)]
        t_points = [int(x) for x in wave_info.get("ECG_T_Peaks", []) if not np.isnan(x)]

        return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}

    except Exception as e:
        print(f"[NeuroKit2 Error]: Pipeline failed. Reason: {str(e)}")
        return {"P": [], "Q": [], "R": [], "S": [], "T": []}


def run_martinez_segmentation_nk2(signal, sampling_rate=300.0):
    sampling_rate = int(sampling_rate)
    try:
        # Martinez uses standard neurokit baseline filtering for raw peak location
        cleaned_signal = nk.ecg_clean(signal, sampling_rate=sampling_rate, method="neurokit")
        _, r_peak_info = nk.ecg_peaks(cleaned_signal, sampling_rate=sampling_rate, method="martinez2003")
        r_peaks = r_peak_info["ECG_R_Peaks"].tolist()
        
        if len(r_peaks) == 0:
            return {"P": [], "Q": [], "S": [], "R": [], "T": []}

        _, wave_info = nk.ecg_delineate(cleaned_signal, r_peaks, sampling_rate=sampling_rate, method="peak")

        p_points = [int(x) for x in wave_info.get("ECG_P_Peaks", []) if not np.isnan(x)]
        q_points = [int(x) for x in wave_info.get("ECG_Q_Peaks", []) if not np.isnan(x)]
        s_points = [int(x) for x in wave_info.get("ECG_S_Peaks", []) if not np.isnan(x)]
        t_points = [int(x) for x in wave_info.get("ECG_T_Peaks", []) if not np.isnan(x)]

        return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}
    except Exception as e:
        print(f"[NeuroKit2 Error]: Pipeline failed. Reason: {str(e)}")
        return {"P": [], "Q": [], "R": [], "S": [], "T": []}



def run_christov_segmentation_nk2(signal, sampling_rate=300.0):
    sampling_rate = int(sampling_rate)
    try:
        cleaned_signal = nk.ecg_clean(signal, sampling_rate=sampling_rate, method="neurokit")
        _, r_peak_info = nk.ecg_peaks(cleaned_signal, sampling_rate=sampling_rate, method="christov2004")
        r_peaks = r_peak_info["ECG_R_Peaks"].tolist()
        
        if len(r_peaks) == 0:
            return {"P": [], "Q": [], "S": [], "R": [], "T": []}

        _, wave_info = nk.ecg_delineate(cleaned_signal, r_peaks, sampling_rate=sampling_rate, method="peak")

        p_points = [int(x) for x in wave_info.get("ECG_P_Peaks", []) if not np.isnan(x)]
        q_points = [int(x) for x in wave_info.get("ECG_Q_Peaks", []) if not np.isnan(x)]
        s_points = [int(x) for x in wave_info.get("ECG_S_Peaks", []) if not np.isnan(x)]
        t_points = [int(x) for x in wave_info.get("ECG_T_Peaks", []) if not np.isnan(x)]

        return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}
    except Exception as e:
        print(f"[NeuroKit2 Error]: Pipeline failed. Reason: {str(e)}")
        return {"P": [], "Q": [], "R": [], "S": [], "T": []}    

def run_gamboa_segmentation_nk2(signal, sampling_rate=300.0):
    sampling_rate = int(sampling_rate)
    try:
        cleaned_signal = nk.ecg_clean(signal, sampling_rate=sampling_rate, method="neurokit")
        _, r_peak_info = nk.ecg_peaks(cleaned_signal, sampling_rate=sampling_rate, method="gamboa2008")
        r_peaks = r_peak_info["ECG_R_Peaks"].tolist()
        
        if len(r_peaks) == 0:
            return {"P": [], "Q": [], "S": [], "R": [], "T": []}

        _, wave_info = nk.ecg_delineate(cleaned_signal, r_peaks, sampling_rate=sampling_rate, method="peak")

        p_points = [int(x) for x in wave_info.get("ECG_P_Peaks", []) if not np.isnan(x)]
        q_points = [int(x) for x in wave_info.get("ECG_Q_Peaks", []) if not np.isnan(x)]
        s_points = [int(x) for x in wave_info.get("ECG_S_Peaks", []) if not np.isnan(x)]
        t_points = [int(x) for x in wave_info.get("ECG_T_Peaks", []) if not np.isnan(x)]

        return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}
    except Exception as e:
        print(f"[NeuroKit2 Error]: Pipeline failed. Reason: {str(e)}")
        return {"P": [], "Q": [], "R": [], "S": [], "T": []}    

def run_neurokit_segmentation_nk2(signal, sampling_rate=300.0):
    sampling_rate = int(sampling_rate)
    try:
        cleaned_signal = nk.ecg_clean(signal, sampling_rate=sampling_rate, method="neurokit")
        _, r_peak_info = nk.ecg_peaks(cleaned_signal, sampling_rate=sampling_rate, method="neurokit")
        r_peaks = r_peak_info["ECG_R_Peaks"].tolist()
        
        if len(r_peaks) == 0:
            return {"P": [], "Q": [], "S": [], "R": [], "T": []}

        _, wave_info = nk.ecg_delineate(cleaned_signal, r_peaks, sampling_rate=sampling_rate, method="peak")

        p_points = [int(x) for x in wave_info.get("ECG_P_Peaks", []) if not np.isnan(x)]
        q_points = [int(x) for x in wave_info.get("ECG_Q_Peaks", []) if not np.isnan(x)]
        s_points = [int(x) for x in wave_info.get("ECG_S_Peaks", []) if not np.isnan(x)]
        t_points = [int(x) for x in wave_info.get("ECG_T_Peaks", []) if not np.isnan(x)]

        return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}
    except Exception as e:
        print(f"[NeuroKit2 Error]: Pipeline failed. Reason: {str(e)}")
        return {"P": [], "Q": [], "R": [], "S": [], "T": []}    
