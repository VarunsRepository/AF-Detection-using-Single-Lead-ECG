import os
import urllib.request # to send web requests to the Physionet site 
import scipy.io       # to use plotly(), which is our star performer 
import numpy as np    # for interim processing for the ECG Signal 
from flask import Flask, jsonify, request, send_from_directory # all the stuff to make a web-site in minutes without needing to learn  
                                                               # the usage of dead-sea scrools of Django 

# We're getting serious now with the below mentioned - Advanced Signal Processing
from scipy.signal import butter, \
                        lfilter, \
                        savgol_filter       

app = Flask(__name__)                   
CACHE_DIR = "data_cache"                 # interim directory, we won't be using it at all
os.makedirs(CACHE_DIR, exist_ok=True)
 
# Global memory variable to keep registry mappings fast and active
REGISTRY_CACHE = {}


###################### the code for managing Physionet IO starts here ######################



def initialize_physionet_registry():
    """
    Downloads, compiles, and audits the master class label registry file
    directly from the PhysioNet training set matrix using the direct download stream.
    """
    global REGISTRY_CACHE
    if REGISTRY_CACHE:
        return
        
    csv_path = os.path.join(CACHE_DIR, "REFERENCE-v2.csv")
    
    # Force download if the existing file is an HTML placeholder disguised as a CSV
    if os.path.exists(csv_path):
        with open(csv_path, "r", encoding="utf-8", errors="ignore") as test_f:
            first_line = test_f.readline()
            if "<!DOCTYPE" in first_line or "<html" in first_line:
                print("\n[REGISTRY ENGINE] Detected corrupted HTML placeholder file. Purging cache...")
                os.remove(csv_path)

    if not os.path.exists(csv_path):
        print("\n=======================================================")
        print("[REGISTRY ENGINE] Fetching raw file matrix via download stream...")
        print("=======================================================")
        
        # Using the direct download link to completely bypass the HTML landing portal
        url = "https://physionet.org/files/challenge-2017/1.0.0/REFERENCE-v2.csv?download"
        try:
            opener = urllib.request.build_opener()
            opener.addheaders = [
                ('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            ]
            urllib.request.install_opener(opener)
            urllib.request.urlretrieve(url, csv_path)
            print("[REGISTRY ENGINE] Raw download stream pipe closed successfully.")
        except Exception as e:
            print(f"[REGISTRY ENGINE] CRITICAL ERROR: Failed downloading registry: {e}")
            return

    compiled_map = {"N": [], "A": [], "O": [], "~": []}
    
    total_raw_lines_in_file = 0
    successfully_parsed_count = 0
    skipped_or_malformed_count = 0
    raw_sample_preview_lines = []

    with open(csv_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            total_raw_lines_in_file += 1
            
            if len(raw_sample_preview_lines) < 5:
                raw_sample_preview_lines.append(line.replace("\n", "").replace("\r", ""))

            clean_line = line.replace("\r", "").replace("\n", "").strip()
            
            if not clean_line or "," not in clean_line: 
                skipped_or_malformed_count += 1
                continue
                
            parts = clean_line.split(",", maxsplit=1)
            record = parts[0].strip()
            label = parts[1].strip()
            
            if "," in label:
                label = label.split(",")[0].strip()

            if label in compiled_map:
                compiled_map[label].append(record)
                successfully_parsed_count += 1
            else:
                skipped_or_malformed_count += 1

    REGISTRY_CACHE = compiled_map

    # =========================================================================
    # ---                     STARTUP DIAGNOSTIC LOG                        ---
    # =========================================================================
    print("\n" + "="*65)
    print("         PHYSIONET CHALLENGE 2017 REGISTRY DATA LOG         ")
    print("="*65)
    print(f" [FILE METRICS]")
    print(f"   -> Target Source Path:   {csv_path}")
    print(f"   -> Total Lines Found:    {total_raw_lines_in_file} rows")
    print(f"   -> Successfully Parsed:  {successfully_parsed_count} rows")
    print(f"   -> Skipped / Ignored:    {skipped_or_malformed_count} rows")
    print("-"*65)
    
    print(" [RAW FILE SAMPLES PREVIEW]")
    for idx, raw_row in enumerate(raw_sample_preview_lines, 1):
        print(f"   Row {idx} ->  \"{raw_row}\"")
    print("-"*65)
    
    print(" [MEMORY CATEGORY ALLOCATIONS]")
    for key, records in REGISTRY_CACHE.items():
        class_name = {
            "N": "Normal Sinus Rhythm (N)",
            "A": "Atrial Fibrillation (A)",
            "O": "Other Alternative (O)  ",
            "~": "Too Noisy / Corrupt (~) "
        }.get(key, key)
        
        pct = (len(records) / successfully_parsed_count * 100) if successfully_parsed_count > 0 else 0
        preview_samples = records[:4]
        
        print(f"   -> {class_name} : {len(records):>4} items ({pct:>5.1f}%) | Samples: {preview_samples}")
    print("="*65 + "\n")
    

# Call on boot
initialize_physionet_registry()

 
@app.route('/api/v1/splunk/registry')
def get_registry_slice():
    """
    Returns lists of matching sample IDs based on a requested target class
    """
    target_class = request.args.get('class', 'N').upper()
    
    # DEBUG PRINT 1: See if the frontend is actually reaching the backend
    print(f"\n[BACKEND] Frontend requested recordings for class: '{target_class}'")
    
    # DEBUG PRINT 2: Check if your global dictionary is completely empty
    print(f"[BACKEND] Current REGISTRY_CACHE keys available: {list(REGISTRY_CACHE.keys())}")
    
    if target_class not in REGISTRY_CACHE:
        print(f"[BACKEND] ERROR: '{target_class}' not found in cache keys.")
        return jsonify({"error": "Invalid class. Choose N, A, O, or ~"}), 400
        
    samples_list = REGISTRY_CACHE[target_class]
    
    # DEBUG PRINT 3: See how many files Python actually found for that label
    print(f"[BACKEND] Success! Found {len(samples_list)} records for class '{target_class}'")
    print(f"[BACKEND] First 5 samples being sent: {samples_list[:5]}")
    
    return jsonify({
        "class": target_class,
        "count": len(samples_list),
        "samples": samples_list
    })
###################### the code for managing Physionet IO ends here ######################
 
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
    """Finds standard R-peaks locked perfectly to the highest local apex."""
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

# --- NEW ADVANCED QRST CANCELLATION ENGINE ---
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


#  Signal Processing functions end here

#deafult app route 
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

#route to goto the physionet web site and fetch the actual recording  
@app.route('/api/v1/splunk/stream')
def stream_ecg():
    record_id = request.args.get('record', 'A01000')
    
    # Grab all command toggles out of our HTTP parameters

    #the control for signal processing are set by selecting the radio buttoms on the top of the code
    enable_filter = request.args.get('filter', 'false').lower() == 'true'    # simple filter
    enable_local_r = request.args.get('local_r', 'false').lower() == 'true'  # get peaks from the signal 
    enable_pan = request.args.get('pan_tompkins', 'false').lower() == 'true' # run pan-tompkins algo to get QRS, P and T points - still a crude code 
    enable_poincare = request.args.get('poincare', 'false').lower() == 'true' # poincarne plots 
    enable_fft = request.args.get('fft', 'false').lower() == 'true' # FFT for the sample
    enable_cancel = request.args.get('cancel', 'false').lower() == 'true' # QRST Cancellation function 

    #  TIMELINE SCALE TOGGLE PARAMETER
    timeline_scale = request.args.get('scale', 'short').lower() # 'short' or 'full'


    txt_filename = os.path.join(CACHE_DIR, f"{record_id}.txt")
    
    if not os.path.exists(txt_filename):
        folder_prefix = record_id[:3]

        # sending a request to the pjysionet website to get the sample for us
        url = f"https://physionet.org/files/challenge-2017/1.0.0/training/{folder_prefix}/{record_id}.mat?download"
        try:
            opener = urllib.request.build_opener()
            opener.addheaders = [('User-Agent', 'Mozilla/5.0')]
            urllib.request.install_opener(opener)
            temp_mat = f"temp_{record_id}.mat"
            urllib.request.urlretrieve(url, temp_mat)
            mat_data = scipy.io.loadmat(temp_mat)
            with open(txt_filename, "w") as f:
                f.write("\n".join(map(str, mat_data['val'][0])))
            os.remove(temp_mat)
        except Exception as e:
            return jsonify({"error": str(e)})

    # 1. Read base signal matrix
    raw_units = np.loadtxt(txt_filename)
    signal_values = raw_units / 1000.0
    
    # 2. Extract full mathematical background buffer (30 seconds)
    long_signal = signal_values[:9000]
    
    # 3. Dynamically set the visual timeline stream length based on the UI switch
    if timeline_scale == 'full':
        timeline_signal = signal_values[:9000] # Show full 30 seconds
    else:
        timeline_signal = signal_values[:2500] # Default to clean 8.3-second zoom
    
    processed_signal = timeline_signal.copy()
    
    local_r_indices = []
    features = {"P": [], "Q": [], "R": [], "S": [], "T": []}
    poincare_data = {"x": [], "y": []}
    fft_data = {"frequencies": [], "magnitudes": []}

    # 3. Apply Noise Filter FIRST if requested
    if enable_filter:
        processed_signal = apply_noise_filter(processed_signal)
        long_signal = apply_noise_filter(long_signal) # Filter long signal to keep math clean

    # 4. Now extract features from the clean, filtered timeline signal
    if enable_local_r:
        local_r_indices = detect_local_max_r_peaks(processed_signal)
        
    if enable_pan:
        features = run_pan_tompkins_segmentation(processed_signal)

    # 5. Handle Advanced QRST Cancellation on the timeline signal
    if enable_cancel:
        # Run peak detection on the current state of the timeline signal
        r_peaks_for_cancel = run_pan_tompkins_segmentation(processed_signal)["R"]
        processed_signal = apply_qrst_cancellation(processed_signal, r_peaks_for_cancel)

    # 6. Calculate Poincaré using the high-density long signal
    if enable_poincare:
        long_peaks = detect_local_max_r_peaks(long_signal)
        if len(long_peaks) > 1:
            rr_intervals_ms = (np.diff(long_peaks) / 300.0) * 1000.0
            if len(rr_intervals_ms) > 1:
                poincare_data["x"] = rr_intervals_ms[:-1].tolist()
                poincare_data["y"] = rr_intervals_ms[1:].tolist()

    # 7. Calculate FFT using the long signal for beautiful frequency resolution
    if enable_fft:
        # If cancellation is also active, cancel QRST on the long signal first so the FFT isolates f-waves!
        if enable_cancel:
            long_peaks_for_cancel = run_pan_tompkins_segmentation(long_signal)["R"]
            fft_target = apply_qrst_cancellation(long_signal, long_peaks_for_cancel)
        else:
            fft_target = long_signal
            
        fft_data = calculate_signal_fft(fft_target)

    return jsonify({
        "metric": record_id,
        "data": processed_signal.tolist(),
        "local_r_peaks": local_r_indices,
        "features": features,
        "poincare": poincare_data,
        "fft": fft_data
    })

# think of it as the main() function of this web-sites programs  
if __name__ == '__main__':
    app.run(port=8080, debug=True)
