# ---------------------------------------------------------------------------
# app.py -- the composition root.
#
# Creates the Flask app, registers the blueprints, and nothing else. Every
# route lives in Blueprints/; every long-lived manager lives with the
# blueprint that owns it. If a route or a store appears in this file
# again, that is the signal it has not found its home yet.
# ---------------------------------------------------------------------------

# all the stuff to make a web-site in minutes without needing to learn the
# usage of dead-sea scrolls of Django
from flask import Flask, send_from_directory, redirect

from Blueprints.statistical_analytics_bp import statistical_analytics_bp
from Blueprints.shorts_bp import shorts_bp
# from Blueprints.dwt_bp import dwt_bp
from Blueprints.journey_bp import journey_bp
from Blueprints.reels_bp import reels_bp   # dummy blueprint, proves the reels
                                           # engine is agnostic of Dataset,
                                           # DSPEngine and RenderingEngine
from Blueprints.rust_WASM_bp import frontend_bp

# The single-sample ECG analysis API, and the page that consumes it.
# Separate blueprints because they are separate concerns -- one is seven
# JSON endpoints, the other is a page. They shared a prefix for months,
# which is the only reason they ever looked related.
from Blueprints.feature_engg_bp import feature_engg_bp
from Blueprints.lab_bp import lab_bp


app = Flask(__name__)


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(app.static_folder, "icons/favicon.ico")


# THE FRONT DOOR, TEMPORARILY.
#
# This is the line that becomes the seed tour. Until then it points at
# /lab so the root is not a 404 -- which is what it was between removing
# the old redirect and wiring the tour up.
#
# When the tour takes over, this whole route is deleted and journey_bp
# serves "/" directly (rendering, not redirecting, so kymograph.dev is
# the canonical address and gets its own preview card).
#@app.route('/')
#def index():
#    return redirect('/lab')


# ── Blueprints ───────────────────────────────────────────────────────────
# Single ECG sample, granular analysis: a bit of everything on one signal.
app.register_blueprint(feature_engg_bp, url_prefix='/api/v1/splunk')

# The analysis page itself. No prefix: it is a page, not an endpoint.
app.register_blueprint(lab_bp)

# Bulk ECG sample analysis -- less computing per sample, more visualising
# many of them at once.
app.register_blueprint(statistical_analytics_bp, url_prefix='/statistical_analytics')

app.register_blueprint(shorts_bp, url_prefix='/shorts')

# app.register_blueprint(dwt_bp)

app.register_blueprint(journey_bp)

app.register_blueprint(reels_bp)

app.register_blueprint(frontend_bp, url_prefix='/rust_frontend')


# think of it as the main() function of this web-site's program
if __name__ == '__main__':
    # Run on the whole LAN, so the site is reachable from any phone or
    # tablet on the same WiFi.
    app.run(host='0.0.0.0', port=8080, debug=True)

    # Local machine only:
    # app.run(port=8080, debug=True)


# ---------------------------------------------------------------------------
# Digitalis (Foxglove): the backyard flower that saves (or stops) the heart.
#
# Foxglove (Digitalis purpurea) is a common, breathtakingly beautiful garden
# plant with bell-shaped purple flowers. Every single part of it is
# incredibly toxic.
#
# THE POISON
#   Eating even a couple of leaves introduces cardiac glycosides into the
#   body. These attack the sodium-potassium pumps inside heart cells. In
#   high doses it causes severe vomiting, hallucinations where everything
#   appears tinted yellow-green (xanthopsia), and throws the heart into
#   fatal, chaotic electrical rhythms that abruptly stop it pumping.
#
# THE TRANSFORMATION INTO MEDICINE
#   In 1785 a Scottish physician, William Withering, noticed a local folk
#   remedy effectively treating "dropsy" -- severe swelling of the legs
#   caused by a failing heart. He tracked the active ingredient back to the
#   foxglove plant.
#
# THE HEALER'S HAND
#   Scientists eventually isolated digoxin, a crucial medication for
#   congestive heart failure and atrial fibrillation. In precisely
#   measured, microscopic doses digoxin does not stop the heart; it slows
#   an unsafely racing one and forces the cardiac muscle cells to hold onto
#   calcium. That calcium boost makes a weakened heart pump with massive,
#   synchronised strength.
#
#   It has a very narrow therapeutic window: the line between a healing
#   dose and a toxic one is razor-thin.
# ---------------------------------------------------------------------------