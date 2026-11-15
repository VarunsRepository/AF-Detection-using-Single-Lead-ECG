# ---------------------------------------------------------------------------
# catalog/packs/drm.py
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer

dsp("drm_path",
    entrypoint="/static/shorts/filters/drm_filter.js",
    label="Secure path",
    description="Walks a frame from CDN to panel, asking at each step "
                "whether a screenshot could have read it",
    requires={"fields": ["meta.pipeline"], "fs_required": False,
              "domains": ["media.drm"]},
    provides={"fields": ["finalOutput.pipeline", "finalOutput.grab",
                         "finalOutput.row", "finalOutput.table"],
              "fs": None, "domain": "media.drm"})

renderer("secure_path_view",
         entrypoint="/static/shorts/renderers/secure_path_view.js",
         label="Secure path",
         description="The pipeline, the capture probe, and the published "
                     "resolution table",
         requires={"fields": ["finalOutput.pipeline"]})
