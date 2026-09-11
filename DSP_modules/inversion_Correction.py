import numpy as np
from scipy.signal import butter, lfilter


#  inversion Detection  (Orientation Diagnosis)
def is_device_inverted(signal, sampling_rate=300.0):
    """
    Independent function to check device orientation.
    Returns True if the ECG sample is upside-down, False otherwise.
    """
    # Quick low-pass filter to remove jagged high-frequency noise spikes
    nyq = 0.5 * sampling_rate
    b, a = butter(1, 20.0 / nyq, btype='low')
    smoothed = lfilter(b, a, signal)
    
    # Calculate absolute maximums to find where the QRS spikes live
    abs_signal = np.abs(smoothed)
    percentile_threshold = np.percentile(abs_signal, 98)
    
    # Isolate only the extreme voltage points (the heartbeats)
    qrs_indices = np.where(abs_signal > percentile_threshold)[0]
    
    if len(qrs_indices) == 0:
        return False  # Fallback for flatlines/empty data
        
    # Evaluate the real raw direction of those extreme points
    actual_voltages = smoothed[qrs_indices]
    
    # Check if the dominant extreme points are mostly negative or positive
    return np.abs(np.min(actual_voltages)) > np.max(actual_voltages)


# CORRECTION MATRIX (Flipping Utility)
def flip_ecg_sample(signal):
    """
    Pure utility function to invert an ECG signal vector 
    by multiplying it across the horizontal baseline matrix.
    """
    return signal * -1.0

 
# PAN-TOMPKINS ALGORITHM (Segmentation Core)
def run_pan_tompkins_segmentation(signal, sampling_rate=300.0):
    """
    The core Pan-Tompkins pipeline to extract P-Q-R-S-T windows.
    Expects a standardized, right-side-up signal matrix.
    """
    nyq = 0.5 * sampling_rate           
    low, high = 5.0 / nyq, 15.0 / nyq           
    
    b, a = butter(1, [low, high], btype='band') 
    filtered_signal = lfilter(b, a, signal)     
    
    derivative = np.diff(filtered_signal)       
    squared = derivative ** 2                   
    
    window_width = int(0.15 * sampling_rate)    
    integrated = np.convolve(squared, np.ones(window_width)/window_width, mode='same')  
    
    threshold = np.mean(integrated) * 1.8       
    r_peaks = []
    threshold_breaches = np.where(integrated > threshold)[0]
    
    if len(threshold_breaches) > 0:
        groups = np.split(threshold_breaches, np.where(np.diff(threshold_breaches) > 1)[0] + 1)
        for group in groups:
            if len(group) == 0: continue
            actual_signal_window = signal[group]
            r_peaks.append(int(group[np.argmax(actual_signal_window)]))
            
    r_peaks = [p for i, p in enumerate(r_peaks) if i == 0 or (p - r_peaks[i-1]) > int(sampling_rate * 0.4)]

    p_points, q_points, s_points, t_points = [], [], [], []
    for r in r_peaks:
        if r < 120 or r > len(signal) - 150: continue
        
        q_idx = (r - 12) + np.argmin(signal[r-12:r])
        q_points.append(int(q_idx))
        
        s_idx = r + np.argmin(signal[r:r+12])
        s_points.append(int(s_idx))
        
        p_idx = (r - 60) + np.argmax(signal[r-60:r-15])
        p_points.append(int(p_idx))
        
        t_idx = (r + 30) + np.argmax(signal[r+30:r+120])
        t_points.append(int(t_idx))

    return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}


def run_pan_tompkins_NK2(signal, sampling_rate=300.0):
    """
    The core Pan-Tompkins pipeline to extract P-Q-R-S-T windows.
    Expects a standardized, right-side-up signal matrix.
    """
    nyq = 0.5 * sampling_rate           
    low, high = 5.0 / nyq, 15.0 / nyq           
    
    b, a = butter(1, [low, high], btype='band') 
    filtered_signal = lfilter(b, a, signal)     
    
    derivative = np.diff(filtered_signal)       
    squared = derivative ** 2                   
    
    window_width = int(0.15 * sampling_rate)    
    integrated = np.convolve(squared, np.ones(window_width)/window_width, mode='same')  
    
    threshold = np.mean(integrated) * 1.8       
    r_peaks = []
    threshold_breaches = np.where(integrated > threshold)[0]
    
    if len(threshold_breaches) > 0:
        groups = np.split(threshold_breaches, np.where(np.diff(threshold_breaches) > 1)[0] + 1)
        for group in groups:
            if len(group) == 0: continue
            actual_signal_window = signal[group]
            r_peaks.append(int(group[np.argmax(actual_signal_window)]))
            
    r_peaks = [p for i, p in enumerate(r_peaks) if i == 0 or (p - r_peaks[i-1]) > int(sampling_rate * 0.4)]

    p_points, q_points, s_points, t_points = [], [], [], []
    for r in r_peaks:
        if r < 120 or r > len(signal) - 150: continue
        
        q_idx = (r - 12) + np.argmin(signal[r-12:r])
        q_points.append(int(q_idx))
        
        s_idx = r + np.argmin(signal[r:r+12])
        s_points.append(int(s_idx))
        
        p_idx = (r - 60) + np.argmax(signal[r-60:r-15])
        p_points.append(int(p_idx))
        
        t_idx = (r + 30) + np.argmax(signal[r+30:r+120])
        t_points.append(int(t_idx))

    return {"P": p_points, "Q": q_points, "R": r_peaks, "S": s_points, "T": t_points}
