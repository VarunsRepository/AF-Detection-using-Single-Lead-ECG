# Python ECG Analysis Application

## Overview

This project provides a **Flask-based web application for single-lead ECG analysis**.

The application provides a web interface through which ECG recordings can be selected, processed and visualised using the underlying Python signal-processing pipeline.

The web application acts as the **access layer to the ECG analysis implementation**: the frontend provides the controls and visualisations, Flask manages communication between the browser and the Python processing engine, and the DSP modules perform the actual ECG analysis.

The application also contains **ECG Shorts**, a vertical, interactive ECG exploration experience that presents real ECG recordings as a sequence of progressively more informative processing stages. Rather than showing only a final chart or result, ECG Shorts allows the viewer to move through the signal-processing journey from the raw waveform to a final verdict.

---

## Application Architecture

```text
                           PYTHON ECG APPLICATION
                                    │
                                    ▼
                              Web Browser
                                    │
                                    │ User controls
                                    │ ECG selection
                                    │ Analysis options
                                    ▼
                              Flask
                               app.py
                                    │
                       ┌────────────┴────────────┐
                       │                         │
                       ▼                         ▼
                  Main Analysis              ECG Shorts
                       │                         │
                       ▼                         ▼
                    Engine.py              Shorts Blueprint
                       │                         │
                       ▼                         ▼
                  DSP Modules          Browser Stage Pipeline
                       │                         │
                       └────────────┬────────────┘
                                    ▼
                              Results / JSON
                                    │
                                    ▼
                              Web Browser
                                    │
                                    ▼
                         Interactive visualisation
```

---

# Core Components

## Repository

The **repository is the core item of the application**. It contains the complete implementation required to run the ECG analysis web application, including the Flask backend, processing engine, DSP modules, frontend, ECG Shorts experience and supporting resources.

## Flask Web Application

The Flask application provides the **interface between the browser and the ECG-processing implementation**.

The controls exposed by the web application are the medium through which the underlying ECG algorithms can be accessed and their results visualised.

The browser does not directly perform the main Python ECG analysis. Instead, requests are sent to the Python backend, which executes the appropriate processing pipeline and returns the results.

# Main Application Components

| Component | Description |
|---|---|
| `app.py` | Flask application and HTTP/API routes |
| `Engine.py` | Main ECG-processing pipeline and orchestration layer |
| `DSP_modules/` | Signal-processing and ECG-analysis functions |
| `Blueprints/shorts_bp.py` | Flask blueprint serving the ECG Shorts page and its data APIs |
| `static/index.html` | Main ECG analysis web interface |
| `static/shorts/` | Modular JavaScript and CSS implementation of ECG Shorts |
| `templates/shorts/` | HTML shell for the ECG Shorts feed |
| ECG data | Input ECG recordings used by the application |

# `app.py`

`app.py` is the **Flask application layer**.

Its primary responsibilities are:

- Starting the Flask application
- Serving the web interface
- Registering application blueprints
- Receiving requests from the frontend
- Loading the requested ECG recording
- Building the processing configuration
- Passing the ECG signal to `Engine.py`
- Returning processed results to the frontend

Conceptually:

```text
Browser
   │
   │ HTTP request
   ▼
app.py
   │
   ├── Main ECG analysis routes
   └── ECG Shorts blueprint
           │
           ▼
       Processing / Data APIs
```

# `Engine.py`

`Engine.py` is the **central processing/orchestration layer** of the main application.

It sits between the Flask application and the underlying DSP functions.

Its purpose is to take the ECG signal and configuration supplied by Flask and execute the appropriate sequence of processing operations.

Conceptually:

```text
ECG signal
    │
    ▼
Engine.py
    │
    ├── Signal preparation
    ├── P/Q/R/S/T detection
    ├── QRST processing/cancellation
    ├── Wavelet decomposition
    ├── FFT / spectral analysis
    ├── RR / Poincaré analysis
    └── Result preparation
    │
    ▼
JSON payload
    │
    ▼
Frontend
```

This makes `Engine.py` an important separation layer: **Flask handles the web application, while the engine coordinates the ECG analysis.**

# DSP Modules

The DSP modules contain the underlying signal-processing implementations used by the engine.

Depending on the selected analysis, these functions perform operations including:

- ECG filtering
- R-peak detection
- P/Q/R/S/T identification
- QRST cancellation
- Discrete Wavelet Transform (DWT)
- Fast Fourier Transform (FFT)
- RR interval analysis
- Poincaré analysis
- Spectral feature extraction

The engine calls these functions rather than implementing every algorithm itself.

This keeps the application architecture modular:

```text
Engine.py
    │
    ├── DSP function
    ├── Wavelet function
    ├── FFT function
    ├── ECG detection function
    └── RR analysis function
```

# Web Interface

The main frontend is implemented in:

```text
Python_Site/static/index.html
```

The interface provides controls for selecting ECG samples and configuring the analysis.

The frontend is responsible for:

- Sample selection
- Processing configuration
- Interactive plots
- ECG waveform visualisation
- P/Q/R/S/T markers
- Wavelet visualisation
- FFT/spectral visualisation
- RR/Poincaré visualisation
- Displaying analysis results

The frontend communicates with Flask using HTTP requests and receives processed ECG information from the backend.

---

# ECG Shorts

## Overview

**ECG Shorts** is a separate interactive experience within the Python application that presents ECG analysis in a vertical, short-form format inspired by the interaction model of modern content feeds.

Each card represents a real ECG recording. As the user interacts with a card, the recording progresses through a series of processing stages rather than immediately displaying a final answer.

The current five-stage pipeline is:

```text
Stage 0                  Stage 1                 Stage 2
Raw ECG                  Baseline Correction     Peak Detection
    │                         │                       │
    └─────────────────────────┴───────────────────────┘
                              │
                              ▼
                          Stage 3
                         HRV Metrics
                              │
                              ▼
                          Stage 4
                           Verdict
```

In plain English:

```text
Your Heartbeat
      ↓
Cleaning It Up
      ↓
Finding the Heartbeats
      ↓
Measuring the Rhythm
      ↓
Showing the Verdict
```

This design allows ECG Shorts to expose the **intermediate transformations of an ECG signal**, rather than treating signal processing as an invisible black box.

## ECG Shorts Architecture

```text
                 Flask Application
                         │
                         ▼
                  shorts_bp.py
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       /shorts feed          ECG data APIs
              │                     │
              ▼                     ▼
     shorts_feed.html      PhysioNet registry
              │                     │
              └──────────┬──────────┘
                         ▼
                    Browser Feed
                         │
                         ▼
                  shorts_feed.js
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
          Core        Filters     Features
              │          │          │
              └──────────┼──────────┘
                         ▼
                 Interactive ECG Card
```

The backend supplies real recordings and labels, while the browser manages the staged presentation, signal transformations and interactive visualisations.

## Flask Blueprint and APIs

ECG Shorts is served through `Blueprints/shorts_bp.py`.

The blueprint provides the page shell and APIs used by the browser to retrieve recordings:

| Endpoint | Purpose |
|---|---|
| `/shorts/` | Serves the ECG Shorts feed page |
| `/shorts/api/samples` | Returns a paginated collection of playable ECG records and labels |
| `/shorts/api/sample/<sample_id>/raw` | Returns the raw signal and sampling frequency for a specific ECG record |

The current raw-signal API returns recordings from the application's PhysioNet registry. The ECG Shorts frontend currently works with a sampling frequency of **300 Hz**.

## The Stage Engine

The central architectural component of ECG Shorts is:

```text
static/shorts/core/stage_engine.js
```

The stage engine provides a generic framework through which processing stages can be registered and executed.

Each stage can define:

```text
Stage Definition
│
├── processor  → Calculates the stage output
├── renderer   → Displays or animates the output
├── dependsOn  → Declares which earlier stage provides its input
└── label      → Provides shared descriptive metadata
```

Conceptually:

```text
Stage 0 Output
      │
      ▼
Stage 1 Processor
      │
      ▼
Stage 1 Output
      │
      ▼
Stage 2 Processor
      │
      ▼
Stage 2 Output
```

The dependency is declared explicitly rather than being assumed from the numerical order of stages. This means the architecture can support both linear pipelines and future branches that begin from the raw ECG signal.

The engine also caches processor outputs per sample. If a user revisits a stage without changing the underlying signal or algorithm, the existing calculation can be reused while the animation itself restarts cleanly.

## The Current ECG Shorts Pipeline

### Stage 0 — Raw ECG Signal

Stage 0 is the entry point into the browser-side pipeline. It receives the raw ECG recording, optionally applies per-sample inversion and creates the time axis used for visualisation.

The signal is displayed as an animated five-second sliding ECG window.

### Stage 1 — Baseline Correction

Stage 1 receives Stage 0's waveform and removes slow baseline drift caused by factors such as breathing, movement or electrode contact.

The current implementation uses a low-cutoff high-pass filter so the wandering baseline is reduced while the main ECG morphology is retained.

### Stage 2 — Peak Detection

Stage 2 receives the corrected ECG waveform and detects the locations of heartbeats, represented by R-peak markers.

The peak detector is interchangeable: the stage asks the detector registry for the currently selected algorithm rather than directly depending on one fixed implementation.

### Stage 3 — HRV Metrics

Stage 3 uses the detected R-peaks to calculate RR intervals and heart-rate-variability measurements.

The metrics include mean heart rate, SDNN, RMSSD, pNN50 and Poincaré-derived SD1/SD2 values, along with consecutive RR interval pairs for Poincaré analysis.

### Stage 4 — Verdict

Stage 4 represents the final stage of the current ECG Shorts pipeline. It combines the preceding analysis with the record's associated class label to present the card's conclusion.

The architecture allows the verdict stage to evolve independently as additional analysis or classification logic is introduced.

## `shorts_feed.js` — The Feed Entry Point

`shorts_feed.js` is the main entry point for the ECG Shorts frontend.

Its responsibilities include:

- Fetching real sample IDs and labels from the backend
- Dynamically creating ECG cards
- Building the stage navigation structure
- Loading additional cards as the user scrolls
- Connecting cards to the shared visibility observer
- Wiring the right-side control rail
- Managing session-level viewing statistics
- Starting the feed after optional onboarding

Conceptually:

```text
Backend sample list
        │
        ▼
shorts_feed.js
        │
        ├── Build ECG cards
        ├── Register card controllers
        ├── Watch visible card
        ├── Load more records
        └── Connect rail controls
                │
                ▼
           ECG Shorts Feed
```

Cards are loaded in pages, allowing the feed to expand as the user scrolls rather than constructing the entire ECG collection in the browser at once.

## `stage_machine.js` — Card Progression

Each ECG card has its own stage controller implemented by `stage_machine.js`.

The stage machine manages:

- Entering a stage
- Automatic progression to the next stage
- Restarting the current stage
- Returning to a previous stage
- Pause and resume behaviour
- Progress-bar animation
- Restarting a card from Stage 0 when it becomes visible again

The central principle is that every form of stage navigation passes through a single canonical stage-entry mechanism.

```text
Visible Card
    │
    ▼
Stage 0
    │
    ├── Tap right  → Next stage
    ├── Tap left   → Restart / previous stage
    └── Centre tap → Pause / resume
```

A card deliberately starts fresh from Stage 0 whenever it becomes visible again; the system does not preserve cross-visit progression state.

## `stage_renderers.js` — Processing and Visualisation Bridge

`stage_renderers.js` connects the generic stage engine to the actual ECG visualisations.

It currently:

- Fetches and caches raw ECG signals
- Creates consistent Plotly chart layouts
- Drives animated sliding-window sweeps
- Registers the current pipeline stages with the stage engine
- Renders waveform and peak-detection visualisations
- Coordinates stage-specific animations

The file separates **what a stage computes** from **how that stage is shown**.

```text
Processor Output
       │
       ▼
Stage Renderer
       │
       ├── Build Plotly chart
       ├── Configure ECG window
       └── Animate the sweep
               │
               ▼
          Browser Display
```

## `rail_controls.js` — User Controls

The right-hand control rail contains global and per-sample controls.

The current controls are:

| Control | Behaviour |
|---|---|
| Speed | Changes the duration of stage animations globally |
| Theme | Cycles between predefined visual themes globally |
| Invert | Flips the polarity of one specific ECG sample |
| Algorithm | Switches the active peak-detection algorithm globally |

The file also owns the central stage-duration logic, ensuring the stage machine and chart animations use the same timing rules.

An important distinction is made between cosmetic and computational changes:

```text
Theme / Speed
      │
      └── Visual behaviour changes
          Cached ECG calculations remain valid

Invert / Peak Detector
      │
      └── Signal or processing output changes
          Affected cached stages must be recalculated
```

## `peak_detector_registry.js` — Interchangeable Algorithms

The peak detector registry is the catalogue of available R-peak detection algorithms.

Every detector follows the same contract:

```text
ECG Signal + Sampling Frequency
             │
             ▼
        Detector
             │
             ▼
{ peakIndices, steps }
```

The current registry contains:

- Pan-Tompkins
- Hamilton-Tompkins

Because Stage 2 requests the selected detector through the registry, another compatible peak detector can be added without rewriting the stage renderer itself.

Changing the selected detector invalidates Stage 2 and downstream cached outputs because those results were generated using the previously selected algorithm.

## Signal-Processing Filters

The `static/shorts/filters/` directory contains browser-side, pure-computation algorithms. These files contain signal-processing logic without UI or rendering responsibilities.

### `baseline_correction_filter.js`

Removes slow baseline wander using a high-pass filtering approach. It provides the cleaned waveform used by the later stages of the current pipeline.

### `pan_tompkins_filter.js`

Implements the Pan-Tompkins-based heartbeat detection process and returns detected peak locations along with intermediate processing steps.

Those intermediate steps can also be used by the ECG Shorts algorithm explainer to show how the detector transforms the original signal.

### `hamilton_tompkins_filter.js`

Provides the Hamilton-Tompkins alternative for R-peak detection.

It follows the same output contract as the other registered detector so that Stage 2 can switch algorithms without changing its surrounding pipeline.

### `hrv_metrics_filter.js`

Transforms detected peak locations into RR intervals and time-domain and Poincaré HRV measurements.

It returns both numerical metrics and the consecutive RR interval pairs required for Poincaré-style analysis.

## Educational Features

The `static/shorts/features/` directory contains optional features intended to help users understand the ECG pipeline rather than merely operate it.

### `onboarding.js`

Provides a one-time introductory walkthrough before the feed begins. The onboarding slides are generated from the stages' own registered labels, ensuring that the explanation remains synchronised with the actual pipeline.

### `algorithm_explainer.js`

Provides an opt-in explanation panel for the peak-detection stage.

A viewer can first read a plain-English explanation and then inspect the algorithm's intermediate transformations as full, static plots of the complete recording:

```text
ECG Signal
    │
    ▼
Band-pass Filtering
    │
    ▼
Derivative
    │
    ▼
Squaring
    │
    ▼
Integration
    │
    ▼
Detected Peaks
```

The explainer reuses Stage 2's existing cached result rather than independently recomputing the algorithm.

## ECG Shorts Data and Caching Flow

The ECG Shorts architecture uses caching at two levels.

```text
                         Backend
                            │
                            ▼
                     Raw ECG Request
                            │
                            ▼
                   Raw Signal Cache
                            │
                            ▼
                     Stage Engine
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
       Stage Output Cache             Renderer
              │                           │
              ▼                           ▼
      Reuse calculations          Restart animation
```

This means a user can revisit a stage and receive a fresh visual experience without unnecessarily rerunning the underlying ECG calculations.

The cache is selectively invalidated when a change affects the actual data or processing output.

## Adding a Future Stage

The stage architecture is designed to be extensible.

A new stage does not require the central engine to be rewritten. Instead, the stage can register its own definition:

```text
New Stage
    │
    ├── Declare dependency
    ├── Provide processor
    ├── Provide renderer
    └── Provide descriptive label
            │
            ▼
      registerStage(...)
            │
            ▼
      Stage Engine
```

The same stage metadata can then supply the stage bar, onboarding and contextual captions, reducing the number of independent locations that must be updated when the pipeline grows.

---

# ECG Processing Flow

A typical analysis follows this sequence:

```text
1. Select ECG sample
          │
          ▼
2. Frontend sends request
          │
          ▼
3. Flask receives request
          │
          ▼
4. ECG recording is loaded
          │
          ▼
5. Configuration is created
          │
          ▼
6. Engine.py receives signal
          │
          ▼
7. Signal processing
          │
          ├── Filtering
          ├── P/Q/R/S/T detection
          ├── QRST cancellation
          ├── DWT
          ├── FFT
          └── RR analysis
          │
          ▼
8. Results assembled
          │
          ▼
9. JSON returned to browser
          │
          ▼
10. Frontend visualises results
```

# Signal Length

The application supports different processing windows.

At the application's **300 Hz sampling frequency**:

| Processing option | Samples | Approx. duration |
|---|---:|---:|
| Short Sample | 2,500 | 8.3 s |
| 30 Second Sample | 9,000 | 30 s |
| Full Sample | Entire recording | Recording dependent |

The **Full Sample** option allows recordings longer than 30 seconds to be processed without the application artificially truncating them to 9,000 samples.

For example:

```text
18,000 samples
       │
       ▼
300 samples/second
       │
       ▼
60 second ECG
```

The underlying DSP functions are not intrinsically restricted to 9,000 samples; the processing length is controlled by the application/engine configuration.

# Data Returned to the Frontend

The backend packages analysis results into a structured response that can be consumed by the JavaScript frontend.

Depending on the selected processing pipeline, the response can contain information such as:

```text
ECG signal
P/Q/R/S/T indices
R-peaks
RR intervals
Wavelet coefficients
Wavelet bands
FFT data
Spectral features
Poincaré data
Processed / QRST-cancelled signal
```

This allows the frontend to construct the interactive visualisations without having to perform the core Python ECG processing itself.

# Key Design Principle

The application follows a **separation-of-concerns architecture**:

```text
┌──────────────────────────────────────┐
│              Frontend                │
│     User interface & visualisation   │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│              Flask                   │
│       Application / API layer        │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│             Engine.py                │
│      Processing orchestration        │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│           DSP Modules                │
│       ECG signal processing          │
└──────────────────────────────────────┘
```

ECG Shorts applies the same principle inside the browser:

```text
Feed
 │
 ├── Stage Machine     → Interaction and progression
 ├── Stage Engine      → Dependencies and cached computation
 ├── Renderers         → Visual presentation
 ├── Filters           → Pure signal processing
 └── Features          → Education and onboarding
```

This separation makes it possible to modify the frontend, application routing or processing algorithms independently.

# Running the Application

The application is built around Flask and can be run locally using the Python environment containing the project's dependencies.

Typical execution:

```bash
python app.py
```

The Flask server then exposes the web application through the configured host and port.

# Repository Structure

A simplified view of the application is:

```text
AF-Detection-using-Single-Lead-ECG/
│
├── Python_Site/
│   │
│   ├── app.py
│   │
│   ├── Blueprints/
│   │   └── shorts_bp.py
│   │
│   ├── Engine/
│   │   └── Engine.py
│   │
│   ├── DSP_modules/
│   │   ├── DSP.py
│   │   └── ...
│   │
│   ├── templates/
│   │   └── shorts/
│   │       └── shorts_feed.html
│   │
│   ├── static/
│   │   ├── index.html
│   │   ├── index2.html
│   │   │
│   │   └── shorts/
│   │       ├── shorts_feed.js
│   │       ├── shorts_feed.css
│   │       │
│   │       ├── core/
│   │       │   ├── stage_engine.js
│   │       │   ├── stage_machine.js
│   │       │   ├── stage_renderers.js
│   │       │   ├── rail_controls.js
│   │       │   └── peak_detector_registry.js
│   │       │
│   │       ├── filters/
│   │       │   ├── baseline_correction_filter.js
│   │       │   ├── pan_tompkins_filter.js
│   │       │   ├── hamilton_tompkins_filter.js
│   │       │   └── hrv_metrics_filter.js
│   │       │
│   │       └── features/
│   │           ├── onboarding.js
│   │           └── algorithm_explainer.js
│   │
│   └── README.md
│
├── notebooks/
├── data/
└── README.md
```

The exact repository contents may contain additional supporting files, notebooks and resources.

# Purpose of the Application

The application provides a unified environment for experimenting with and visualising **single-lead ECG signal processing and atrial-fibrillation-related features**.

Rather than treating the algorithms as isolated scripts, the Flask application provides a common interface through which the processing pipeline can be executed and its intermediate and final results examined interactively.

The ECG Shorts component extends this idea by presenting ECG processing as a progressive, interactive sequence that exposes intermediate transformations to the user.

This is particularly useful for investigating signal characteristics such as:

- ECG morphology
- Baseline drift and signal correction
- R-peak detection
- RR variability
- Heart-rate variability metrics
- Poincaré-derived measurements
- P/Q/R/S/T morphology
- QRST cancellation
- Wavelet-domain features
- Frequency-domain features
- Spectral energy distribution
- Atrial fibrillatory activity

# Application at a Glance

```text
                 SINGLE-LEAD ECG
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
     Main ECG Analysis             ECG Shorts
          │                           │
          ▼                           ▼
       Flask App                  Flask Blueprint
          │                           │
          ▼                           ▼
       Engine.py                 Stage Pipeline
          │                           │
          ▼                    ┌──────┼──────┐
     DSP Modules                ▼      ▼      ▼
                               Raw   Clean  Peaks
                                      │
                                      ▼
                                  HRV / Verdict
          │
     ┌────┼────┬────┬────┐
     ▼    ▼    ▼    ▼    ▼
    ECG  RR   FFT  DWT  QRST
          │
          ▼
   Interactive Results
```

**In short:** the **repository is the core of the implementation**, the **Flask application provides access to it**, `Engine.py` orchestrates the main ECG-processing pipeline, the **DSP modules perform signal analysis**, and the frontend provides interactive access to the results. **ECG Shorts adds a modular, browser-side stage pipeline that progressively transforms and explains real ECG recordings through signal correction, peak detection, HRV analysis and a final verdict.**




Journey flow as on 08-09-2026
═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
BROWSER URL HIT TO FIRST SHORT RENDERED
═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

┌─ USER TYPES: http://localhost:5000/journey/ecg
│
├─ FLASK ROUTE HANDLER
│  FILE: backend/journey_bp.py
│  FUNCTION: @journey_bp.route('/journey/<journey_name>')
│  LINE: 162
│
│  STEP 1: Look up recipe
│  ─────────────────────
│    • journey_name = "ecg" (from URL)
│    • CALL: journey_store.get_journey_config("ecg")
│    • FILE: backend/journey_store.py
│    • CLASS: JourneyStore (instantiated as Services.Journey_Store)
│    • BACKEND STORAGE: journeystore.json (on disk, cached in RAM)
│    •
│    • RETURNS: package = {
│        "globalThemes": {...},
│        "journeyRules": {...},
│        "uiShell": {...},
│        "playbackConfig": {...},
│        "layout": {...},
│        "stages": [...],  ← journey's stage sequence
│        "api_endpoint": "/shorts/api/samples"
│      }
│
│  STEP 2: Render template
│  ──────────────────────
│    • FILE: templates/shorts/journey_page.html
│    • CALL: render_template("journey_page.html", 
│               journey_themes=package["globalThemes"],
│               journey_rules=package["journeyRules"],
│               journey_stages=package["stages"],
│               journey_ui_shell=package["uiShell"],
│               journey_playback_config=package["playbackConfig"],
│               journey_layout=package["layout"],
│               journey_api_endpoint=package["api_endpoint"]
│           )
│    •
│    • HTML RECEIVES (as inline <script> variables):
│      const journeyJson = {
│        globalThemes: {activeTheme: "Clinical", themes: [...]},
│        journeyRules: {allowStageNavigation: true, autoAdvance: true, preloadNextStage: true},
│        uiShell: {showProgressBar: true, ...},
│        playbackConfig: {isPaused: false},
│        layout: {title: "bottom", description: "bottom", plot: "center", caption: "bottom"},
│        stages: [
│          {
│            stageId: "ecg_stage_1",
│            dataSource: {mode: "HTTP_REST"},
│            dspEngine: {algorithm: "pan_tompkins", invertSignal: false},
│            renderingEngine: {renderer: "chart_v1"},
│            uiFillers: {title: "Finding Each Beat", caption: "...", description: "..."},
│            railControls: [...]
│          },
│          {stageId: "ecg_stage_2", ...},
│        ]
│      };
│
├─ HTML LOADS & EXECUTES
│  FILE: templates/shorts/journey_page.html
│  
│  STEP 3: Load static assets
│  ──────────────────────────
│    <link> CSS: static/shorts/shorts_feed.css
│    <script> src: static/shorts/core/rail_controls.js
│    <script> src: static/shorts/core/dispatcher.js
│    <script> src: static/shorts/core/dsp_registry.js
│    <script> src: static/shorts/core/rendering_registry.js
│    <script> src: static/shorts/core/shared_signal_utils.js
│    <script> src: static/shorts/core/journey_interpreter.js
│    <script> src: static/shorts/core/journey_scroll_feed.js
│    <script> src: static/shorts/filters/pan_tompkins_filter.js
│    <script> src: static/shorts/filters/hamilton_tompkins_filter.js
│    <script> src: static/shorts/filters/db4_filter.js
│    
│  STEP 4: Initialize theme
│  ────────────────────────
│    FUNCTION: applyCurrentTheme()
│    FILE: core/rail_controls.js
│    LINE: ~70
│    •
│    • READS: THEMES[themeIndex] (module-level, defaults to 0 = "Clinical")
│    • SETS CSS variables:
│      --bg: "#000000"
│      --grid-color: "rgba(116, 125, 140, 0.18)"
│      --zero-line-color: "rgba(116, 125, 140, 0.4)"
│      --ecg-glow-color: "rgba(232, 244, 248, 0.7)"
│
│  STEP 5: Start the scroll feed
│  ────────────────────────────
│    FUNCTION: startJourneyScrollFeed({
│      apiEndpoint: "/shorts/api/samples",
│      journeyJson: journeyJson,
│      feedContainer: document.getElementById("feed")
│    })
│    FILE: core/journey_scroll_feed.js
│    LINE: 32
│    •
│    • SETUP: IntersectionObserver to detect when cards enter viewport
│    • PAGINATION: offset=0, limit=PAGE_SIZE (20)
│    • FIRST FETCH: /shorts/api/samples?limit=20&offset=0
│    •
│    • RETURNS: array of sample objects:
│      [
│        {sampleId: "ecg_001", data: {...}},
│        {sampleId: "ecg_002", data: {...}},
│        ...
│      ]
│
├─ BUILD FIRST CARD
│  FUNCTION: buildCard(sample)
│  FILE: core/journey_scroll_feed.js
│  LINE: ~60
│  •
│  • CREATES DOM structure:
│    <div class="journey-card">
│      <div class="layout-zone" data-zone="bottom">
│        <div class="stage-title"></div>
│        <div class="stage-caption"></div>
│        <div class="stage-description"></div>
│      </div>
│      <div class="layout-zone" data-zone="center">
│        <div class="chart"></div>
│      </div>
│      <div class="stage-rail"></div>
│      <div class="stage-bar"></div>
│    </div>
│
│  STEP 6: Interpret journey (create state machine)
│  ────────────────────────────────────────────────
│    FUNCTION: interpretJourney(
│      journeyJson,
│      sampleId="ecg_001",
│      chartContainer,
│      railContainer,
│      titleEl,
│      captionEl,
│      progressBarEl,
│      descriptionEl
│    )
│    FILE: core/journey_interpreter.js
│    LINE: 77
│    •
│    • CREATES: instance-level state
│      • currentStageIndex = 0
│      • isPaused = false
│      • dspOutputCache = Map()
│      • stageOutputs = {}
│      • globalSpeedIndex (module-level, shared across ALL cards)
│      • GLOBAL_SPEED_OPTIONS = [0.5, 1.0, 1.5, 2.0]
│      •
│    • RETURNS: controller object {
│        start: async () → loads & renders Stage 0,
│        next: () → goToStage(1),
│        prev: () → goToStage(0),
│        togglePause: () → pause/resume,
│        restart: () → goToStage(currentStageIndex),
│        cycleSpeed: () → speed++,
│        cycleTheme: () → theme++,
│        getSpeed: () → GLOBAL_SPEED_OPTIONS[globalSpeedIndex]
│      }
│
│  STEP 7: Build rail controls
│  ───────────────────────────
│    FUNCTION: (inside interpretJourney)
│    FILE: core/journey_interpreter.js
│    LINE: ~290
│    •
│    • FOR EACH rail control in journeyJson.stages[0].railControls:
│      •
│      • Creates <button> for:
│        - "Invert" (icon: flip arrows)
│        - "Algorithm" (icon: cycle/refresh)
│        - "Speed" (icon: N chevrons, dynamic)
│        - "Theme" (icon: half-circle)
│      •
│      • ON CLICK:
│        dispatch(
│          {target: "journey", method: "cycleSpeed", payload: {}},
│          {journey, dspEngine, renderingEngine}
│        )
│        FILE: core/dispatcher.js
│        LINE: 10
│        • CALL: journey.cycleSpeed()
│        • CALL: runAndRender() (re-render current stage with new speed)
│
│  STEP 8: Load & render Stage 0
│  ─────────────────────────────
│    FUNCTION: buildStage(0)
│    FILE: core/journey_interpreter.js
│    LINE: ~246
│    •
│    • GET: stageJson = journeyJson.stages[0]
│      {
│        stageId: "ecg_stage_1",
│        dataSource: {mode: "HTTP_REST"},
│        dspEngine: {algorithm: "pan_tompkins", invertSignal: false},
│        renderingEngine: {renderer: "chart_v1"},
│        uiFillers: {title: "Finding Each Beat", ...},
│        baseDurationMs: 3000 (fallback, if not in recipe)
│      }
│    •
│    • CALL: resolveDataSource(stageJson)
│      FILE: core/journey_interpreter.js
│      LINE: 195
│      •
│      • CHECK: stageJson.dataSource.mode === "HTTP_REST"
│      • CALL: fetchSignal(sampleId="ecg_001")
│        FILE: core/shared_signal_utils.js
│        LINE: 42
│        •
│        • FETCH: /shorts/api/sample/ecg_001/raw
│        • RESPONSE: {
│            signal: [0.001, 0.002, -0.001, ...],  ← actual ECG samples
│            fs: 500  ← sample rate in Hz
│          }
│        •
│        • CACHE: fetchedSignalCache.set("ecg_001", result)
│        • RETURN: {signal: [...], fs: 500}
│      •
│      • TRANSFORM: {
│          t: [0/500, 1/500, 2/500, ...],  ← time in seconds
│          y: [0.001, 0.002, -0.001, ...],  ← signal
│          fs: 500
│        }
│    •
│    • CALL: createDspEngine(stageJson.dspEngine)
│      FILE: core/dsp_registry.js
│      LINE: 95
│      •
│      • RETURNS: {
│          process: (data) → runs Pan-Tompkins peak detection
│          setParameter: (key, value) → toggle invert, etc.
│          getActiveAlgorithm: () → "pan_tompkins"
│          switchAlgorithm: (name) → switch to hamilton_tompkins
│        }
│    •
│    • CALL: dspEngine.process({t, y, fs})
│      FILE: core/dsp_registry.js (delegates to filters/pan_tompkins_filter.js)
│      •
│      • RUNS: Pan-Tompkins peak detection
│        INPUT: y = [0.001, 0.002, -0.001, ...]
│        OUTPUT: {
│          finalOutput: {
│            peaks: [12, 45, 78, ...],  ← indices of detected peaks
│            filtered_signal: [...]
│          }
│        }
│    •
│    • CACHE: dspOutputCache.set(0, {dspOutput, data})
│    •
│    • SET TEXT CONTENT:
│      titleEl.textContent = "Finding Each Beat"
│      captionEl.textContent = "Peaks are the topmost points..."
│      descriptionEl.textContent = "Uses whichever algorithm..."
│    •
│    • CALL: createRenderingEngine(stageJson.renderingEngine)
│      FILE: core/rendering_registry.js
│      LINE: 158
│      •
│      • RETURNS: {
│          render: (container, dspOutput, sampleId, fs, durationMs) → Plotly chart
│          applyTheme: (theme) → theme-specific colors
│        }
│    •
│    • CALL: renderingEngine.render(
│        chartContainer,
│        dspOutput,
│        sampleId="ecg_001",
│        fs=500,
│        durationMs=5000 (actualDuration = baseDurationMs / speed)
│      )
│      FILE: core/rendering_registry.js
│      •
│      • CALL: renderWaveformSweep(
│          container,
│          sampleId="ecg_001",
│          totalDurationMs=5000,
│          t=[0, 0.002, 0.004, ...],
│          y=[0.001, 0.002, -0.001, ...],
│          fs=500
│        )
│        FILE: core/shared_signal_utils.js
│        LINE: 231
│        •
│        • CALCULATE: yMin/yMax for axis scaling
│        • CALL: buildChartLayout(yMin, yMax, [t[0], t[0]+5])
│          FILE: core/shared_signal_utils.js
│          LINE: 88
│          •
│          • CALL: niceStep(yRange, 4)
│            FILE: core/shared_signal_utils.js
│            LINE: 75
│            •
│            • RETURNS: nice round grid step (0.1, 0.2, 0.5, 1, 2, ...)
│          •
│          • RETURNS: Plotly layout object {
│              xaxis: {title: "Time (s)", range: [...], tickfont: {...}},
│              yaxis: {title: "ECG (mV)", ...},
│              paper_bgcolor: "transparent",
│              plot_bgcolor: "transparent",
│              annotations: [{text: "□ = 1s / 0.1mV", ...}]
│            }
│        •
│        • CALL: Plotly.newPlot(
│            container,
│            [{x: [t[0]], y: [y[0]], mode: "lines", line: {...}}],
│            layout,
│            {staticPlot: true, responsive: true}
│          )
│          • RENDERS: Empty plot with just the first point
│        •
│        • CALL: startSweepLoop(
│            sampleId="ecg_001",
│            totalDurationMs=5000,
│            drawAtElapsed,  ← callback
│            startElapsedMs=0
│          )
│          FILE: core/shared_signal_utils.js
│          LINE: 148
│          •
│          • SETUP: activeSweepControl.set("ecg_001", {...})
│          • SCHEDULE: requestAnimationFrame(tick)
│          •
│          • LOOP:
│            • TICK every ~16.67ms (60fps browser cadence)
│            • THROTTLE: only call drawFn every 33ms (~30fps, avoiding jank)
│            • UPDATE: control.lastElapsedMs = elapsed
│            • CALL: drawAtElapsed(elapsed)
│              •
│              • CALCULATE: which samples to show (time-window sweep)
│              • CALL: sampleAligned(startIdx, endIdx)
│                FILE: core/shared_signal_utils.js
│                LINE: 219
│                •
│                • RETURNS: downsampled [x, y] slice for plotting
│              •
│              • CALL: Plotly.update(
│                  container,
│                  {x: [dsX], y: [dsY]},  ← streaming data
│                  {"xaxis.range": [...]}  ← scroll window
│                )
│              •
│              • UPDATE progress bar fill animation
│              •
│            • WHEN elapsed >= totalDurationMs:
│              • STOP loop
│              • AUTO-ADVANCE to Stage 1 (if autoAdvance=true)
│
│  STEP 9: Apply CSS & show card
│  ──────────────────────────────
│    FILE: shorts_feed.css + journey_page.html inline styles
│    •
│    • Card renders at 100vh height (full screen)
│    • Plot fills flex: 1 (remaining space)
│    • Text at bottom (title, caption, description, zone="bottom")
│    • Scroll snap: scroll-snap-align: start
│    • Progress bar: animates from 0-100% over baseDurationMs
│    • Opacity: 1 (was stuck at 0 in old system, fixed)
│    • Font: Roboto, left-aligned, bold title, regular description
│
└─ CARD VISIBLE, SWEEP ANIMATION RUNNING
   User sees: ECG waveform sweeping left→right, peaks marked, text at bottom
   Audio: sweep loop runs for 5 seconds at 1.0x speed
   User can: pause/resume, click Speed/Algorithm/Invert/Theme, tap zones to navigate


═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
USER SCROLLS DOWN (swipes up on mobile)
═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

┌─ SCROLL EVENT
│  FILE: core/journey_scroll_feed.js
│  LISTENER: IntersectionObserver (set up at line ~110)
│
│  STEP 1: Detect card entering viewport
│  ─────────────────────────────────────
│    • OBSERVE: every .journey-card's visibility
│    • TRIGGER: when a card's visibility ≥ 50%
│    • GET: sample object for that card
│      {sampleId: "ecg_002", data: {...}}
│
│  STEP 2: Lazy-start journey for this card
│  ─────────────────────────────────────────
│    • CALL: journey.start() (the controller returned from interpretJourney)
│    • EXECUTES: buildStage(0) for Stage 0 of this journey
│    • SAME FLOW AS ABOVE (Steps 7-9)
│    •
│    • NEW sampleId="ecg_002" (from pagination API)
│    • All else identical: Stage 0, ECG data, Pan-Tompkins, same rendering
│
│  STEP 3: Check if pagination needed
│  ──────────────────────────────────
│    • CONDITION: if (loadedCards.length < threshold)
│    • CALL: FETCH /shorts/api/samples?limit=20&offset=20
│    • RETURNS: next 20 samples
│    • APPEND: to DOM (cards 21-40)
│    •
│    • ALL NEW CARDS:
│      • buildCard() for each
│      • interpretJourney() for each (lazy, not yet started)
│      • IntersectionObserver watches them
│      • When user scrolls to each, journey.start() fires
│
├─ ACTUAL DATA FLOW (What's really moving):
│  ───────────────────────────────────────
│
│  Step A: Browser GET /shorts/api/samples?limit=20&offset=0
│  ┌─────────────────────────────────────────────────────────────────┐
│  │ (HAPPENS INSIDE journey_scroll_feed.js)                         │
│  │                                                                   │
│  │ NETWORK REQUEST: GET /shorts/api/samples?limit=20&offset=0      │
│  │ (This endpoint is NOT in the 14-file system; it lives elsewhere  │
│  │  in the broader Flask app. It queries the ECG database/files.)   │
│  │                                                                   │
│  │ RESPONSE (JSON):                                                 │
│  │ [                                                                │
│  │   {                                                              │
│  │     "sampleId": "ecg_001",                                       │
│  │     "metadata": {"recordingName": "Patient A", ...}              │
│  │   },                                                             │
│  │   {                                                              │
│  │     "sampleId": "ecg_002",                                       │
│  │     "metadata": {"recordingName": "Patient B", ...}              │
│  │   },                                                             │
│  │   ...                                                            │
│  │ ]                                                                │
│  │                                                                   │
│  │ These sampleIds are KEYS. The actual data comes later, on-demand.
│  └─────────────────────────────────────────────────────────────────┘
│
│  Step B: When card enters viewport & journey.start() is called
│  ┌─────────────────────────────────────────────────────────────────┐
│  │ (HAPPENS INSIDE buildStage → resolveDataSource)                 │
│  │                                                                   │
│  │ NETWORK REQUEST: GET /shorts/api/sample/ecg_001/raw             │
│  │ (Different endpoint! Fetches the ACTUAL signal data for this ID.)
│  │                                                                   │
│  │ RESPONSE (JSON):                                                 │
│  │ {                                                                │
│  │   "signal": [                                                    │
│  │     0.00123,                  ← sample 0 (time 0.000s)           │
│  │     0.00145,                  ← sample 1 (time 0.002s)           │
│  │     0.00089,                  ← sample 2 (time 0.004s)           │
│  │     -0.00067,                 ← sample 3 (time 0.006s)           │
│  │     ...                                                          │
│  │     0.00234,                  ← sample 2499 (time 4.998s)        │
│  │   ],                                                             │
│  │   "fs": 500                   ← sample rate: 500 Hz = 2ms/sample│
│  │ }                                                                │
│  │                                                                   │
│  │ PARSING (in fetchSignal):                                        │
│  │   const raw = {signal: [...], fs: 500};                          │
│  │   return {                                                       │
│  │     t: [0, 0.002, 0.004, 0.006, ..., 4.998],  ← time vector     │
│  │     y: [0.00123, 0.00145, 0.00089, ..., 0.00234],  ← signal     │
│  │     fs: 500                                                      │
│  │   }                                                              │
│  └─────────────────────────────────────────────────────────────────┘
│
│  Step C: DSP Processing
│  ┌─────────────────────────────────────────────────────────────────┐
│  │ INPUT to dspEngine.process():                                    │
│  │   {t: [...2500 samples...], y: [...], fs: 500}                   │
│  │                                                                   │
│  │ PROCESSING (Pan-Tompkins algorithm):                             │
│  │   FILE: filters/pan_tompkins_filter.js                           │
│  │   • Bandpass filter (5-15 Hz) → removes low-freq drift, noise    │
│  │   • Derivative → peak sharpening                                 │
│  │   • Squared signal → emphasize peaks                             │
│  │   • Moving window integration → detect peak regions              │
│  │   • Adaptive threshold → find exact peak indices                 │
│  │                                                                   │
│  │ OUTPUT:                                                          │
│  │   {                                                              │
│  │     finalOutput: {                                               │
│  │       peaks: [123, 245, 367, 489, ...],  ← sample indices        │
│  │       filtered_signal: [0.0001, 0.0002, ...],  ← processed data  │
│  │       rr_intervals: [122, 122, 122, 120, ...],  ← beat intervals │
│  │       hr_estimate: [74, 74, 74, 75, ...]  ← heart rate bpm       │
│  │     }                                                            │
│  │   }                                                              │
│  │                                                                   │
│  │ CACHE:                                                           │
│  │   dspOutputCache.set(0, {dspOutput, data})                       │
│  └─────────────────────────────────────────────────────────────────┘
│
│  Step D: Rendering
│  ┌─────────────────────────────────────────────────────────────────┐
│  │ INPUT to renderWaveformSweep():                                  │
│  │   container: <div class="chart">                                 │
│  │   sampleId: "ecg_001"                                            │
│  │   totalDurationMs: 5000  (3000ms base / 1.0x speed)              │
│  │   t: [0, 0.002, 0.004, ...]  ← time vector                       │
│  │   y: [0.00123, 0.00145, ...]  ← signal                           │
│  │   fs: 500                                                        │
│  │                                                                   │
│  │ PLOTLY CHART (SVG):                                              │
│  │   Plotly.newPlot():                                              │
│  │     • Creates <svg> with axes, grid                              │
│  │     • Grid at 1-second intervals (per niceStep)                  │
│  │     • Y-axis mV, X-axis seconds                                  │
│  │                                                                   │
│  │ SWEEP ANIMATION (requestAnimationFrame loop):                    │
│  │   • Frame 0 (t=0ms): shows sample[0]                             │
│  │   • Frame 1 (t=~33ms): shows samples[0..33] (throttled to 30fps) │
│  │   • Frame 2 (t=~66ms): shows samples[0..66]                      │
│  │   • ...continues showing increasingly wider window...            │
│  │   • Frame ~150 (t=5000ms): shows all samples[0..2500]            │
│  │     → animation completes                                        │
│  │     → auto-advance to Stage 1 (if enabled)                       │
│  │                                                                   │
│  │ PEAK MARKERS (overlay on sweep):                                 │
│  │   • Plotly addTraces() adds a scatter layer                      │
│  │   • Points at (t[peaks[i]], y[peaks[i]]) colored differently      │
│  │   • Also updates in real-time with sweep                         │
│  │                                                                   │
│  │ PROGRESS BAR (CSS animation):                                    │
│  │   FILE: shorts_feed.css + journey_page.html                      │
│  │   • <div class="stage-bar"><div class="fill"></div></div>       │
│  │   • fill animates width 0% → 100% over 5000ms (or speed-scaled)  │
│  │   • @keyframes: width 0% { 0 } 100% { 100% }                    │
│  │   • animation-duration: 5000ms (updated per stage + speed)       │
│  │                                                                   │
│  │ TEXT:                                                            │
│  │   • titleEl.textContent = "Finding Each Beat" (bold, Roboto 700) │
│  │   • captionEl.textContent = "Peaks are..." (regular, Roboto 400)│
│  │   • descriptionEl.textContent = "Uses whichever..." (Roboto 400) │
│  │   • All positioned in layout-zone[data-zone="bottom"]            │
│  │                                                                   │
│  │ STYLING:                                                         │
│  │   • Background: var(--bg) = #000000 (set by applyCurrentTheme()) │
│  │   • Glow: filter drop-shadow(0 0 3px var(--ecg-glow-color))      │
│  │   • Grid color: var(--grid-color) (read by buildChartLayout)     │
│  └─────────────────────────────────────────────────────────────────┘
│
│  Step E: User interactions during sweep
│  ┌─────────────────────────────────────────────────────────────────┐
│  │ TAP SPEED BUTTON:                                                │
│  │   • Click listener: dispatch({target: "journey", method: ...})   │
│  │   • CALL: journey.cycleSpeed()                                   │
│  │   • globalSpeedIndex++  (module-level, GLOBAL across all cards!) │
│  │   • newSpeed = GLOBAL_SPEED_OPTIONS[globalSpeedIndex]            │
│  │   • CALL: runAndRender()                                         │
│  │     • CALL: cancelSweepAnimation(sampleId)                       │
│  │     • CALL: renderingEngine.render(..., newDurationMs)           │
│  │       (where newDurationMs = baseDurationMs / newSpeed)          │
│  │     • CALL: startSweepLoop(..., newDurationMs, ...)              │
│  │       → restart sweep at faster/slower rate                      │
│  │   • Button icon updates: buildSpeedIcon(newSpeed)                │
│  │     • 0.5x = 1 chevron, 1.0x = 2, 1.5x = 3, 2.0x = 4 chevrons   │
│  │                                                                   │
│  │ TAP PAUSE (center of card):                                      │
│  │   • CALL: journey.togglePause()                                  │
│  │   • isPaused = !isPaused                                         │
│  │   IF now paused:                                                 │
│  │     • CALL: cancelSweepAnimation()  → stops rAF loop             │
│  │     • Store elapsed time in activeSweepControl                   │
│  │     • AUTO-ADVANCE TIMER: cleared                                │
│  │     • PROGRESS BAR: animationPlayState = "paused"                │
│  │   IF now resuming:                                               │
│  │     • CALL: startSweepLoop(..., elapsed)  → resume from position │
│  │     • AUTO-ADVANCE TIMER: restarted (remaining duration)         │
│  │     • PROGRESS BAR: animationPlayState = "running"               │
│  │                                                                   │
│  │ TAP LEFT (restart vs prev):                                      │
│  │   • DOUBLE_TAP_THRESHOLD = 350ms                                 │
│  │   • First tap (or slow): journey.restart()                       │
│  │     • CALL: goToStage(currentStageIndex)  → re-render same stage │
│  │     • Clears isPaused = false                                    │
│  │     • Rebuilds progress bar from 0%                              │
│  │   • Second tap within 350ms: journey.prev()                      │
│  │     • CALL: goToStage(currentStageIndex - 1)  → actually go back  │
│  │                                                                   │
│  │ TAP RIGHT (advance):                                             │
│  │   • CALL: journey.next()  → goToStage(currentStageIndex + 1)     │
│  │   • If still more stages, render Stage 1, Stage 2, etc.         │
│  │   • If past last stage, stay put (onJourneyComplete not wired)   │
│  │                                                                   │
│  │ TAP ALGORITHM BUTTON:                                            │
│  │   • dispatch({target: "dspEngine", method: "switchAlgorithm"})   │
│  │   • CALL: dspEngine.switchAlgorithm("hamilton_tompkins")         │
│  │   • CALL: runAndRender()                                         │
│  │     • Reprocess current stage's data with new algorithm          │
│  │     • Restart sweep with new peaks                               │
│  │     • Also resets isPaused = false (fixed bug)                   │
│  │                                                                   │
│  │ TAP THEME BUTTON:                                                │
│  │   • dispatch({target: "journey", method: "cycleTheme"})          │
│  │   • CALL: cycleTheme()  (in rail_controls.js)                    │
│  │   • themeIndex++  (module-level)                                 │
│  │   • CALL: applyThemeVariables(THEMES[themeIndex])                │
│  │   • Sets CSS variables (--bg, --grid-color, --ecg-glow-color)    │
│  │   • CALL: runAndRender()                                         │
│  │     • Plotly re-renders with new colors (read from CSS vars)     │
│  │     • Glow filter updates (reads --ecg-glow-color)               │
│  │   • Button icon updates (theme label text)                       │
│  └─────────────────────────────────────────────────────────────────┘

└─ NEXT CARD LOADS & ANIMATES SEAMLESSLY
   Repeat from Step 2 for the new sampleId


═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
KEY DATA STRUCTURES
═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

journeyJson (recipe, from backend/journey_bp.py, stored in backend/journey_store.py's journeystore.json)
├─ globalThemes: {activeTheme, themes: [{label, bg, traceColor, gridColor, ...}]}
├─ journeyRules: {allowStageNavigation, autoAdvance, preloadNextStage}
├─ uiShell: {showProgressBar, progressBar: {position, activeColor, inactiveColor}}
├─ playbackConfig: {isPaused}
├─ layout: {title, description, plot, caption, railControls}  ← where elements go
└─ stages: [
    {
      stageId,
      dataSource: {mode: "HTTP_REST" | "PREVIOUS_STAGE_PIPELINE"},
      dspEngine: {algorithm: "pan_tompkins" | "hamilton_tompkins", invertSignal},
      renderingEngine: {renderer: "chart_v1" | "scatter_density" | "dwt_comparison_view"},
      uiFillers: {title, caption, description},
      railControls: [{ui: {label, icon}, action: {target, method, payload}}],
      baseDurationMs: (optional, fallback to STAGE_DURATION_MS=5000),
      stageOutput: {exportKey, exportedFields: [...]}  ← for pipeline stages
    },
    ...
  ]

THEME (from rail_controls.js, module-level)
├─ label: "Clinical" | "Vivid" | "Experimental"
├─ bg: "#000000" | "#0d0a14" | "#0a0e14"
├─ traceColor: "#e8f4f8" | "#2dd4bf" | "#d9a441"
├─ gridColor: "rgba(...)"
└─ zeroLineColor: "rgba(...)"

DSP OUTPUT (after dspEngine.process())
├─ finalOutput: {
│   peaks: [123, 245, 367, ...],  ← indices in the signal array
│   filtered_signal: [...],
│   (algorithm-specific: rr_intervals, hr_estimate, sd1, sd2, ...)
│ }
└─ (for PREVIOUS_STAGE_PIPELINE: exported fields matching stageOutput.exportedFields)

SIGNAL DATA (from /shorts/api/sample/{sampleId}/raw)
├─ signal: [0.00123, 0.00145, 0.00089, ...]  ← 2500 samples @ 500Hz = 5 seconds
└─ fs: 500  ← sample rate in Hz

SWEEP STATE (per card, in activeSweepControl Map)
├─ sampleId (key)
└─ {
    totalDurationMs: 5000,
    drawFn: (elapsed) → {...},
    lastElapsedMs: 0  ← updated on every rAF tick, not throttled (pause/resume critical)
  }

JOURNEY CONTROLLER (returned from interpretJourney)
├─ currentStageIndex: 0
├─ isPaused: false
├─ dspOutputCache: Map(0 → {dspOutput, data})
├─ stageOutputs: {exportKey → exported fields}  ← for PREVIOUS_STAGE_PIPELINE
└─ Methods: {start(), next(), prev(), goToStage(), togglePause(), restart(), cycleSpeed(), cycleTheme(), getSpeed(), getActiveTheme()}

CSS VARIABLES (set by applyCurrentTheme, read by buildChartLayout and glow filter)
├─ --bg: "#000000" (Plotly paper isn't; this is the card background)
├─ --grid-color: "rgba(116, 125, 140, 0.18)"
├─ --zero-line-color: "rgba(116, 125, 140, 0.4)"
└─ --ecg-glow-color: "rgba(232, 244, 248, 0.7)"  ← updates per theme


═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
FILES INVOLVED (in order of execution)
═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

BACKEND (Python)
  backend/journey_bp.py                    ← Flask route handler, renders template, passes journeyJson
  backend/journey_store.py                 ← JourneyStore class, recipe registry, disk persistence (journeystore.json)

FRONTEND (HTML/CSS/JS)
  templates/shorts/journey_page.html       ← HTML structure, inline <script> with journeyJson, CSS variables, calls startJourneyScrollFeed

  STATIC/CSS
    static/shorts/shorts_feed.css          ← card layout, progress bar, rail buttons, animations, opacity fix

  STATIC/JS (executed in load order)
    static/shorts/core/rail_controls.js               ← THEMES array, cycleTheme(), getActiveThemeLabel(), applyCurrentTheme(), hexToRgbTriplet()
    static/shorts/core/dispatcher.js                  ← dispatch() function, routes actions to targets
    static/shorts/core/dsp_registry.js                ← createDspEngine(), delegates to filters
    static/shorts/core/rendering_registry.js          ← createRenderingEngine(), delegates to shared_signal_utils
    static/shorts/core/shared_signal_utils.js         ← fetchSignal(), niceStep(), buildChartLayout(), startSweepLoop(), cancelSweepAnimation(), makeSampleAligner(), renderWaveformSweep()
    static/shorts/core/journey_interpreter.js         ← interpretJourney(), buildSpeedIcon(), buildStage(), resolveDataSource(), runAndRender(), rail button setup
    static/shorts/core/journey_scroll_feed.js         ← startJourneyScrollFeed(), buildCard(), pagination, IntersectionObserver, lazy-start

  STATIC/JS/FILTERS (called by dsp_registry.js on demand)
    static/shorts/filters/pan_tompkins_filter.js      ← Pan-Tompkins peak detection algorithm
    static/shorts/filters/hamilton_tompkins_filter.js ← Hamilton-Tompkins peak detection algorithm
    static/shorts/filters/db4_filter.js               ← Daubechies-4 wavelet transform (for DWT journey)

STORAGE/CONFIG
  backend/data_cache/journeystore.json     ← persisted recipes, keyed by journey name ("ecg", "dwt")
  (user's disk, not in repo)


═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
NETWORK REQUESTS (in rough order of occurrence)
═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

1. GET /journey/ecg
   → Flask route, renders journey_page.html with journeyJson inline

2. GET /shorts/api/samples?limit=20&offset=0
   → Core pagination API (NOT in 14-file system)
   ← [{sampleId: "ecg_001", ...}, ...]

3. GET /shorts/api/sample/ecg_001/raw  (when card enters viewport)
   → Fetch actual ECG signal data
   ← {signal: [...2500 samples...], fs: 500}

4. GET /shorts/api/samples?limit=20&offset=20  (when user scrolls & threshold hit)
   → Fetch next batch of sample IDs
   ← [{sampleId: "ecg_021", ...}, ...]

(Repeats #3 for each card as it enters viewport)


═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
GLOBAL STATE (shared across ALL cards)
═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

In rail_controls.js:
  • THEMES[]: array of theme objects
  • themeIndex: 0  ← incremented by cycleTheme(), shared GLOBAL, affects ALL cards on screen

In journey_interpreter.js:
  • GLOBAL_SPEED_OPTIONS: [0.5, 1.0, 1.5, 2.0]
  • globalSpeedIndex: 0  ← incremented by cycleSpeed(), shared GLOBAL, affects ALL cards on screen

⚠️  These two globals are INTENTIONALLY shared. Speed/theme changes apply to all visible cards at once.


═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
INSTANCE STATE (per card, independent)
═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

Per journey controller (one per card):
  • currentStageIndex
  • isPaused
  • dspOutputCache
  • stageOutputs

Per sweep loop (one per card's active animation):
  • activeSweepControl[sampleId] = {totalDurationMs, drawFn, lastElapsedMs}
  • sweepAnimationHandles[sampleId] = requestAnimationFrame ID

⚠️  Pausing card A does NOT pause card B. Speed changes card A affects B (global). Theme changes affect ALL.



