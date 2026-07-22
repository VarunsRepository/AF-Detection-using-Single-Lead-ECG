import os
import urllib.request # to send web requests to the Physionet site 
import scipy.io       # to use plotly(), which is our star performer 
import numpy as np    # for interim processing for the ECG Signal 

 # all the stuff to make a web-site in minutes without needing to learn  the usage of dead-sea scrools of Django 
from flask import Flask, Blueprint, jsonify, request, send_from_directory, redirect  # blueprint is used to modularise the app, without BP, the app will hold all the functionality, with BP we van modularise the code into several sub-apps 
 

# to get of pre-computed Statistical features 
from Services.ECG_Feature_Manager import ECG_Signal_Feature_Manager 


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
     
# PHYSIONET MANAGER TO MANAGE THE I/O FROM THE PHYSIONET WEBSITE  
#  pass the configuration directories directly into the PhysioNetRegistryManager class constructor
# we have created an object for easier state management
physionet_mgr = PhysioNetRegistryManager(cache_dir="data_cache")

physionet_mgr.initialize_registry()


# ECG FEATURE MANAGER TO FETCH THE FEATURES LIKE HRV, VIX DIRECTLY FROM THE LOCAL FILE
ECG_Features = ECG_Signal_Feature_Manager(cache_dir="data_cache")



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
    
    print(f"[BACKEND] Great Success! Found {len(samples_list)} records for class '{target_class}'")
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
        'record_id'             : record_id,
        'enable_filter'         : request.args.get('filter', 'false').lower() == 'true',
        'enable_local_r'        : request.args.get('local_r', 'false').lower() == 'true',
        'enable_pan'            : request.args.get('pan_tompkins', 'false').lower() == 'true',
        'enable_poincare'       : request.args.get('poincare', 'false').lower() == 'true',
        'enable_fft'            : request.args.get('fft', 'false').lower() == 'true',
        'enable_cancel'         : request.args.get('cancel', 'false').lower() == 'true',
        'use_wavelet'           : request.args.get('wavelet', 'false').lower() == 'true',
#        'use_pan_tompkins_with_nk2': request.args.get('pan_tompkins_with_nk2', 'false').lower() == 'true',
        'timeline_scale'        : request.args.get('scale', 'short').lower(),
        'force_manual_flip'     : request.args.get('manual_flip', 'false').lower() == 'true',
        'peak_detection_method' : request.args.get('peak_detection_method', 'false').lower(),  
        'stacked_beats'         : request.args.get('StackedBeats', 'false').lower() == 'true',
        'Stacked_Beats_On_Beats': request.args.get('StackedBeatsOnBeats', 'false').lower() == 'true',
        'Stacked_n_RR_Beats'    : request.args.get('Stacked_n_RR_Beats', 'false').lower() == 'true',
        'VIX_Beats'             : request.args.get('VIX_Beats', 'false').lower() == 'true' 
    }

    try:
        # Changing this to the new method get_individual_record_wfdb() which reads the ECG recording by the old legacy way 
        signal_values = physionet_mgr.get_individual_record_wfdb(record_id)
        
        # Direct downstream vector payload execution to pipeline engine
        result_payload = run_ecg_pipeline(signal_values, config)
        
        # Return serialized dictionary directly to UI graph modules
        return jsonify(result_payload), 200

    except Exception as e:
        print(f"[API ERROR] Pipeline processing crash for record {record_id}: {e}")
        return jsonify({"error": str(e)}), 500
 
# this route is used to check if the current config for the signal already exists in the ECG signal manager store. 
# if it exists, we'll simply simply fetch the current config and update the UI as it is instead of running the whole pNN50 or VIX math all over again 
@featureEngg_bp.route('get-stat', methods=['GET'])
def get_statistic():
    record_id = request.args.get('record_id')
    stat_name = request.args.get('stat_name')
    version = request.args.get('version')
    
    # qurty the Feature from the ECG_Feature_Manager object  
    metric_data = ECG_Features.get_metric(record_id, stat_name, version)
    
    if metric_data:
        return jsonify({"cached": True, "data": metric_data})
    return jsonify({"cached": False, "message": "Computation required."})

# This route is used to save the current config for the given sample inside the ECG Signal Manager store 
# for whichever current config that you have selected(may it could be small-signal-Sample or full-signal-Sample, it could be oritentation-corrected-Sample  or Origianl-oritentation-restored-Sample ) 
# when you read a record with for the first time and check for any of the metrics like VIX or pNN50 witht that config, the metric has to be calcualted for the first time run 
@featureEngg_bp.route('/save-stat', methods=['POST'])
def save_statistic():
    payload = request.json
    
    # saving the feaure into the object
    ECG_Features.update_metric(
        record_id=payload["record_id"],
        stat_name=payload["statistic_name"],
        value=payload["value"],
        version=payload["version"],
        timestamp=payload.get("last_calculated", "2026-07-19T00:00:00Z")
    )
    
    return jsonify({"status": "Great Success", "message": "RAM state updated. Background persistence active."})


# This route is used to rubber stamp the sample when you click the rubber stamp button
# THE READER ROUTE (GET)
@featureEngg_bp.route('/get-record-meta', methods=['GET'])
def get_record_meta():
    # Readers pass parameters via URL/Query string: ?record_id=123
    record_id = request.args.get('record_id')
    
    if not record_id:
        return jsonify({"status": "Failed", "error": "Missing record_id"}), 400
        
    stamp_info = ECG_Features.get_rubber_stamp_config(record_id)
    
    if stamp_info:
        return jsonify({"status": "Success", **stamp_info})
        
    return jsonify({"status": "Success", 
                    "record_id": record_id, 
                    "is_verified": False})


# THE WRITER ROUTE (POST)
@featureEngg_bp.route('/rubber-stamp-record', methods=['POST'])
def rubber_stamp_record():
    # Writers pass parameters via JSON Body
    data = request.get_json() or {}
    record_id = data.get('record_id')
    verified_signature = data.get('verified_signature')
    
    if not record_id or not verified_signature:
        return jsonify({"status": "Failed", "error": "Missing parameters"}), 400
        
    # Execute the write and disk save
    ECG_Features.rubber_stamp_record_config(record_id, verified_signature)
    
    return jsonify({"status": "Success", "message": f"Config locked for {record_id}"})



app.register_blueprint(featureEngg_bp, url_prefix='/api/v1/splunk')

# think of it as the main() function of this web-sites programs  
if __name__ == '__main__':
    # run  the app on the entire LAN, site is accessible by Phone/Tablets/etc any device on the same WiFi 
    app.run(host='0.0.0.0', port=8080, debug=True)
    
    # Run the app only on the local machine
    #app.run(port=8080, debug=True)


 
