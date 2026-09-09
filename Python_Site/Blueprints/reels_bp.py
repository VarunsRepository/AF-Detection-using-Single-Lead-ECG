"""
ReelsOnly Blueprint - Proof that the feed engine is agnostic of journey logic.

This route serves the SAME feed/scroll engine, but with a completely different
"recipe" that has nothing to do with ECG/DWT/medical at all.

The feed engine doesn't care what journeyJson contains — it just:
  1. Paginates samples
  2. Builds empty cards
  3. Watches for scroll-into-view
  4. Calls interpretJourney() with whatever recipe it got

This proves separation of concerns.
"""

from flask import Blueprint, render_template
from Services.dsp_store import DspAlgorithmStore
from Services.rendering_store import RenderingStore

reels_bp = Blueprint('reels', __name__, url_prefix='/reels')

# Each blueprint instantiates its own store references and registers
# what IT needs -- not borrowed from another blueprint. If journey_bp
# registers pan_tompkins and reels_bp also needs it, both register it
# independently into their own store instances.
#
# NOTE: these are separate instances from journey_bp's stores. That's
# intentional -- reels_bp is an independent peer, not a dependent of
# journey_bp. The tradeoff: if you add a new algorithm to journey_bp's
# dsp_store, you also add it here if reels needs it. Small duplication
# for a clean boundary.
dsp_store = DspAlgorithmStore()
dsp_store.register("pan_tompkins",
    entrypoint="/static/shorts/filters/pan_tompkins_filter.js",
    label="Pan-Tompkins", description="Real-time ECG peak detection")

rendering_store = RenderingStore()
rendering_store.register("chart_v1",
    entrypoint="/static/shorts/renderers/chart_v1.js",
    label="ECG Sweep", description="Progressively-revealed waveform")

# A completely different "journey" — imagine a fitness app showing workout form videos
FITNESS_RECIPE = {
    "globalThemes": {
        "activeTheme": "fitness",
        "themes": [
            {
                "id": "fitness",
                "palette": {
                    "primary": "#FF6B35",  # orange, energetic
                    "accent": "#004E89"
                }
            }
        ]
    },
    "journeyRules": {
        "allowStageNavigation": True,
        "autoAdvance": True,
        "preloadNextStage": True
    },
    "uiShell": {
        "showProgressBar": True,
        "progressBar": {
            "position": "top",
            "activeColor": "rgba(255, 107, 53, 0.8)",
            "inactiveColor": "rgba(255, 255, 255, 0.2)"
        }
    },
    "playbackConfig": {
        "isPaused": False
    },
    "layout": {
        "title": "bottom",
        "description": "bottom",
        "plot": "center",
        "caption": "bottom"
    },
    "stages": [
        {
            "stageId": "form_check_1",
            "dataSource": {
                "mode": "HTTP_REST"
            },
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "pan_tompkins", "isDefault": True}
                ],
                "parameters": {"invertSignal": False}
            },
            "renderingEngine": {
                "renderer": "chart_v1"  # Use the actual ECG sweep renderer
            },
            "uiFillers": {
                "title": "Squat Form Check",
                "caption": "Watch the correct form and compare to the skeleton tracker",
                "description": "Keep your knees aligned with your toes. Back stays straight."
            },
            "railControls": [
                {
                    "ui": {"label": "Slow", "icon": "icon_speed"},
                    "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}
                },
                {
                    "ui": {"label": "Theme", "icon": "icon_theme"},
                    "action": {"target": "journey", "method": "cycleTheme", "payload": {}}
                }
            ],
            "baseDurationMs": 8000
        },
        {
            "stageId": "form_check_2",
            "dataSource": {
                "mode": "HTTP_REST"
            },
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "pan_tompkins", "isDefault": True}
                ],
                "parameters": {"invertSignal": False}
            },
            "renderingEngine": {
                "renderer": "video_overlay"
            },
            "uiFillers": {
                "title": "Deadlift Form Check",
                "caption": "Hinge at the hips, keep the bar close to your body",
                "description": "Common mistake: rounding your back. Keep your spine neutral."
            },
            "railControls": [
                {
                    "ui": {"label": "Slow", "icon": "icon_speed"},
                    "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}
                },
                {
                    "ui": {"label": "Theme", "icon": "icon_theme"},
                    "action": {"target": "journey", "method": "cycleTheme", "payload": {}}
                }
            ],
            "baseDurationMs": 8000
        }
    ],
    "api_endpoint": "/reels/api/fitness/samples"  # Includes the blueprint's /reels prefix
}

@reels_bp.route('/fitness')
def reels_only():
    """
    Proves the feed engine is agnostic.
    
    Same journey_page.html template, same journey_scroll_feed.js,
    but a completely different recipe and endpoint base.
    """
    dsp_entrypoints = dsp_store.resolve(FITNESS_RECIPE['stages'])
    rendering_entrypoints = rendering_store.resolve(FITNESS_RECIPE['stages'])

    return render_template(
        'shorts/journey_page.html',
        journey_themes=FITNESS_RECIPE['globalThemes'],
        journey_rules=FITNESS_RECIPE['journeyRules'],
        journey_stages=FITNESS_RECIPE['stages'],
        journey_ui_shell=FITNESS_RECIPE['uiShell'],
        journey_playback_config=FITNESS_RECIPE['playbackConfig'],
        journey_layout=FITNESS_RECIPE['layout'],
        journey_api_endpoint=FITNESS_RECIPE['api_endpoint'],
        sample_endpoint_base="/reels/api/fitness/samples",
        dsp_entrypoints=dsp_entrypoints,
        rendering_entrypoints=rendering_entrypoints,
    )


# ─────────────────────────────────────────────────────────────────────────
# MOCK DATA ENDPOINT (for testing without a real fitness video database)
# In production, this would query a real database.
# ─────────────────────────────────────────────────────────────────────────

@reels_bp.route('/api/fitness/samples', methods=['GET'])
def fitness_samples():
    """
    Mock endpoint that returns fitness video sample IDs.
    Must match the exact shape that journey_scroll_feed.js expects:
    {samples: [{record_id, ...}, ...], total: N}
    """
    from flask import request
    
    limit = request.args.get('limit', 20, type=int)
    offset = request.args.get('offset', 0, type=int)
    
    # Mock fitness video database
    all_samples = [
        {"record_id": f"fitness_video_{i:03d}", "videoName": f"Workout {i+1}"}
        for i in range(100)  # Pretend we have 100 fitness videos
    ]
    
    samples = all_samples[offset:offset+limit]
    total = len(all_samples)
    
    return {
        "samples": samples,
        "total": total
    }


@reels_bp.route('/api/fitness/samples/<record_id>/raw', methods=['GET'])
def fitness_sample_raw(record_id):
    """
    Mock endpoint returning raw fitness video "signal" data.
    
    In reality, this would return a video stream or a pose-skeleton sequence.
    For this proof-of-concept, we mock it as a signal (same shape as ECG).
    """
    import random
    
    # Mock: pretend each "fitness video" is a 5-second stream of pose confidence scores
    # In reality: this would be video frames or pose keypoints
    samples = [random.uniform(0.5, 0.95) for _ in range(2500)]  # 2500 @ 500Hz = 5 seconds
    
    return {
        "signal": samples,
        "fs": 500,
        "metadata": {"videoType": "form_check", "exercise": "squat", "record_id": record_id}
    }