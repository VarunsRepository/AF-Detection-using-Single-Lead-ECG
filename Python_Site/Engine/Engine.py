# dsp_pipeline/engine.py
import numpy as np
import neurokit2 as nk


from DSP_modules.DSP import apply_noise_filter, \
                            detect_local_max_r_peaks, \
                            run_pan_tompkins_segmentation,\
                            run_pan_tompkins_segmentation_nk2,\
                            calculate_signal_fft, \
                            apply_qrst_cancellation, \
                            compute_wavelet_decomposition, \
                            generate_stacked_pqrst_dataset, \
                            generate_stacked_RR_dataset

# importing the function to correct(invert) the flipped samples.(samples where the patients held the alliveCor device incorrectly)
from DSP_modules.inversion_Correction import is_device_inverted, \
                                             flip_ecg_sample, \
                                             run_pan_tompkins_segmentation

import sys
import inspect
from  DSP_modules import peak_detection_algorithms # Import the file containing all the Peak-detection Algorithms



#get All the available peak detection algorithms from the file : peak_detection_algorithms 
def get_peak_detection_algorithms():
    """gets All the available peak detection algorithms from the file : peak_detection_algorithms"""
    algos = {}
    for name, obj in inspect.getmembers(peak_detection_algorithms):
        if inspect.isfunction(obj) and name.startswith('run_'): # adding th condition to chec if the func name starts with run, else it will import all the functions(even those from import statements too!)
            # quick renaming to remove the _ sign for the UI to display it clearly 
            ui_name = name.replace('_', ' ').title()
            algos[ui_name] = obj
    return algos

#this function is just meant to update the UI with the list of avalable algorithms
def get_dropdown_options():
    peak_detection_algorithms =  get_peak_detection_algorithms()
    return list(peak_detection_algorithms.keys())


def run_ecg_pipeline(signal_values: np.ndarray,
                      config: dict) -> dict: # we've used Rust style declaration here < d -> dict >, this ensures that the return type of this function would always be a dictionary 
    """
    Python pipeline for processing raw ECG signals and for extracting features.
    This function and the module aw made to decouple the signal processing logic from the routes(app.py) file
    """
    # 1. Evaluate Polarity and Handle Signal Inversion Logic
    algo_detected_inversion = is_device_inverted(signal_values, sampling_rate=300.0)
    should_flip = algo_detected_inversion != config['force_manual_flip']
    
    if should_flip:
        signal_values = flip_ecg_sample(signal_values)
        if config['force_manual_flip'] and not algo_detected_inversion:
            inversion_status = "Manual Inversion Applied (User Override)"
            is_inverted_payload = True
        elif config['force_manual_flip'] and algo_detected_inversion:
            inversion_status = "Original Polarity Restored (User Override)"
            is_inverted_payload = False
        else:
            inversion_status = "Inversion Correction Applied"
            is_inverted_payload = True
    else:
        is_inverted_payload = False
        inversion_status = "Original Polarity Restored (User Override)" if (config['force_manual_flip'] and algo_detected_inversion) else "Normal Orientation Verified"

    # 2. Extract Mathematical Windows
    long_signal = signal_values[:9000]
    timeline_signal = signal_values[:9000] if config['timeline_scale'] == 'full' else signal_values[:2500]
    processed_signal = timeline_signal.copy()
    
    # No longer doing that as we're forcing the memebrs to be compacted to a dict at the end of this function
    # Initialize features payload structures
#    output = {
#        "inversion_status": inversion_status,
#        "is_inverted": is_inverted_payload,
#        "local_r_indices": [],
#        "features": {"P": [], "Q": [], "R": [], "S": [], "T": []},
#        "features_nk2": {'P_nk2':[], 'Q_nk2':[], 'R_nk2':[], 'S_nk2':[], 'T_nk2':[]},
#        "poincare_data": {"x": [], "y": []},
#        "fft_data": {"frequencies": [], "magnitudes": []},
#        "wavelet_data": {}
#    }

    local_r_indices = []
    features = {"P": [], "Q": [], "R": [], "S": [], "T": []}
    poincare_data = {"x": [], "y": []}
    fft_data = {"frequencies": [], "magnitudes": []}
    wavelet_data = {}  # simpler design 
    features_Nk2 = {'P_nk2':[], 'Q_nk2':[], 'R_nk2':[], 'S_nk2':[], 'T_nk2':[]}
    stacked_beats_dataset = {}
    Stacked_Beats_On_Beats_dataset = {}
 
    peak_detection_algorithms =  get_peak_detection_algorithms()

    # 3. Apply Filtering Steps
    if config['enable_filter']:
        processed_signal = apply_noise_filter(processed_signal)
        long_signal = apply_noise_filter(long_signal)

    # 4. Feature Extraction Processing Steps
    if config['enable_local_r']:
        signals, info = nk.ecg_process(processed_signal, sampling_rate=300)
        raw_peaks = info.get("ECG_R_Peaks")
        local_r_indices = raw_peaks.tolist() if raw_peaks is not None else []

    if config['enable_pan']:
        features = run_pan_tompkins_segmentation(processed_signal)
        
    #if config['use_pan_tompkins_with_nk2']:
    #    features_Nk2 = run_pan_tompkins_segmentation_nk2(processed_signal)

    if config['enable_cancel']:
        r_peaks_for_cancel = run_pan_tompkins_segmentation(processed_signal)["R"]
        processed_signal = apply_qrst_cancellation(processed_signal, r_peaks_for_cancel)


    #Handling  the QRS-Detection,
    #  now we use the peak_detection_method to detect one of the following values if not false
    # 1. "Pan-Tompkins-Native"
    # 2. "Pan-Tompkins-Neurokit2"
    # 3. "Pan-Tompkins-Space-Age"
    if config['peak_detection_method'] != 'false':
        # Clean the string completely and normalize it to match the dictionary key name for algo list
        # This turns "pan+tompkins+native" into "Pan Tompkins Native"
        corrected_method_name = config['peak_detection_method'].replace("+", " ").replace("_", " ").title()

        print(f"input algo key name from from view : {config['peak_detection_method']}; corrected key name : {corrected_method_name}")

        # get the functor or fmnction pointer from algolist dictionary 
        peak_algo_function = peak_detection_algorithms.get(corrected_method_name)

        # Ensure the function name actually exists before calling it or else it will end up in error 
        if peak_algo_function:
            features = peak_algo_function(processed_signal)
        else:
            #error occured
            raise ValueError(f"Algorithm '{corrected_method_name}' could not be resolved in the registry.")

        
        # we used a function pointer to avoid writing the below lines evrytine we get ourselves a new peak detection function
        #if config['peak_detection_method'] == 'Pan-Tompkins-Native':
        #    features = run_pan_tompkins_segmentation(processed_signal)
        #
        #if config['peak_detection_method'] == 'Pan-Tompkins-Neurokit2':
        #    features = run_pan_tompkins_segmentation(processed_signal)
#
        #if config['peak_detection_method'] == 'Pan-Tompkins-Space-Age':
        #    features = run_pan_tompkins_segmentation(processed_signal)
          
    if config['enable_poincare']:
        long_peaks = detect_local_max_r_peaks(long_signal)
        if len(long_peaks) > 1:
            rr_intervals_ms = (np.diff(long_peaks) / 300.0) * 1000.0
            if len(rr_intervals_ms) > 1:
                poincare_data["x"] = rr_intervals_ms[:-1].tolist()
                poincare_data["y"] = rr_intervals_ms[1:].tolist()
                 
    if config['enable_fft']:
        if config['enable_cancel']:
            long_peaks_for_cancel = run_pan_tompkins_segmentation_nk2(long_signal)["R"]
            fft_target = apply_qrst_cancellation(long_signal, long_peaks_for_cancel)
        else:
            fft_target = long_signal
        fft_data = calculate_signal_fft(fft_target)

    if config['use_wavelet']:
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
 
    print(f"config['stacked_beats']: {config['stacked_beats']}")
    if config['stacked_beats']:
        stacked_beats_dataset =  generate_stacked_pqrst_dataset(processed_signal, 300)  

    print(f"config['Stacked_Beats_On_Beats']: {config['Stacked_Beats_On_Beats']}")
    if config['Stacked_Beats_On_Beats']:
        Stacked_Beats_On_Beats_dataset =  generate_stacked_RR_dataset(processed_signal, 300)  

    if config['Stacked_n_RR_Beats']:
        features = run_pan_tompkins_segmentation(processed_signal)  

    if config['VIX_Beats']:
        features = run_pan_tompkins_segmentation(processed_signal)  




    return ({
        "orientation_status": inversion_status,     # this simple hold the message of the orientation status
        "is_inverted": is_inverted_payload,         # This is the flag that actually asks the UI to flip the signal
        "data": processed_signal.tolist(),
        "local_r_peaks": local_r_indices,
        "features": features,
        #"features_using_nk2":features_Nk2, # pan tompkins but using nk2 instead of our custom function
        "poincare": poincare_data,
        "fft": fft_data,
        "wavelets": wavelet_data,
        "stacked_beats_dataset": stacked_beats_dataset,
        "Stacked_Beats_On_Beats" : Stacked_Beats_On_Beats_dataset
    })
