# ---------------------------------------------------------------------------
# Blueprints/lab_bp.py
#
# The in-depth single-sample analysis page, and only the page.
#
# NO url_prefix, on purpose. It used to be served from
# feature_engg_bp's root, which meant /api/v1/splunk/ returned HTML --
# a page inside an API namespace. The two are separate concerns that
# only ever looked related because they shared a prefix.
#
# WHEN THIS PAGE WANTS A LINK PREVIEW
#   send_from_directory serves static/index.html as a FILE. No Jinja, no
#   render -- which is why four months of head-tag, page_meta, OG and
#   icon work never touched it, and why it still has no meta tags. To
#   give it any, move the file to templates/lab.html and swap this for:
#
#       return render_template("lab.html",
#                              page_meta=meta_for(None, "/lab"))
#
#   Worth knowing either way: because the file lives in static/, it is
#   ALSO reachable at /static/index.html. Two URLs for one page, whatever
#   the routes say. Moving it into templates/ is what actually fixes that.
# ---------------------------------------------------------------------------

from flask import Blueprint, send_from_directory

lab_bp = Blueprint('lab', __name__)


@lab_bp.route('/lab')
def lab():
    return send_from_directory('static', 'index.html')
