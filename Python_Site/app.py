import os
import urllib.request # to send web requests to the Physionet site 
import scipy.io       # to use plotly(), which is our star performer 
import numpy as np    # for interim processing for the ECG Signal 
from flask import Flask, jsonify, request, send_from_directory # all the stuff to make a web-site in minutes without needing to learn  
                                                               # the usage of dead-sea scrools of Django 



"Obtaining medical-grade diagnostic data remains a significant challenge, even in an era dominated by high-performance CPUs, expanded RAM,"
" and advanced cloud storage. When capturing human physiological data, a fundamental trade-off exists: clinical precision and diagnostic "
"breadth on one end, versus consumer convenience and ease of use on the other.In a hospital or clinical setting, patients are monitored "
"using top-tier, highly calibrated instrumentation. Systems such as the Philips PageWriter (running the DXL algorithm) can utilize up to "
"12 physical electrodes to derive a 16-lead ECG, providing multi-angle visibility into complex arrhythmias and structural blockages. "
"Similarly, GE HealthCare systems featuring the Marquette 12SL algorithm can analyze raw cardiac signals across all heart rates in "
"real time, deploying advanced digital signal processing to eliminate motion artifacts. While exceptionally accurate, this equipment "
"is expensive, inaccessible to the general public during the critical first moments of symptom onset, and requires extensive clinical "
"training to manually position the electrodes across the chest and limbs.On the opposite end of the spectrum lies day-to-day consumer "
"monitoring. Strapping on a smartwatch or touching a digital crown allows a user to instantly capture an ECG or SpO₂ reading. "
"While these consumer-grade wearables offer unprecedented convenience, they inherently sacrifice diagnostic depth. "
"A standard Apple or Samsung watch, for instance, relies almost entirely on automated algorithms that analyze R-R intervals to identify"
" rhythm irregularities. For complex cardiac monitoring, this single-dimension view is structurally insufficient. "
"Even accessible development hardware, such as the Adafruit AD8232 single-lead sensor, requires three precisely placed electrodes;"
" a slight misalignment by an untrained user can render the resulting data completely unusable.Consequently, "
"a considerable diagnostic gap exists in the market. Consumers need convenient, immediate equipment capable of extracting high-value "
"diagnostic insights the exact moment cardiac symptoms begin. While hybrid devices like AliveCor’s KardiaMobile have started bridging "
"this gap by securing FDA clearances for wider QRS and advanced rhythm determinations, the broader pursuit remains: achieving maximum "
"diagnostic confidence from the simplest possible user interface.As consumer hardware increasingly adopts next-generation digital signal"
" processing (DSP) and machine learning (ML) models, the boundary of what can be extracted from minimal hardware is expanding. "
"This paper addresses this vital frontier by deploying advanced machine learning techniques to achieve highly accurate Atrial Fibrillation"
" (AFib) detection utilizing a single-lead ECG configuration."

from DSP_modules.DSP import apply_noise_filter, \
                            detect_local_max_r_peaks, \
                            run_pan_tompkins_segmentation,\
                            run_pan_tompkins_segmentation_nk2,\
                            calculate_signal_fft, \
                            apply_qrst_cancellation, \
                            compute_wavelet_decomposition

# importing the function to correct(invert) the flipped samples.(samples where the patients held the alliveCor device incorrectly)
from DSP_modules.inversion_Correction import is_device_inverted, \
                                             flip_ecg_sample, \
                                             run_pan_tompkins_segmentation

import neurokit2 as nk  # to leverage the functions of neurokit2 to identify, the different segments of sample 

app = Flask(__name__)                   
CACHE_DIR = "data_cache"                 # interim directory, to download the file before reading it and storing it in memory
os.makedirs(CACHE_DIR, exist_ok=True)
 
# Global memory variable to keep registry mappings fast and active
REGISTRY_CACHE = {}


###################### the code for managing Physionet IO starts here ######################
     
#Connect to and Download the Labels file directly from the PhysioNet training site  
def initialize_physionet_registry():
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

##### Add logging for RCI  : After loading the site, dataset still shows zero samples of each class
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


# Call on first time you visit the site 
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
    use_wavelet = request.args.get('wavelet', 'false').lower() == 'true'
    use_pan_tompkins_with_nk2 = request.args.get('pan_tompkins_with_nk2', 'false').lower() == 'true' # Pan-tompkins but within neurokit 2 package
 
    #  TIMELINE SCALE TOGGLE PARAMETER
    timeline_scale = request.args.get('scale', 'short').lower() # 'short' or 'full'


    txt_filename = os.path.join(CACHE_DIR, f"{record_id}.txt")

    if not os.path.exists(txt_filename):
        print(f"Cache version of the fie :{txt_filename} - NOT FOUND, Downloading from Physionet Now")
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
    
    # Grab the manual override parameter from the incoming HTTP request URL
    force_manual_flip = request.args.get('manual_flip', 'false').lower() == 'true'


    # =========================================================================
    # INJECTED: AUTOMATIC HARDWARE INVERSION DETECTION & RECTIFICATION
    # =========================================================================
    # We pass the full array to evaluate the orientation before slicing or filtering.
    algo_detected_inversion  = is_device_inverted(signal_values, sampling_rate=300.0)
    

    # Core Decision Rule: Flip if algo says so OR if user forces it
    # CRITICAL: If BOTH are true (Algo detected it AND User forces a flip), they cancel out.
    # We use a logical XOR (not equal) so checking the box always acts as a "Reverse Current State" switch.
    should_flip = algo_detected_inversion  != force_manual_flip
 
    if should_flip:
        signal_values = flip_ecg_sample(signal_values)
        
        # the below if-else blocks ae just meant to sent the status to the view
        if force_manual_flip and not algo_detected_inversion:
            inversion_status = "Manual Inversion Applied (User Override)"
            is_inverted_payload = True
        elif force_manual_flip and algo_detected_inversion:
            # The algorithm automatically flipped it, but user wants it back the other way
            inversion_status    = "Original Polarity Restored (User Override)"
            is_inverted_payload = False
        else:
            inversion_status = "Inversion Correction Applied"
            is_inverted_payload = True
    else:
        is_inverted_payload = False
        if force_manual_flip and algo_detected_inversion:
            inversion_status = "Original Polarity Restored (User Override)"
        else:
            inversion_status = "Normal Orientation Verified"
    # =========================================================================
     
     
        
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
    wavelet_data = {}  # simpler design 
    features_Nk2 = {'P_nk2':[],
                    'Q_nk2':[],
                    'R_nk2':[],
                    'S_nk2':[],
                    'T_nk2':[]}


 
    # 3. Apply Noise Filter FIRST if requested
    if enable_filter:
        processed_signal = apply_noise_filter(processed_signal)
        long_signal = apply_noise_filter(long_signal) # Filter long signal to keep math clean

    # 4. Now extract features from the clean, filtered timeline signal
    if enable_local_r:
        # the function developed earlier for detection of R peaks 
        #local_r_indices = detect_local_max_r_peaks(processed_signal)
        
        #trying neurokit's fucntino to see if R detection is any better than our standard algorithm
        signals, info = nk.ecg_process(processed_signal, sampling_rate=300) # ask NK2's ecg_process to pre-process the signal 
        
        raw_peaks = info.get("ECG_R_Peaks")  # get r-peaks but ths time using Nk2's method
        local_r_indices = raw_peaks.tolist() if raw_peaks is not None else [] # convert to a list so that the design is consisent with the remaining puipeline

    if enable_pan:
        features = run_pan_tompkins_segmentation(processed_signal)

    if use_pan_tompkins_with_nk2:
        features_Nk2 = run_pan_tompkins_segmentation_nk2(processed_signal)

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
        print(f"Sample ID: {request.args.get('id')} | Total Beats: {len(poincare_data['x'])} | First 3 RR intervals: {poincare_data['x'][:3]}")


    # 7. Calculate FFT using the long signal for beautiful frequency resolution
    if enable_fft:
        # If cancellation is also active, cancel QRST on the long signal first so the FFT isolates f-waves!
        if enable_cancel:
            long_peaks_for_cancel = run_pan_tompkins_segmentation_nk2(long_signal)["R"]
            fft_target = apply_qrst_cancellation(long_signal, long_peaks_for_cancel)
        else:
            fft_target = long_signal
            
        fft_data = calculate_signal_fft(fft_target)

# 8. Inject the wavelet matrices if requested
    if use_wavelet:
        print(f"\n[DIAGNOSTIC] Wavelet Toggle Triggered! Decomposing signal of length: {len(processed_signal)}")
        
        wavelet_results = compute_wavelet_decomposition(processed_signal)
        
        if wavelet_results["success"]:
            wavelet_data = wavelet_results["bands"]
            
            # --- ADD THIS PRINT BLOCK TO TEST BACKEND DATA ---
            print("[DIAGNOSTIC] DWT Computation Successful!")
            print(f"  - Available keys: {list(wavelet_data.keys())}")
            if "baseline_wander_A5" in wavelet_data:
                sample_slice = wavelet_data["baseline_wander_A5"][:5]
                print(f"  - Baseline Wander A5 Sample Array (First 5 points): {sample_slice}")
                print(f"  - Total array length being sent: {len(wavelet_data['baseline_wander_A5'])}")
            else:
                print("  - WARNING: Expected keys are missing from the bands object!")
            # ------------------------------------------------
            
        else:
            print(f"[DIAGNOSTIC] DWT Computation FAILED! Error: {wavelet_results.get('error')}")

    return jsonify({
        "metric": record_id,
        "orientation_status": inversion_status,     # this simple hold the message of the orientation status
        "is_inverted": is_inverted_payload,         # This is the flag that actually asks the UI to flip the signal
        "data": processed_signal.tolist(),
        "local_r_peaks": local_r_indices,
        "features": features,
        "features_using_nk2":features_Nk2, # pan tompkins but using nk2 instead of our custom function
        "poincare": poincare_data,
        "fft": fft_data,
        "wavelets": wavelet_data
    })

#    # Return payload now contains the inversion tracking state
#    return jsonify({
#        "metric": record_id,
#        "orientation_status": inversion_status,
#        "algo_detected_inversion ": algo_detected_inversion ,
#        "data": processed_signal.tolist(),
#        "local_r_peaks": local_r_indices,
#        "features": features,
#        "poincare": poincare_data,
#        "fft": fft_data,
#        "wavelets": wavelet_data

#        "orientation_status": inversion_status,
#        "is_inverted": is_inverted_payload, #

#    })


# think of it as the main() function of this web-sites programs  
if __name__ == '__main__':
    # run  the app on the entire LAN, site is accessible by Phone/Tablets/etc any device on the same WiFi 
    app.run(host='0.0.0.0', port=8080, debug=True)
    
    # Run the app only on the local machine
    #app.run(port=8080, debug=True)


 
