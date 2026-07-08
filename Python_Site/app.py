import os
import urllib.request # to send web requests to the Physionet site 
import scipy.io       # to use plotly(), which is our star performer 
import numpy as np    # for interim processing for the ECG Signal 

 # all the stuff to make a web-site in minutes without needing to learn  the usage of dead-sea scrools of Django 
from flask import Flask, Blueprint, jsonify, request, send_from_directory, redirect  # blueprint is used to modularise the app, without BP, the app will hold all the functionality, with BP we van modularise the code into several sub-apps 
 



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

#from DSP_modules.DSP import apply_noise_filter, \
#                            detect_local_max_r_peaks, \
#                            run_pan_tompkins_segmentation,\
#                            run_pan_tompkins_segmentation_nk2,\
#                            calculate_signal_fft, \
#                            apply_qrst_cancellation, \
#                            compute_wavelet_decomposition

## importing the function to correct(invert) the flipped samples.(samples where the patients held the alliveCor device incorrectly)
#from DSP_modules.inversion_Correction import is_device_inverted, \
#                                             flip_ecg_sample, \
#                                             run_pan_tompkins_segmentation

# imported for initializing the dataset labels
# physionet has separate files contains the lables of all the 8.5K recordings
# This function just crawls up to the physionetsite and gets those labels
from Services.physionet_Init import PhysioNetRegistryManager


#The main pipeline that's called everyytime the app registers a change accross any of the controls 
from Engine.Engine import run_ecg_pipeline, peak_detection_algorithms, get_dropdown_options


import neurokit2 as nk  # to leverage the functions of neurokit2 to identify, the different segments of sample 


#Now using blueprint
featureEngg_bp = Blueprint('features', __name__)

app = Flask(__name__)         
 
###################### the code for managing Physionet IO starts here ######################
     
 
#  pass the configuration directories directly into the PhysioNetRegistryManager class constructor
# we have created an object for easier state management
physionet_mgr = PhysioNetRegistryManager(cache_dir="data_cache")

physionet_mgr.initialize_registry()


# this route is used to pupulate the dropdown in the view 
@featureEngg_bp.route('/peak_detection_algorithms', methods=['GET'])
def fetch_algorithms():
    # Gets ['Pan Tompkins Native', 'Pan Tompkins nk2', etc ]
    algo_list = get_dropdown_options() 
    return jsonify(algo_list)



@featureEngg_bp.route('/registry', methods=['GET'])
def get_registry_slice():
    """
    Returns lists of matching sample IDs based on a requested target class
    """
    target_class = request.args.get('class', 'N').upper()
    print(f"\n[BACKEND] Frontend requested recordings for class: '{target_class}'")
    
    # Safely query live cache from our global class object instance
    live_cache = physionet_mgr.get_registry()
    print(f"[BACKEND] Current registry keys available: {list(live_cache.keys())}")
    
    if target_class not in live_cache:
        print(f"[BACKEND] ERROR: '{target_class}' not found in registry cache keys.")
        return jsonify({"error": "Invalid class. Choose N, A, O, or ~"}), 400
        
    # Extract the matching samples using the dedicated class accessor method
    samples_list = physionet_mgr.get_records_by_class(target_class)
    
    print(f"[BACKEND] Success! Found {len(samples_list)} records for class '{target_class}'")
    print(f"[BACKEND] First 5 samples being sent: {samples_list[:5]}")
    
    return jsonify({
        "class": target_class,
        "count": len(samples_list),
        "samples": samples_list
    })
###################### the code for managing Physionet IO ends here ######################
 
#deafult app route 
@featureEngg_bp.route('/')
def index():
    return send_from_directory('static', 'index.html')

# app route to redirect the user to the right(complete) route 
@app.route('/')
def index():
    return redirect('/api/v1/splunk/')

#route to goto the physionet web site and fetch the actual recording  
@featureEngg_bp.route('/stream')
def stream_ecg():

    record_id = request.args.get('record', 'A01000')


        # 1. Consolidate Toggle State Parameters
    config = {
        'enable_filter': request.args.get('filter', 'false').lower() == 'true',
        'enable_local_r': request.args.get('local_r', 'false').lower() == 'true',
        'enable_pan': request.args.get('pan_tompkins', 'false').lower() == 'true',
        'enable_poincare': request.args.get('poincare', 'false').lower() == 'true',
        'enable_fft': request.args.get('fft', 'false').lower() == 'true',
        'enable_cancel': request.args.get('cancel', 'false').lower() == 'true',
        'use_wavelet': request.args.get('wavelet', 'false').lower() == 'true',
#        'use_pan_tompkins_with_nk2': request.args.get('pan_tompkins_with_nk2', 'false').lower() == 'true',
        'timeline_scale': request.args.get('scale', 'short').lower(),
        'force_manual_flip': request.args.get('manual_flip', 'false').lower() == 'true',
        'peak_detection_method' : request.args.get('peak_detection_method', 'false').lower(),  
        'stacked_beats': request.args.get('StackedBeats', 'false').lower() == 'true',
        'Stacked_Beats_On_Beats': request.args.get('StackedBeatsOnBeats', 'false').lower() == 'true'
        
    }

    try:
        # 2. Extract clean signal from Manager Cache/Download Engine
        signal_values = physionet_mgr.get_individual_record(record_id)
        
        # 3. Direct downstream vector payload execution to pipeline engine
        result_payload = run_ecg_pipeline(signal_values, config)
        
        # 4. Return serialized dictionary directly to UI graph modules
        return jsonify(result_payload), 200

    except Exception as e:
        print(f"[API ERROR] Pipeline processing crash for record {record_id}: {e}")
        return jsonify({"error": str(e)}), 500
    

"""    
#    # Grab all command toggles out of our HTTP parameters
#    #the control for signal processing are set by selecting the radio buttoms on the top of the code
#    enable_filter = request.args.get('filter', 'false').lower() == 'true'    # simple filter
#    enable_local_r = request.args.get('local_r', 'false').lower() == 'true'  # get peaks from the signal 
#    enable_pan = request.args.get('pan_tompkins', 'false').lower() == 'true' # run pan-tompkins algo to get QRS, P and T points - still a crude code 
#    enable_poincare = request.args.get('poincare', 'false').lower() == 'true' # poincarne plots 
#    enable_fft = request.args.get('fft', 'false').lower() == 'true' # FFT for the sample
#    enable_cancel = request.args.get('cancel', 'false').lower() == 'true' # QRST Cancellation function 
#    use_wavelet = request.args.get('wavelet', 'false').lower() == 'true'
#    use_pan_tompkins_with_nk2 = request.args.get('pan_tompkins_with_nk2', 'false').lower() == 'true' # Pan-tompkins but within neurokit 2 package
# 
#    #  TIMELINE SCALE TOGGLE PARAMETER
#    timeline_scale = request.args.get('scale', 'short').lower() # 'short' or 'full'
#
#
#    #txt_filename = os.path.join(CACHE_DIR, f"{record_id}.txt")# getting a recording 
#    
#    txt_filename = os.path.join(physionet_mgr.cache_dir, f"{record_id}.txt")
#    print(f"Fetched Record path : {txt_filename}")
# 
#
#    signal_values = physionet_mgr.get_individual_record(record_id)
#
#    # Grab the manual override parameter from the incoming HTTP request URL
#    force_manual_flip = request.args.get('manual_flip', 'false').lower() == 'true'
#
#
#    # =========================================================================
#    # INJECTED: AUTOMATIC HARDWARE INVERSION DETECTION & RECTIFICATION
#    # =========================================================================
#    # We pass the full array to evaluate the orientation before slicing or filtering.
#    algo_detected_inversion  = is_device_inverted(signal_values, sampling_rate=300.0)
#    
#
#    # Core Decision Rule: Flip if algo says so OR if user forces it
#    # CRITICAL: If BOTH are true (Algo detected it AND User forces a flip), they cancel out.
#    # We use a logical XOR (not equal) so checking the box always acts as a "Reverse Current State" switch.
#    should_flip = algo_detected_inversion  != force_manual_flip
# 
#    if should_flip:
#        signal_values = flip_ecg_sample(signal_values)
#        
#        # the below if-else blocks ae just meant to sent the status to the view
#        if force_manual_flip and not algo_detected_inversion:
#            inversion_status = "Manual Inversion Applied (User Override)"
#            is_inverted_payload = True
#        elif force_manual_flip and algo_detected_inversion:
#            # The algorithm automatically flipped it, but user wants it back the other way
#            inversion_status    = "Original Polarity Restored (User Override)"
#            is_inverted_payload = False
#        else:
#            inversion_status = "Inversion Correction Applied"
#            is_inverted_payload = True
#    else:
#        is_inverted_payload = False
#        if force_manual_flip and algo_detected_inversion:
#            inversion_status = "Original Polarity Restored (User Override)"
#        else:
#            inversion_status = "Normal Orientation Verified"
#    # =========================================================================
#     
#     
#        
#    # 2. Extract full mathematical background buffer (30 seconds)
#    long_signal = signal_values[:9000]
#    
#    # 3. Dynamically set the visual timeline stream length based on the UI switch
#    if timeline_scale == 'full':
#        timeline_signal = signal_values[:9000] # Show full 30 seconds
#    else:
#        timeline_signal = signal_values[:2500] # Default to clean 8.3-second zoom
#    
#    processed_signal = timeline_signal.copy()
#    
#    local_r_indices = []
#    features = {"P": [], "Q": [], "R": [], "S": [], "T": []}
#    poincare_data = {"x": [], "y": []}
#    fft_data = {"frequencies": [], "magnitudes": []}
#    wavelet_data = {}  # simpler design 
#    features_Nk2 = {'P_nk2':[], 'Q_nk2':[], 'R_nk2':[], 'S_nk2':[], 'T_nk2':[]}
#
#
# 
#    # 3. Apply Noise Filter FIRST if requested
#    if enable_filter:
#        processed_signal = apply_noise_filter(processed_signal)
#        long_signal = apply_noise_filter(long_signal) # Filter long signal to keep math clean
#
#    # 4. Now extract features from the clean, filtered timeline signal
#    if enable_local_r:
#        # the function developed earlier for detection of R peaks 
#        #local_r_indices = detect_local_max_r_peaks(processed_signal)
#        
#        #trying neurokit's fucntino to see if R detection is any better than our standard algorithm
#        signals, info = nk.ecg_process(processed_signal, sampling_rate=300) # ask NK2's ecg_process to pre-process the signal 
#        
#        raw_peaks = info.get("ECG_R_Peaks")  # get r-peaks but ths time using Nk2's method
#        local_r_indices = raw_peaks.tolist() if raw_peaks is not None else [] # convert to a list so that the design is consisent with the remaining puipeline
#
#    if enable_pan:
#        features = run_pan_tompkins_segmentation(processed_signal)
#
#    if use_pan_tompkins_with_nk2:
#        features_Nk2 = run_pan_tompkins_segmentation_nk2(processed_signal)
#
#    # 5. Handle Advanced QRST Cancellation on the timeline signal
#    if enable_cancel:
#        # Run peak detection on the current state of the timeline signal
#        r_peaks_for_cancel = run_pan_tompkins_segmentation(processed_signal)["R"]
#        processed_signal = apply_qrst_cancellation(processed_signal, r_peaks_for_cancel)
#
#    # 6. Calculate Poincaré using the high-density long signal
#    if enable_poincare:
#        long_peaks = detect_local_max_r_peaks(long_signal)
#        if len(long_peaks) > 1:
#            rr_intervals_ms = (np.diff(long_peaks) / 300.0) * 1000.0
#            if len(rr_intervals_ms) > 1:
#                poincare_data["x"] = rr_intervals_ms[:-1].tolist()
#                poincare_data["y"] = rr_intervals_ms[1:].tolist()
#        print(f"Sample ID: {request.args.get('id')} | Total Beats: {len(poincare_data['x'])} | First 3 RR intervals: {poincare_data['x'][:3]}")
#
#
#    # 7. Calculate FFT using the long signal for beautiful frequency resolution
#    if enable_fft:
#        # If cancellation is also active, cancel QRST on the long signal first so the FFT isolates f-waves!
#        if enable_cancel:
#            long_peaks_for_cancel = run_pan_tompkins_segmentation_nk2(long_signal)["R"]
#            fft_target = apply_qrst_cancellation(long_signal, long_peaks_for_cancel)
#        else:
#            fft_target = long_signal
#            
#        fft_data = calculate_signal_fft(fft_target)
#
## 8. Inject the wavelet matrices if requested
#    if use_wavelet:
#        print(f"\n[DIAGNOSTIC] Wavelet Toggle Triggered! Decomposing signal of length: {len(processed_signal)}")
#        
#        wavelet_results = compute_wavelet_decomposition(processed_signal)
#        
#        if wavelet_results["success"]:
#            wavelet_data = wavelet_results["bands"]
#            
#            # --- ADD THIS PRINT BLOCK TO TEST BACKEND DATA ---
#            print("[DIAGNOSTIC] DWT Computation Successful!")
#            print(f"  - Available keys: {list(wavelet_data.keys())}")
#            if "baseline_wander_A5" in wavelet_data:
#                sample_slice = wavelet_data["baseline_wander_A5"][:5]
#                print(f"  - Baseline Wander A5 Sample Array (First 5 points): {sample_slice}")
#                print(f"  - Total array length being sent: {len(wavelet_data['baseline_wander_A5'])}")
#            else:
#                print("  - WARNING: Expected keys are missing from the bands object!")
#            # ------------------------------------------------
#            
#        else:
#            print(f"[DIAGNOSTIC] DWT Computation FAILED! Error: {wavelet_results.get('error')}")
#
#    return jsonify({
#        "metric": record_id,
#        "orientation_status": inversion_status,     # this simple hold the message of the orientation status
#        "is_inverted": is_inverted_payload,         # This is the flag that actually asks the UI to flip the signal
#        "data": processed_signal.tolist(),
#        "local_r_peaks": local_r_indices,
#        "features": features,
#        "features_using_nk2":features_Nk2, # pan tompkins but using nk2 instead of our custom function
#        "poincare": poincare_data,
#        "fft": fft_data,
#        "wavelets": wavelet_data
#    })

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
"""

app.register_blueprint(featureEngg_bp, url_prefix='/api/v1/splunk')

# think of it as the main() function of this web-sites programs  
if __name__ == '__main__':
    # run  the app on the entire LAN, site is accessible by Phone/Tablets/etc any device on the same WiFi 
    app.run(host='0.0.0.0', port=8080, debug=True)
    
    # Run the app only on the local machine
    #app.run(port=8080, debug=True)


 
