# ---------------------------------------------------------------------------
# catalog/journeys/_shared.py
#
# Constants used by more than one recipe. Kept separate so a recipe file
# can be deleted without silently breaking another one that happened to
# borrow a value defined inside it -- which is exactly what nearly
# happened when these recipes were split out of journey_bp.py.
# ---------------------------------------------------------------------------

_SHARED_TEST_THEME = {
    "activeTheme": "test",
    "themes": [{"id": "test", "palette": {"primary": "#00FF66", "accent": "#FF3366"}}],
}
_SHARED_TEST_RULES = {"allowStageNavigation": True, "autoAdvance": False, "preloadNextStage": False}
_SHARED_TEST_SHELL = {"showProgressBar": True, "progressBar": {"position": "top", "activeColor": "rgba(255,165,0,0.8)", "inactiveColor": "rgba(255,255,255,0.2)"}}
_SHARED_TEST_LAYOUT = {"title": "bottom", "description": "bottom", "plot": "center", "caption": "bottom"}
