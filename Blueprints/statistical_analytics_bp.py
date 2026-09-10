"""
Blueprint for the ECG Shorts feed.

Currently minimal on purpose: the feed still runs on client-generated
synthetic waveforms (see generateSyntheticEcg in shorts_feed.js), so there's
no real data layer to wire up yet. This blueprint's only job right now is
serving the page shell, same as statistical_analytics_bp serves its
dashboard shell.

The commented-out section at the bottom marks exactly where a real
/api/shorts/next endpoint (backed by a future EcgShortsStore, following the
same Store/Manager pattern as SpectralBandStore) will attach once actual
sample data replaces the synthetic placeholder.
"""

from flask import Blueprint, render_template, jsonify
from flask import Flask, Blueprint, jsonify, request, send_from_directory, redirect  # blueprint is used to modularise the app, without BP, the app will hold all the functionality, with BP we van modularise the code into several sub-apps 




# to get the dataset for pre-computed FrequencyDomain features 
from Services.Spectral_Band_Store import SpectralBandStore

# we also need to import the Spectral band store manager so  
# we can remember the state of each the individual Spectral_Band_Store objects
# inside the routing file. if this is not used then we would have come up with a mechanism inside app.py
# to remember the state of each Spectral_Band_Store object
from Services.Spectral_Band_Store_Manager import SpectralBandStoreManager


statistical_analytics_bp   = Blueprint('statistical_analytics', __name__)

CLASS_NAMES = {"N": "Normal", "A": "Atrial Fibrillation", "O": "Other", "~": "Noisy"}


manager = SpectralBandStoreManager()
manager.register("full_length", SpectralBandStore(
    csv_path="data_cache/SpectralBandStore/HDF5_Full_Length_FFT_To_PSD_band_features-All_Samples.csv",
    class_names=CLASS_NAMES,
    dataset_name="full_length",
))
manager.register("fixed_9k", SpectralBandStore(
    csv_path="data_cache/SpectralBandStore/FFT_fixed9k_to_PSD_Percentage_for_1Hz_Bands-All_Samples.csv",
    class_names=CLASS_NAMES,
    dataset_name="fixed_9k",
))

def parse_classes_param():
    """?classes=N,A,O -> ['N','A','O']; missing/empty -> []"""
    raw = request.args.get("classes", "")
    return [c for c in raw.split(",") if c]






# Routes start here 
@statistical_analytics_bp.route('/')
def index2():
    return send_from_directory('static', 'index3.html')

 
 
# ---------------------------------------------------------------------------
# GET /api/dataset/<dataset_name>/classes
# Feeds the dynamic class checkboxes -- called on page load and whenever the
# dataset dropdown changes.
# ---------------------------------------------------------------------------
@statistical_analytics_bp.route("/api/dataset/<dataset_name>/classes")
def get_classes(dataset_name):
    store, err = manager.get_or_error(dataset_name)
    if err:
        return jsonify({"error": err}), 404
    return jsonify({"classes": store.get_available_classes()})
 
 
# ---------------------------------------------------------------------------
# GET /api/plot/raw-bands?dataset=...&classes=N,A&max_per_class=100
# Feeds Class Profile, Distribution (violin/box), and Heatmap -- all three
# computed client-side in JS/Plotly from this one raw payload.
# ---------------------------------------------------------------------------
@statistical_analytics_bp.route("/api/plot/raw-bands")
def get_raw_bands():
    dataset_name = request.args.get("dataset")
    store, err = manager.get_or_error(dataset_name)
    if err:
        return jsonify({"error": err}), 404
 
    labels = parse_classes_param()
    if not labels:
        return jsonify({"error": "No classes specified"}), 400
 
    max_per_class = int(request.args.get("max_per_class", 300))
    n_bands = int(request.args.get("n_bands", 40))
 
    result = store.get_raw_bands(labels, n_bands=n_bands, max_per_class=max_per_class)
    return jsonify(result)
 
 
# ---------------------------------------------------------------------------
# GET /api/plot/pcatsne?dataset=...&classes=N,A&max_per_class=100&force=false
# The one server-cached, expensive computation -- checked against in-memory
# then on-disk cache before falling through to sklearn.
# ---------------------------------------------------------------------------

@statistical_analytics_bp.route("/api/plot/pcatsne")
def get_pcatsne():
    dataset_name = request.args.get("dataset")
    store, err = manager.get_or_error(dataset_name)
    if err:
        return jsonify({"error": err}), 404
 
    labels = parse_classes_param()
    if not labels:
        return jsonify({"error": "No classes specified"}), 400
 
    max_per_class = int(request.args.get("max_per_class", 300))
    force = request.args.get("force", "false").lower() == "true"
 
    result = store.get_pca_tsne_coords(labels, max_per_class=max_per_class, force_recompute=force)
    return jsonify(result)
 
 
# ---------------------------------------------------------------------------
# POST /api/dataset/<dataset_name>/reload
# Manual trigger for when the underlying CSV has grown/changed -- re-reads
# the file and wipes the PCA/t-SNE cache for that dataset only.
# ---------------------------------------------------------------------------
@statistical_analytics_bp.route("/api/dataset/<dataset_name>/reload", methods=["POST"])
def reload_dataset(dataset_name):
    store, err = manager.get_or_error(dataset_name)
    if err:
        return jsonify({"error": err}), 404
    store.reload()
    return jsonify({"status": "reloaded", "dataset": dataset_name})
 
 
@statistical_analytics_bp.route("/api/datasets/reload-all", methods=["POST"])
def reload_all_datasets():
    manager.reload_all()
    return jsonify({"status": "reloaded", "datasets": manager.list_datasets()})
 


