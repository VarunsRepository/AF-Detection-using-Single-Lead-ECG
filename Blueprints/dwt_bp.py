# ---------------------------------------------------------------------------
# dwt_bp.py
# Routes for the DWT experimental demo -- kept as its OWN blueprint,
# separate from shorts_bp, matching how the DWT frontend files also live
# in their own dwt_demo/ folder rather than mixed into core/filters/features.
# DWT is a genuinely separate concern from the ECG pipeline (a standalone
# 2-stage Journey, not part of the registerStage("ecg", ...) pipeline), so
# it gets its own blueprint rather than being folded into shorts_bp.
#
# Neither route needs to pass any data to the template -- both pages read
# their sample ID from the URL's own query string client-side
# (window.location.search in dwt_demo.js / dwt_journey.js), and both fetch
# raw signal data via the EXISTING /shorts/api/sample/<id>/raw endpoint
# already provided by shorts_bp -- no new data endpoint needed for either
# page as they currently work.
# ---------------------------------------------------------------------------

from flask import Blueprint, render_template

dwt_bp = Blueprint('dwt', __name__, url_prefix='/dwt')


@dwt_bp.route('/demo')
def dwt_demo():
    """
    Standalone tab-view DWT demo. Single chart; tapping a step tab
    (Original / L1 Approx / L1 Detail / ...) replaces what's shown --
    one level visible at a time. The earlier, simpler of the two DWT demos.
    """
    return render_template('shorts/dwt_demo.html')


@dwt_bp.route('/journey')
def dwt_journey():
    """
    The 2-stage DWT Journey: Stage 0 (animated raw-signal sweep, reusing
    the real sweep-animation machinery from shared_signal_utils.js) and
    Stage 1 (a multi-select comparison view -- toggle any combination of
    D1..Dn and the final Dn's approximation on/off, each getting its own
    small static chart, stacked and scrollable, all visible at once).
    """
    return render_template('shorts/dwt_journey.html')


# ---------------------------------------------------------------------------
# Registration -- add this to wherever your Flask app registers its other
# blueprints (the same place shorts_bp gets registered), e.g.:
#
#     from dwt_bp import dwt_bp
#     app.register_blueprint(dwt_bp)
#
# Once registered, the two pages are reachable at:
#     /dwt/demo
#     /dwt/journey
# ---------------------------------------------------------------------------
