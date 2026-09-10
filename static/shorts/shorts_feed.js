// ---------------------------------------------------------------------------
// shorts_feed.js
// The ECG journey's bootstrap -- deliberately tiny. All the actual feed
// mechanics live in core/journey_feed.js; all the actual stage WIRING now
// comes from a server-sent RECIPE (window.JOURNEY_RECIPE, embedded by
// shorts_feed.html from journeys_catalog.py's "ecg" entry), interpreted
// by journey_loader.js against the named blocks ecg_stage_blocks.js
// registered. This file's job: load the theme, show onboarding if
// needed, interpret the recipe, then start the feed.
//
// Depends on core/journey_feed.js (startJourneyFeed), core/journey_loader.js
// (loadJourneyFromRecipe), and rail_controls.js (THEMES, themeIndex) --
// all three must be loaded before this file, which loads last.
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
    // Set the theme FIRST, before any chart can render, so nothing ever
    // briefly shows the CSS file's hardcoded defaults before JS catches up.
    // Done regardless of onboarding, so the onboarding overlay ITSELF
    // renders against the correct theme too.
    const defaultTheme = THEMES[themeIndex];
    document.documentElement.style.setProperty("--bg", defaultTheme.bg);
    document.documentElement.style.setProperty("--card-bg", defaultTheme.cardBg);
    document.documentElement.style.setProperty("--ecg-trace-color", defaultTheme.traceColor);
    document.documentElement.style.setProperty("--grid-color", defaultTheme.gridColor);
    document.documentElement.style.setProperty("--zero-line-color", defaultTheme.zeroLineColor);

    // Turn the server-sent recipe into real registerStage() calls, by
    // resolving each named block against ecg_stage_blocks.js's
    // registrations. This is the ENTIRE wiring step now -- nothing here
    // hardcodes which stages exist or in what order; that lives in
    // journeys_catalog.py's data, not this file's code.
    if (typeof loadJourneyFromRecipe === "function" && window.JOURNEY_RECIPE) {
        loadJourneyFromRecipe("ecg", { stages: window.JOURNEY_RECIPE });
    }

    function startEcgFeed() {
        return startJourneyFeed({ journeyName: "ecg", apiEndpoint: "/shorts/api/samples" });
    }

    // Onboarding is optional -- if onboarding.js isn't loaded, or the
    // visitor has already seen ECG's onboarding specifically, the feed
    // just starts immediately.
    const shouldShowOnboarding = typeof hasSeenOnboarding === "function" && !hasSeenOnboarding("ecg");
    if (shouldShowOnboarding) {
        showOnboarding(startEcgFeed, "ecg");
    } else {
        startEcgFeed();
    }
});