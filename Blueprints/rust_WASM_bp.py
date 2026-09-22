import os
import mimetypes
from flask import Blueprint, send_from_directory

# 1. Initialize the blueprint
frontend_bp = Blueprint(
    'rust_frontend', 
    __name__
)

# 2. Hard-register WASM headers explicitly for PythonAnywhere
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('text/javascript', '.js')


# 3. Give Flask the exact absolute path to your Windows dist folder
DIST_DIR = r'C:/Project/ECG_App_Afresh_After_Git_Destroyed_Original/static/WASM_way/egui_wasm_demo/dist'

@frontend_bp.route("/")
def index():
    """Serves the index.html from your dist folder."""
    return send_from_directory(DIST_DIR, "index.html")

@frontend_bp.route("/<path:filename>")
def serve_static(filename):
    """Serves your JS and WASM files with the correct headers."""
    mime_type, _ = mimetypes.guess_type(filename)
    #return send_from_directory(DIST_DIR, filename, mimetype=mime_type)
    return send_from_directory(DIST_DIR, filename, mimetype=mime_type)